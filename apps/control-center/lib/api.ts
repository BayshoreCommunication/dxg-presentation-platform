const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * One fetch wrapper for both halves of the app. In a server component the
 * browser's cookie has to be forwarded explicitly; in the browser it travels on
 * its own once credentials are included.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const onServer = typeof window === "undefined";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  if (onServer) {
    // Imported dynamically: a static import would pull next/headers into the
    // client bundle, which the client components that share this module cannot
    // have.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
    if (cookieHeader) headers.cookie = cookieHeader;
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    ...(onServer ? {} : { credentials: "include" as const }),
    headers,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body as { code?: string; message?: string; detail?: Record<string, unknown> };
    throw new ApiError(
      error.code ?? "unknown",
      error.message ?? "Request failed.",
      response.status,
      error.detail,
    );
  }
  return body as T;
}

export type Principal = {
  kind: "staff";
  user_id: string;
  email: string;
  display_name: string;
  roles: string[];
  client_ids: string[];
  /** Events a client-only account may open. Empty for DXG staff. */
  client_events: { id: string; name: string }[];
  must_change_password: boolean;
  mfa_enrolled: boolean;
};

export const getSession = () => request<{ principal: Principal }>("/auth/session");

export type LoginResult =
  | { step: "signed_in"; principal: Principal }
  | { step: "mfa_required" };

export const login = (email: string, password: string) =>
  request<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const verifyMfa = (code: string) =>
  request<{
    step: "signed_in";
    principal: Principal;
    used_recovery_code: boolean;
    remaining_recovery_codes: number;
  }>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ code }) });

export type Enrolment = {
  secret: string;
  secret_grouped: string;
  otpauth_uri: string;
  account: string;
};

export const startMfaEnrolment = () => request<Enrolment>("/auth/mfa/start", { method: "POST" });

export const confirmMfaEnrolment = (code: string) =>
  request<{ recovery_codes: string[] }>("/auth/mfa/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

export const logout = () => request<void>("/auth/logout", { method: "POST" });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ changed: true }>("/auth/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

export type IssuedCredential = {
  speaker_id: string;
  speaker: string;
  email: string | null;
  access_code: string;
  code_hint: string;
  link: string;
  expires_at: string;
};

export const issueCredential = (speakerId: string) =>
  request<IssuedCredential>(`/speakers/${speakerId}/credentials`, { method: "POST" });

export const revokeCredential = (speakerId: string) =>
  request<{ revoked: number }>(`/speakers/${speakerId}/credentials`, { method: "DELETE" });

export type EventRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
};

export type Summary = {
  event: EventRow & { timezone: string };
  total: number;
  collected: number;
  approved: number;
  warnings_open: number;
  missing: number;
  rooms_ready: number;
  rooms_total: number;
};

export type RiskItem = {
  slot_id: string;
  room: string | null;
  starts_at: string;
  speaker: string | null;
  title: string;
  status: string;
  status_label: string;
};

export type Finding = { check_code: string; severity: string; detail: Record<string, unknown> };

export type QueueItem = {
  file_version_id: string;
  lock_version: number;
  review_state: string;
  version_number: number;
  slot_id: string;
  title: string;
  speaker: string | null;
  room: string | null;
  starts_at: string;
  size_bytes: string;
  findings: Finding[];
};

export type FleetRoom = {
  room_id: string;
  room: string;
  readiness: "ready" | "attention" | "agent_offline";
  files_current: number;
  files_total: number;
  heartbeat_age: number | null;
  agent_version: string | null;
};

export const listEvents = () => request<{ items: EventRow[] }>("/events");
export const getSummary = (eventId: string) => request<Summary>(`/events/${eventId}/summary`);
export const getRiskList = (eventId: string) =>
  request<{ items: RiskItem[] }>(`/events/${eventId}/risk-list`);
export const getReviewQueue = (eventId: string) =>
  request<{ items: QueueItem[] }>(`/events/${eventId}/review-queue`);
export const getFleet = (eventId: string) =>
  request<{ items: FleetRoom[] }>(`/events/${eventId}/sync/fleet`);

export type TransitionResult = {
  file_version_id: string;
  review_state: string;
  lock_version: number;
  rooms_queued: number;
};

export const transitionVersion = (
  versionId: string,
  body: { action: string; lock_version: number; reason?: string },
) =>
  request<TransitionResult>(`/file-versions/${versionId}:transition`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export type AgentScheduleRow = {
  slot_id: string;
  title: string;
  speaker: string | null;
  starts_at: string;
  file_version_id: string | null;
  version_number: number | null;
  room_file_id: string | null;
  sync_state: string | null;
  lock_version: number | null;
  acknowledged: boolean;
  requires_ack: boolean;
  launchable: boolean;
  presented_at: string | null;
};

export type AgentView = {
  room: { id: string; name: string };
  agent: { id: string | null; fingerprint: string | null; version: string | null; heartbeat_age: number | null };
  library: { files: number; bytes: string; previous_versions: number; updates_waiting: number };
  schedule: AgentScheduleRow[];
};

export const getAgentView = (roomId: string) =>
  request<AgentView>(`/rooms/${roomId}/agent-view`);

export const syncRoom = (roomId: string) =>
  request<{ downloaded: number; awaiting_ack: number; activated: number; failed: number }>(
    `/rooms/${roomId}/sync`,
    { method: "POST" },
  );

export const acknowledgeRoomFile = (roomFileId: string, lockVersion: number) =>
  request<{ sync_state: string }>(
    `/room-files/${roomFileId}/acknowledge`,
    { method: "POST", body: JSON.stringify({ lock_version: lockVersion }) },
  );

export const launchInRoom = (roomId: string, slotId: string) =>
  request<{ launched: boolean; at?: string; reason?: string }>(
    `/rooms/${roomId}/launch`,
    { method: "POST", body: JSON.stringify({ slot_id: slotId }) },
  );

/* ── Speaker Ready Room ───────────────────────────────────────────────────── */


export type ExpectedArrival = {
  speaker_id: string;
  speaker: string;
  slot_id: string;
  title: string;
  room: string | null;
  starts_at: string;
  status: string;
  status_label: string;
  checkin_id: string | null;
  signed_off: boolean;
};

export type SrrDashboard = {
  expected: ExpectedArrival[];
  warnings: { slot_id: string; speaker: string | null; check_code: string; severity: string }[];
  stations: { station: string; technician: string | null; busy: boolean }[];
};

export type VersionFacts = {
  version_number: number;
  size_bytes: string;
  slides: number | null;
  embedded_media: number | null;
  aspect: string | null;
  videos_flagged: number;
};

export type CheckinDetail = {
  checkin: { id: string; station: string | null; checked_in_at: string; technician: string; departed_at: string | null };
  speaker: { id: string; name: string };
  talk: {
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    final_locked: boolean;
    status: string;
    status_label: string;
  };
  approved: VersionFacts | null;
  latest: (VersionFacts & { file_version_id: string; review_state: string; processing_state: string }) | null;
  usb: { id: string; scan_result: string; file_version_id: string | null; created_at: string } | null;
  receipt: { version_number: number; sha256: string; signed_at: string; station: string | null; technician: string } | null;
};

export type UsbResult = {
  ingestion_id: string;
  scan_result: string;
  file_version_id: string | null;
  version_number: number | null;
  inspection_state: string | null;
  compared_with: { version_number: number; basis: "approved" | "previous" } | null;
  comparison: { field: string; approved: string; incoming: string; delta: string }[];
  message: string;
};

export const getSrrDashboard = (eventId: string) =>
  request<SrrDashboard>(`/events/${eventId}/srr`);

export const getCheckin = (checkinId: string) =>
  request<CheckinDetail>(`/srr/checkins/${checkinId}`);

export const startCheckin = (eventId: string, speakerId: string, station: string) =>
  request<{ checkin_id: string }>(
    `/events/${eventId}/srr/checkins`,
    { method: "POST", body: JSON.stringify({ speaker_id: speakerId, station }) },
  );

export const beginSrrUpload = () =>
  request<{ upload_id: string; part_size: number }>(`/srr/uploads`, { method: "POST" });

export const putSrrPart = (uploadId: string, partNumber: number, chunk: ArrayBuffer) =>
  request<{ size: number; sha256: string }>(
    `/srr/uploads/${uploadId}/parts/${partNumber}`,
    { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream" } },
  );

export const ingestUsb = (checkinId: string, body: { upload_id: string; file_name: string; reason: string }) =>
  request<UsbResult>(
    `/srr/checkins/${checkinId}/usb-ingestions`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const signOffCheckin = (checkinId: string, fileVersionId: string) =>
  request<{ receipt: NonNullable<CheckinDetail["receipt"]> }>(
    `/srr/checkins/${checkinId}/sign-off`,
    { method: "POST", body: JSON.stringify({ file_version_id: fileVersionId }) },
  );

export const departCheckin = (checkinId: string) =>
  request<{ departed: true }>(`/srr/checkins/${checkinId}/depart`, { method: "POST" });

/* ── presentation detail & inspection ─────────────────────────────────────── */

export type VersionRow = {
  file_version_id: string;
  version_number: number;
  size_bytes: string;
  sha256: string | null;
  source: string;
  processing_state: string;
  inspection_state: string;
  review_state: string;
  lock_version: number;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  finding_counts: { info: number; warning: number; blocking: number };
  room_states: string[];
};

export type PresentationDetail = {
  talk: {
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    track: string | null;
    final_locked: boolean;
    restricted: boolean;
    status: string;
    status_label: string;
  };
  speaker: { id: string; name: string; organization: string | null } | null;
  versions: VersionRow[];
  retained_versions: number;
};

export type FindingRow = {
  id: string;
  check_code: string;
  severity: string;
  detail: Record<string, unknown>;
  waived_by: string | null;
  waived_reason: string | null;
  waived_at: string | null;
};

export type CommentRow = {
  id: string;
  lane: string;
  body: string;
  created_at: string;
  author: string | null;
};

export const getPresentation = (slotId: string) => request<PresentationDetail>(`/slots/${slotId}`);

export const getFindings = (versionId: string) =>
  request<{ items: FindingRow[] }>(`/file-versions/${versionId}/findings`);

export const getComments = (versionId: string) =>
  request<{ items: CommentRow[] }>(`/file-versions/${versionId}/comments`);

export const waiveFinding = (findingId: string, reason: string) =>
  request<{ waived: true }>(`/findings/${findingId}/waive`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const requestRevision = (versionId: string, body: { finding_id?: string; note: string }) =>
  request<{ review_state: string }>(`/file-versions/${versionId}/request-revision`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const rollBackTalk = (slotId: string, targetVersionId: string, reason: string) =>
  request<{ restored_version: number; rooms_notified: number }>(`/slots/${slotId}/roll-back`, {
    method: "POST",
    body: JSON.stringify({ target_version_id: targetVersionId, reason }),
  });

/* ── speakers & schedule import ───────────────────────────────────────────── */

export type SpeakerRow = {
  id: string;
  full_name: string;
  email: string | null;
  organization: string | null;
  release_permission: string;
  talks: number;
  approved: number;
  with_files: number;
};

export type DuplicatePair = {
  a_id: string;
  a_name: string;
  a_email: string | null;
  b_id: string;
  b_name: string;
  b_email: string | null;
  reason: string;
};

export const getSpeakers = (eventId: string, q = "") =>
  request<{ items: SpeakerRow[] }>(`/events/${eventId}/speakers?q=${encodeURIComponent(q)}`);

export const getDuplicates = (eventId: string) =>
  request<{ items: DuplicatePair[] }>(`/events/${eventId}/speaker-duplicates`);

export const mergeSpeakers = (speakerId: string, into: string) =>
  request<{ merged_into: string }>(
    `/speakers/${speakerId}/merge`,
    { method: "POST", body: JSON.stringify({ into }) },
  );

export const inviteSpeaker = (speakerId: string) =>
  request<{ token: string; url: string }>(`/speakers/${speakerId}/invite`, { method: "POST" });

export type ImportField = string;

export type RowIssue = {
  row: number;
  column: string;
  severity: "blocking" | "warning";
  message: string;
  suggestion?: { field: ImportField; value: string };
};

export type StagedRow = {
  row: number;
  title: string;
  room: string;
  /** Every mapped field's current value — the whole row as the file states it. */
  cells: Record<string, string>;
  /** Which required fields this row still has no usable value for. */
  missing: string[];
  starts_at: string | null;
  ends_at: string | null;
  speaker_name: string;
  speaker_email: string;
  organization: string;
  track: string;
  action: "create" | "update" | "unchanged";
};

export type ImportPreview = {
  import_id: string;
  upload_id: string;
  file_name: string;
  /** The event's timezone — times are rendered in it, never the browser's. */
  timezone: string;
  required_fields: string[];
  headers: string[];
  mapping: (ImportField | null)[];
  total_rows: number;
  blocking: number;
  warnings: number;
  new_speakers: number;
  counts: { create: number; update: number; unchanged: number };
  issues: RowIssue[];
  rows: StagedRow[];
};

/** Mirrors IMPORT_FIELDS in apps/api/src/services/scheduleImport.ts, which is the
 *  source of truth. Also served by GET /import-fields if this ever needs to stop
 *  being a copy. */
export const IMPORT_FIELDS = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
  "speaker.name",
  "speaker.first_name",
  "speaker.last_name",
  "speaker.email",
  "speaker.organization",
  "track.name",
];

export const uploadImport = async (eventId: string, file: File) =>
  request<ImportPreview>(
    `/events/${eventId}/imports`,
    {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: { "content-type": "application/octet-stream", "x-file-name": file.name },
    },
  );

/**
 * A cell the operator typed for a row the file left incomplete. Sent as the value the
 * spreadsheet should have carried, so the server re-parses and re-validates it through
 * the same path the file took — no date parsing or timezone maths happens here.
 */
export const setImportCells = (uploadId: string, row: number, cells: Record<string, string>) =>
  request<ImportPreview>(`/imports/${uploadId}/cells`, {
    method: "POST",
    body: JSON.stringify({ row, cells }),
  });

/** Downloads a blank agenda template generated from the importer's own field list. */
export const downloadAgendaTemplate = async (eventId: string, eventName?: string) => {
  const response = await fetch(`${BASE}/events/${eventId}/agenda-template`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError("template.failed", "Could not download the template.", response.status);
  }
  saveBlob(await response.blob(), `agenda-template${eventName ? ` — ${eventName}` : ""}.csv`);
};

/** Hands a generated file to the browser's downloader. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const remapImport = (uploadId: string, mapping: (ImportField | null)[]) =>
  request<ImportPreview>(
    `/imports/${uploadId}/remap`,
    { method: "POST", body: JSON.stringify({ mapping }) },
  );

export const commitImport = (importId: string, eventId: string, rows: StagedRow[]) =>
  request<{ created: number; updated: number; unchanged: number; speakers: number }>(
    `/imports/${importId}/commit`,
    { method: "POST", body: JSON.stringify({ event_id: eventId, rows }) },
  );

/* ── archive builder & client portal ──────────────────────────────────────── */

export type ArchiveCandidate = {
  slot_id: string;
  title: string;
  room: string | null;
  speaker: string | null;
  version_number: number | null;
  size_bytes: string | null;
  sha256: string | null;
};

export type ArchivePackageRow = {
  id: string;
  archive_state: string;
  manifest: { file_count?: number } | null;
  link_expires_at: string | null;
  created_at: string;
  downloads: string;
};

export type ArchiveScope = {
  included: ArchiveCandidate[];
  excluded: { title: string; speaker: string | null; reason: string }[];
  total_bytes: number;
  rooms: number;
  days: number;
  latest_package: ArchivePackageRow | null;
};

export const getArchiveScope = (eventId: string) =>
  request<ArchiveScope>(`/events/${eventId}/archive/scope`);

export const buildArchive = (eventId: string) =>
  request<{
    package_id: string;
    archive_state: string;
    file_count: number;
    size_bytes: number;
    sha256: string;
    excluded: number;
  }>(`/events/${eventId}/archive-packages`, { method: "POST" });

export const deliverArchive = (packageId: string, days = 7) =>
  request<{ link_expires_at: string }>(
    `/archive-packages/${packageId}/deliver`,
    { method: "POST", body: JSON.stringify({ days }) },
  );

export const archiveDownloadUrl = (packageId: string) =>
  `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1"}/archive-packages/${packageId}/download`;

export type ClientView = {
  event: { id: string; name: string; starts_on: string; ends_on: string; client_name: string };
  totals: { total: string; collected: string; approved: string };
  tracks: { track: string; total: string; collected: string }[];
  package: ArchivePackageRow | null;
  /** Whose eyes this is through. Staff see the same filtered data, marked as a preview. */
  viewed_as: "client" | "staff_preview";
};

export const getClientView = (eventId: string) =>
  request<ClientView>(`/client/events/${eventId}`);

/* ── create event & communications ────────────────────────────────────────── */

export type EventDraft = {
  id: string;
  name: string;
  status: string;
  rooms: string[];
  tracks: string[];
  days: number;
  settings: Record<string, unknown>;
};

export const getTimezones = () => request<{ items: string[] }>(`/timezones`);

export const createEvent = (body: {
  name: string;
  venue: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
}) => request<{ event_id: string }>(`/events`, { method: "POST", body: JSON.stringify(body) });

export const getDraft = (eventId: string) =>
  request<EventDraft>(`/events/${eventId}/draft`);

export const configureEvent = (
  eventId: string,
  body: {
    rooms?: string[];
    tracks?: string[];
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
  },
) => request<EventDraft>(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) });

export const activateEvent = (eventId: string) =>
  request<EventDraft>(`/events/${eventId}/activate`, { method: "POST" });

export type CommRecipient = {
  speaker_id: string;
  name: string;
  email: string | null;
  talk_title: string;
  room: string | null;
  starts_at: string;
  status: string;
  bounced: boolean;
  already_sent: boolean;
};

export type CommsView = {
  templates: { id: string; name: string; subject: string; body: string }[];
  recipients: CommRecipient[];
  missing: CommRecipient[];
  log: {
    id: string;
    speaker: string | null;
    to_address: string;
    subject: string;
    status: string;
    sent_at: string | null;
    created_at: string;
  }[];
  stats: { queued: number; sent: number; delivered: number; opened: number; clicked: number; bounced: number };
};

export const getComms = (eventId: string) =>
  request<CommsView>(`/events/${eventId}/comms`);

export const sendBatch = (eventId: string, templateId: string, missingOnly: boolean) =>
  request<{ queued: number; skipped: { reason: string; count: number }[] }>(
    `/events/${eventId}/comms/send`,
    { method: "POST", body: JSON.stringify({ template_id: templateId, missing_only: missingOnly }) },
  );

/* ── account administration ───────────────────────────────────────────────── */

export type StaffRow = {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  mfa_enrolled: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  roles: { event_id: string; event_name: string; role: string }[];
  last_sign_in: string | null;
  recovery_codes_left: number;
};

export const EVENT_ROLE_NAMES = [
  "platform_admin",
  "project_manager",
  "presentation_manager",
  "srr_technician",
  "room_technician",
  "content_reviewer",
  "client_event_admin",
  "scoped_reviewer",
] as const;

export const listStaff = () => request<{ items: StaffRow[] }>("/admin/users");

export const createStaff = (email: string, displayName: string) =>
  request<{ user_id: string; temporary_password: string | null }>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: displayName }),
  });

export const resetStaffPassword = (userId: string) =>
  request<{ temporary_password: string }>(`/admin/users/${userId}/reset-password`, { method: "POST" });

export const resetStaffMfa = (userId: string, reason: string) =>
  request<{ reset: true }>(`/admin/users/${userId}/reset-mfa`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const setStaffActive = (userId: string, active: boolean) =>
  request<{ is_active: boolean }>(`/admin/users/${userId}/active`, {
    method: "POST",
    body: JSON.stringify({ active }),
  });

export const unlockStaff = (userId: string) =>
  request<{ unlocked: true }>(`/admin/users/${userId}/unlock`, { method: "POST" });

export const setStaffRole = (userId: string, eventId: string, role: string, grant: boolean) =>
  request<{ granted?: true; revoked?: true }>(`/admin/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify({ event_id: eventId, role, grant }),
  });

/* ── self-service password reset ──────────────────────────────────────────── */

export const requestPasswordReset = (email: string) =>
  request<{ message: string }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const confirmPasswordReset = (token: string, newPassword: string) =>
  request<{ reset: true; mfa_still_required: boolean }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
