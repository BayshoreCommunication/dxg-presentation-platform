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
