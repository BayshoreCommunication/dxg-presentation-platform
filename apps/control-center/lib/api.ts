const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

/** M0 stand-in for the OIDC session (BUILD_SPEC §13; replaced by M1-1). */
export const DEV_USER = process.env.DEV_USER ?? "reviewer";

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
 * The room machine is a different principal from staff (BUILD_SPEC §13: agents
 * authenticate with a signed device credential). Until M5-1 issues those, the
 * agent screen identifies as the room technician rather than the staff session.
 */
export const DEV_ROOM_USER = "room_tech";

async function request<T>(path: string, init?: RequestInit, as: string = DEV_USER): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", "x-dev-user": as, ...init?.headers },
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
  request<AgentView>(`/rooms/${roomId}/agent-view`, undefined, DEV_ROOM_USER);

export const syncRoom = (roomId: string) =>
  request<{ downloaded: number; awaiting_ack: number; activated: number; failed: number }>(
    `/rooms/${roomId}/sync`,
    { method: "POST" },
    DEV_ROOM_USER,
  );

export const acknowledgeRoomFile = (roomFileId: string, lockVersion: number) =>
  request<{ sync_state: string }>(
    `/room-files/${roomFileId}/acknowledge`,
    { method: "POST", body: JSON.stringify({ lock_version: lockVersion }) },
    DEV_ROOM_USER,
  );

export const launchInRoom = (roomId: string, slotId: string) =>
  request<{ launched: boolean; at?: string; reason?: string }>(
    `/rooms/${roomId}/launch`,
    { method: "POST", body: JSON.stringify({ slot_id: slotId }) },
    DEV_ROOM_USER,
  );

/* ── Speaker Ready Room ───────────────────────────────────────────────────── */

export const DEV_SRR_USER = "pm";

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
  comparison: { field: string; approved: string; incoming: string; delta: string }[];
  message: string;
};

export const getSrrDashboard = (eventId: string) =>
  request<SrrDashboard>(`/events/${eventId}/srr`, undefined, DEV_SRR_USER);

export const getCheckin = (checkinId: string) =>
  request<CheckinDetail>(`/srr/checkins/${checkinId}`, undefined, DEV_SRR_USER);

export const startCheckin = (eventId: string, speakerId: string, station: string) =>
  request<{ checkin_id: string }>(
    `/events/${eventId}/srr/checkins`,
    { method: "POST", body: JSON.stringify({ speaker_id: speakerId, station }) },
    DEV_SRR_USER,
  );

export const beginSrrUpload = () =>
  request<{ upload_id: string; part_size: number }>(`/srr/uploads`, { method: "POST" }, DEV_SRR_USER);

export const putSrrPart = (uploadId: string, partNumber: number, chunk: ArrayBuffer) =>
  request<{ size: number; sha256: string }>(
    `/srr/uploads/${uploadId}/parts/${partNumber}`,
    { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream" } },
    DEV_SRR_USER,
  );

export const ingestUsb = (checkinId: string, body: { upload_id: string; file_name: string; reason: string }) =>
  request<UsbResult>(
    `/srr/checkins/${checkinId}/usb-ingestions`,
    { method: "POST", body: JSON.stringify(body) },
    DEV_SRR_USER,
  );

export const signOffCheckin = (checkinId: string, fileVersionId: string) =>
  request<{ receipt: NonNullable<CheckinDetail["receipt"]> }>(
    `/srr/checkins/${checkinId}/sign-off`,
    { method: "POST", body: JSON.stringify({ file_version_id: fileVersionId }) },
    DEV_SRR_USER,
  );

export const departCheckin = (checkinId: string) =>
  request<{ departed: true }>(`/srr/checkins/${checkinId}/depart`, { method: "POST" }, DEV_SRR_USER);

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
  }, "pm");

export const requestRevision = (versionId: string, body: { finding_id?: string; note: string }) =>
  request<{ review_state: string }>(`/file-versions/${versionId}/request-revision`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const rollBackTalk = (slotId: string, targetVersionId: string, reason: string) =>
  request<{ restored_version: number; rooms_notified: number }>(`/slots/${slotId}/roll-back`, {
    method: "POST",
    body: JSON.stringify({ target_version_id: targetVersionId, reason }),
  }, "pm");

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
  request<{ items: SpeakerRow[] }>(`/events/${eventId}/speakers?q=${encodeURIComponent(q)}`, undefined, "pm");

export const getDuplicates = (eventId: string) =>
  request<{ items: DuplicatePair[] }>(`/events/${eventId}/speaker-duplicates`, undefined, "pm");

export const mergeSpeakers = (speakerId: string, into: string) =>
  request<{ merged_into: string }>(
    `/speakers/${speakerId}/merge`,
    { method: "POST", body: JSON.stringify({ into }) },
    "pm",
  );

export const inviteSpeaker = (speakerId: string) =>
  request<{ token: string; url: string }>(`/speakers/${speakerId}/invite`, { method: "POST" }, "pm");

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

export const IMPORT_FIELDS = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
  "speaker.name",
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
    "pm",
  );

export const remapImport = (uploadId: string, mapping: (ImportField | null)[]) =>
  request<ImportPreview>(
    `/imports/${uploadId}/remap`,
    { method: "POST", body: JSON.stringify({ mapping }) },
    "pm",
  );

export const commitImport = (importId: string, eventId: string, rows: StagedRow[]) =>
  request<{ created: number; updated: number; unchanged: number; speakers: number }>(
    `/imports/${importId}/commit`,
    { method: "POST", body: JSON.stringify({ event_id: eventId, rows }) },
    "pm",
  );
