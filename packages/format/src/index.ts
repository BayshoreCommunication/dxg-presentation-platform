/**
 * Human-readable byte sizes.
 *
 * Every call site used to floor to whole megabytes, so a 68 KB upload rendered as
 * "0 MB". That is not a cosmetic rounding nit: the string appears in the speaker's
 * upload confirmation, where "0 MB" reads as "nothing arrived" at exactly the moment
 * the speaker is checking that their file got through. The likely reaction is to
 * upload again, or to email the organisers — the two things the confirmation exists
 * to prevent.
 *
 * Units are decimal (1 MB = 1,000,000 bytes) to match how file sizes are quoted to
 * speakers elsewhere ("up to 10 GB") and how operating systems report them.
 */
const UNITS = [
  { limit: 1_000_000_000, suffix: "GB", divisor: 1_000_000_000 },
  { limit: 1_000_000, suffix: "MB", divisor: 1_000_000 },
  { limit: 1_000, suffix: "KB", divisor: 1_000 },
];

export function formatBytes(input: number | string | null | undefined): string {
  // Number(null) is 0 and Number("") is 0, so an absent value would otherwise be
  // reported as a real, empty file. Reject them before coercing.
  if (input === null || input === undefined || input === "") return "—";

  const bytes = Number(input);
  if (!Number.isFinite(bytes)) return "—";

  const sign = bytes < 0 ? "-" : "";
  const size = Math.abs(bytes);

  // Below a kilobyte there is no useful fraction, and "0.1 KB" reads worse than "912 bytes".
  if (size < 1_000) {
    return `${sign}${Math.round(size)} ${Math.round(size) === 1 ? "byte" : "bytes"}`;
  }

  const unit = UNITS.find((candidate) => size >= candidate.limit) ?? UNITS[UNITS.length - 1]!;
  const value = size / unit.divisor;

  // One decimal below 100, none above: "67.3 KB" is informative, "155.4 MB" is noise.
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${sign}${text} ${unit.suffix}`;
}

/** Signed difference, for comparing an incoming file against the approved one. */
export function formatBytesDelta(from: number | string, to: number | string): string {
  const difference = Number(to) - Number(from);
  if (!Number.isFinite(difference)) return "—";
  if (difference === 0) return "unchanged";
  return `${difference > 0 ? "+" : ""}${formatBytes(difference)}`;
}

/**
 * An upload deadline as speakers read it, in the portal and in email alike (D-071,
 * D-072): the end of that day on the event's clock, with the zone named —
 * "Sat, Feb 27, 2027 · 23:59 EST". The date is a bare `YYYY-MM-DD` and is formatted as
 * a calendar date, never converted through the reader's timezone, which is how a date
 * becomes the day before.
 */
export function formatDeadline(deadline: string, timeZone: string): string {
  const noon = new Date(`${deadline}T12:00:00Z`);
  const day = noon.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const zone = noon.toLocaleTimeString("en-US", { timeZone, timeZoneName: "short" }).split(" ").pop() ?? "";
  return `${day} · 23:59 ${zone}`;
}

/** A session's start as an email states it: day and time on the event's clock, zone named. */
export function formatSessionTime(iso: string | Date, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  });
}
