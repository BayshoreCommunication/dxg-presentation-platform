/**
 * One plain-language vocabulary (D-110, UX_REVIEW batch 2). Every code a person can see —
 * talk, file-version, room, email, archive, role, check and sign-in states — is named here
 * once, with what it means and what to do next, and every chip, toast and error uses it.
 *
 * The talk-status *labels* are DXG's approved words (VISUAL_ACCEPTANCE §2.2: "no renaming
 * without DXG agreement") and still come from @pmp/domain; this file only adds the visible
 * meaning and next step beside them. Everything else here is ours to word.
 */

export type Words = { label: string; meaning: string; next?: string };

/** An unknown code still reads as words: "sync_failed" → "Sync failed". Never shown raw. */
export function humanize(code: string): string {
  const text = code.replace(/[_.]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Unknown";
}

export function wordsFor(map: Readonly<Record<string, Words>>, code: string | null | undefined): Words {
  if (!code) return { label: "—", meaning: "" };
  return map[code] ?? { label: humanize(code), meaning: "" };
}

// ── talk status (labels fixed by DXG; meaning + next step are ours) ─────────────────────
export const TALK_STATUS: Readonly<Record<string, Words>> = {
  missing: { label: "Missing", meaning: "Nothing uploaded yet.", next: "Remind the speaker, or take a file by USB in the Speaker Ready Room." },
  processing: { label: "Processing", meaning: "Just uploaded — the virus check and file checks are running.", next: "Nothing to do; this takes about a minute." },
  submitted: { label: "Submitted", meaning: "Passed the checks and waiting for a reviewer.", next: "Review it in Review & approval." },
  needs_revision: { label: "Needs revision", meaning: "A reviewer asked for changes, or the file failed a check.", next: "Waiting on the speaker to upload a new version." },
  approved: { label: "Approved", meaning: "Approved, but no room is assigned to receive it yet.", next: "Check the session has a room." },
  approved_delivering: { label: "Approved — delivering", meaning: "Approved and being copied to the room's presentation PC.", next: "Nothing to do unless the room PC is not reporting." },
  update_pending_ack: { label: "Update pending ack", meaning: "A newer approved version is on the room PC, but the room still plays the old one.", next: "The room technician switches to the new version in Room Agent." },
  synchronized_onsite: { label: "Synchronized onsite", meaning: "On the room's PC and ready to play.", next: "Nothing left to do." },
  attention: { label: "Attention", meaning: "Failed the virus check or arrived damaged, so it is held back.", next: "Ask the speaker for a clean copy." },
  canceled: { label: "Canceled", meaning: "The session was cancelled. Its files are kept.", next: "" },
  archived: { label: "Archived", meaning: "The event is archived and read-only.", next: "" },
};

/**
 * R7: a talk the rooms confirmed is only as current as the room PC's last report. When the
 * room PC has gone quiet, "Synchronized onsite" is shown with this line instead of the
 * all-clear.
 */
export function staleRoomNote(lastSeenSecondsAgo: number): string {
  return `Last confirmed ${agoWords(lastSeenSecondsAgo)} ago — the room PC is not reporting, so this may be out of date.`;
}

/** A room PC is "not reporting" after this long — the same 300 s deriveRoomReadiness uses. */
export const ROOM_PC_SILENT_AFTER_SECONDS = 300;

/** Talk statuses that are only as true as the room PC's last report (R7). */
const ROOM_CONFIRMED = ["synchronized_onsite", "approved_delivering", "update_pending_ack"];

/**
 * R7 (D-110): the amber line to show instead of the all-clear, or null when the status
 * stands. `roomHeartbeatAge` is seconds since the room PC last reported; null when it
 * never has; undefined when the talk's room isn't known (nothing to say then). The DXG
 * label and deriveTalkStatus are untouched — this only adds freshness beside them.
 */
export function talkRoomNote(status: string, roomHeartbeatAge: number | null | undefined): string | null {
  if (!ROOM_CONFIRMED.includes(status) || roomHeartbeatAge === undefined) return null;
  if (roomHeartbeatAge === null) return "Not confirmed — the room PC hasn't reported yet, so this may be out of date.";
  return roomHeartbeatAge > ROOM_PC_SILENT_AFTER_SECONDS ? staleRoomNote(roomHeartbeatAge) : null;
}

/** What a speaker is told about their own talk: no pipeline words, no room words. */
export const SPEAKER_TALK_STATUS: Readonly<Record<string, Words>> = {
  missing: { label: "Not received yet", meaning: "We haven't received your presentation yet.", next: "Please upload it below." },
  processing: { label: "Checking your file", meaning: "We're checking your file. This usually takes a minute." },
  submitted: { label: "Received — in review", meaning: "Your file passed our checks and the DXG team is reviewing it.", next: "Nothing to do unless they ask for changes." },
  needs_revision: { label: "Changes needed", meaning: "Please see the notes below and upload a new version." },
  approved: { label: "Approved", meaning: "Your presentation is approved. Nothing more to do." },
  approved_delivering: { label: "Approved", meaning: "Your presentation is approved and being prepared for your room." },
  update_pending_ack: { label: "Approved", meaning: "Your latest version is approved and ready for your room." },
  synchronized_onsite: { label: "Ready in your room", meaning: "Your presentation is ready on the computer in your room." },
  attention: { label: "Please upload again", meaning: "We couldn't accept this file. Please upload a fresh copy." },
  canceled: { label: "Session cancelled", meaning: "This session has been cancelled.", next: "The organisers will be in touch." },
  archived: { label: "Event finished", meaning: "This event has finished." },
};

// ── one file version ─────────────────────────────────────────────────────────────────
/** A version's own state: its review state, unless processing stopped it first. */
export const VERSION_STATE: Readonly<Record<string, Words>> = {
  uploading: { label: "Uploading", meaning: "Still arriving." },
  uploaded: { label: "Checking", meaning: "Arrived; the virus check starts shortly." },
  scanning: { label: "Checking", meaning: "The virus check is running." },
  checksum_failed: { label: "Damaged in transit", meaning: "The file arrived damaged.", next: "Ask the speaker to upload it again." },
  quarantined: { label: "Held back", meaning: "Failed the virus check. It can't be opened or sent to a room.", next: "Ask the speaker for a clean copy." },
  awaiting_review: { label: "Waiting for review", meaning: "Passed the checks; a reviewer hasn't opened it yet." },
  in_review: { label: "Being reviewed", meaning: "A reviewer has it open." },
  changes_requested: { label: "Changes requested", meaning: "A reviewer asked the speaker for changes." },
  approved: { label: "Approved", meaning: "This is the version the rooms play." },
  superseded: { label: "Older version", meaning: "A newer version replaced this one." },
  rejected: { label: "Rejected", meaning: "A reviewer rejected this version; it will not be used." },
  rolled_back: { label: "Replaced by an earlier version", meaning: "Staff went back to an earlier approved version." },
  blocked: { label: "Blocked", meaning: "A check found a problem that must be fixed before approval." },
};

export const INSPECTION_STATE: Readonly<Record<string, Words>> = {
  pending: { label: "Checks queued", meaning: "The file checks start in a moment." },
  inspecting: { label: "Checks running", meaning: "Refresh in a minute." },
  passed: { label: "Checks passed", meaning: "No problems found." },
  passed_with_warnings: { label: "Passed with warnings", meaning: "Nothing blocks approval, but read the warnings." },
  technician_review: { label: "Technician review", meaning: "A check needs a person to look at it before approval." },
  failed: { label: "Checks failed", meaning: "A problem must be fixed before this can be approved." },
};

/** Inspection checks, as staff read them. */
export const CHECK: Readonly<Record<string, Words>> = {
  malware: { label: "Virus check", meaning: "Scanned for viruses." },
  aspect: { label: "Slide shape", meaning: "Slide shape compared with the room screens." },
  codec: { label: "Video format", meaning: "Videos checked for formats the room PCs can play." },
  linked_media: { label: "Linked videos or files", meaning: "Videos or files the slides point to but don't include." },
  macros: { label: "Macros", meaning: "Macros can't run in the rooms." },
  corruption: { label: "File opens", meaning: "Checked that the file opens." },
  size_type: { label: "File type and size", meaning: "Checked it is a supported file within the size limit." },
  fonts: { label: "Fonts", meaning: "Fonts that may not be on the room PCs." },
  metadata: { label: "File details", meaning: "Slides, embedded media and size." },
};

export const SEVERITY: Readonly<Record<string, Words>> = {
  blocking: { label: "Must fix", meaning: "Blocks approval." },
  warning: { label: "Warning", meaning: "Worth a look; doesn't block approval." },
  info: { label: "Note", meaning: "For information." },
};

// ── rooms ────────────────────────────────────────────────────────────────────────────
/** A version's copy on one room PC. */
export const ROOM_COPY: Readonly<Record<string, Words>> = {
  assigned: { label: "Waiting to copy", meaning: "The room PC will fetch it next time it checks in." },
  syncing: { label: "Copying", meaning: "Being copied to the room PC." },
  synced: { label: "On the room PC", meaning: "Copied and checked on the room PC." },
  acknowledged: { label: "Switched", meaning: "The room technician switched to this version." },
  active: { label: "Ready to play", meaning: "This is what the room will play." },
  obsolete: { label: "Replaced", meaning: "A newer version replaced this copy." },
  sync_failed: { label: "Copy failed", meaning: "The room PC couldn't copy this file.", next: "Check the room PC is on and online; it retries by itself." },
  // Not stored codes: a copied-but-not-switched version (R44), and a talk with no copy here.
  switch_needed: { label: "New version ready — switch needed", meaning: "A newer approved version is on the room PC; the room still plays the old one.", next: "Switch to it in Room Agent." },
  not_sent: { label: "Not sent to this room", meaning: "No approved version has been sent to this room yet." },
};

// ── comments ─────────────────────────────────────────────────────────────────────────
/** Who a comment is for — the same words the comment panel uses. */
export const COMMENT_LANE: Readonly<Record<string, Words>> = {
  internal: { label: "Internal", meaning: "DXG staff only." },
  speaker_visible: { label: "To speaker", meaning: "Shown to the speaker in their portal." },
  client_visible: { label: "Client lane", meaning: "Shown in the client review lane." },
};

// ── email ────────────────────────────────────────────────────────────────────────────
export const EMAIL_STATUS: Readonly<Record<string, Words>> = {
  queued: { label: "Sending", meaning: "Being sent now." },
  sent: { label: "Sent", meaning: "Handed to the mail service." },
  delivered: { label: "Delivered", meaning: "Reached the speaker's inbox." },
  opened: { label: "Opened", meaning: "The speaker opened it." },
  clicked: { label: "Link clicked", meaning: "The speaker clicked the link." },
  bounced: { label: "Bounced", meaning: "Couldn't be delivered.", next: "Check the email address, correct it and resend." },
  complained: { label: "Marked as spam", meaning: "The speaker marked it as spam; we won't email them again.", next: "Contact the speaker another way." },
  failed: { label: "Not sent", meaning: "The mail service refused it.", next: "Try again; if it keeps failing, contact DXG support." },
  suppressed: { label: "Not sent", meaning: "This address bounced or complained before, so we didn't send.", next: "Correct the email address." },
};

// ── archive ──────────────────────────────────────────────────────────────────────────
export const ARCHIVE_STATE: Readonly<Record<string, Words>> = {
  draft: { label: "Not built yet", meaning: "The package hasn't been built.", next: "Build the package." },
  building: { label: "Building", meaning: "The package is being built. This can take a few minutes." },
  ready: { label: "Ready to deliver", meaning: "Built and checked.", next: "Deliver it to the client." },
  delivered: { label: "Delivered to client", meaning: "The client can download it until the link expires." },
  expired: { label: "Link expired", meaning: "The client's download link has expired.", next: "Deliver again to send a new link." },
  deleted: { label: "Deleted", meaning: "The package was deleted." },
  failed: { label: "Build stopped", meaning: "The last build didn't finish.", next: "See the error, then build again." },
};

// ── schedule import ──────────────────────────────────────────────────────────────────
/** One row of a schedule import preview (S19): what pressing Import will do to it. */
export const IMPORT_ROW: Readonly<Record<string, Words>> = {
  create: { label: "New", meaning: "Will be added to the event when you press Import." },
  update: { label: "Will update", meaning: "Matches a session already on the event; its details will be updated." },
  unchanged: { label: "No change", meaning: "Already on the event exactly like this." },
  incomplete: { label: "Incomplete", meaning: "Some details are missing or wrong.", next: "Press Edit to complete the row." },
  saved: { label: "On the event", meaning: "Saved — the session is on the event now." },
};

// ── people ───────────────────────────────────────────────────────────────────────────
export const ROLE: Readonly<Record<string, Words>> = {
  platform_admin: { label: "DXG administrator", meaning: "Manages staff accounts and every event." },
  project_manager: { label: "Project manager", meaning: "Runs the event: setup, speakers, rooms and archive." },
  presentation_manager: { label: "Presentation manager", meaning: "Manages speakers, files and approvals." },
  content_reviewer: { label: "Reviewer", meaning: "Reviews and approves presentations." },
  srr_technician: { label: "Speaker Ready Room technician", meaning: "Checks speakers in and takes files by USB onsite." },
  room_technician: { label: "Room technician", meaning: "Runs one room's presentation PC." },
  client_event_admin: { label: "Client administrator", meaning: "The client's view of the event and its archive." },
  scoped_reviewer: { label: "Client reviewer", meaning: "A client-side reviewer for chosen sessions only." },
};

/** "Reviewer or Project manager" — a role list as a sentence, never as codes. */
export function roleList(roles: readonly string[]): string {
  const names = roles.map((role) => wordsFor(ROLE, role).label);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Security words, one set (A22–A26, A28). */
export const SECURITY = {
  factor: "sign-in app",
  factorTitle: "Sign-in app",
  code: "6-digit code from your sign-in app",
  recoveryCodes: "backup codes",
  recoveryCodesTitle: "Backup codes",
  admin: "DXG administrator",
  lostPhone: "Lost your phone? Use a backup code, or ask a DXG administrator to reset your sign-in app.",
} as const;

// ── time ─────────────────────────────────────────────────────────────────────────────
/** US venues first, in the order people expect; then the rest of the world. */
export const COMMON_TIME_ZONES: readonly { zone: string; label: string }[] = [
  { zone: "America/New_York", label: "Eastern Time (New York)" },
  { zone: "America/Chicago", label: "Central Time (Chicago)" },
  { zone: "America/Denver", label: "Mountain Time (Denver)" },
  { zone: "America/Phoenix", label: "Mountain Time — no daylight saving (Phoenix)" },
  { zone: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { zone: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { zone: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
];

/** "Eastern Time (New York)"; any other zone as "Europe/London" → "London (Europe)". */
export function timeZoneLabel(zone: string): string {
  const common = COMMON_TIME_ZONES.find((entry) => entry.zone === zone);
  if (common) return common.label;
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const parts = zone.split("/");
  const city = (parts.at(-1) ?? zone).replace(/_/g, " ");
  return parts.length > 1 ? `${city} (${parts[0]!.replace(/_/g, " ")})` : city;
}

/** Common zones first, then the rest sorted by label. */
export function timeZoneOptions(zones: readonly string[]): { zone: string; label: string }[] {
  const common = COMMON_TIME_ZONES.filter((entry) => zones.includes(entry.zone));
  const rest = zones
    .filter((zone) => !COMMON_TIME_ZONES.some((entry) => entry.zone === zone))
    .map((zone) => ({ zone, label: timeZoneLabel(zone) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...common, ...rest];
}

/** A calendar date "2026-09-30" → "Sep 30, 2026" — never shifted through the reader's zone. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  if (Number.isNaN(day.getTime())) return date;
  const zone = /^\d{4}-\d{2}-\d{2}$/.test(date) ? "UTC" : undefined;
  return day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(zone ? { timeZone: zone } : {}) });
}

/** "Mar 10 – 12, 2026" / "Mar 30 – Apr 2, 2026" / "Dec 30, 2026 – Jan 2, 2027". */
export function formatDateRange(start: string, end: string): string {
  if (!start || !end) return formatDate(start || end);
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  const opts = (fields: Intl.DateTimeFormatOptions) => (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { ...fields, timeZone: "UTC" });
  if (start === end) return formatDate(start);
  if (sy !== ey) return `${formatDate(start)} – ${formatDate(end)}`;
  if (sm !== em) return `${opts({ month: "short", day: "numeric" })(start)} – ${opts({ month: "short", day: "numeric" })(end)}, ${sy}`;
  return `${opts({ month: "short", day: "numeric" })(start)} – ${Number(end.slice(8))}, ${sy}`;
}

/** A moment on the event's clock: "Sep 30, 2026, 2:15 PM EDT". */
export function formatDateTime(iso: string | Date | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return String(iso);
  return moment.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone, timeZoneName: "short" } : {}),
  });
}

/** "12 minutes" / "3 hours" / "6 days". */
export function agoWords(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "moments";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

/** "1 file" / "3 files". */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
