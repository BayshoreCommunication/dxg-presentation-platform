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
  /** `venue` is null when none was recorded — the header says so rather than inventing one. */
  event: EventRow & { timezone: string; venue: string | null };
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
  /** The slide preview (a PDF made at upload, D-074); null when never queued. */
  pdf_state: "queued" | "converting" | "done" | "failed" | null;
  pdf_error: string | null;
  original_filename: string | null;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1";

/** The version's slide preview as a PDF, for an <iframe> (D-074). */
export const previewUrl = (versionId: string) => `${API_BASE_URL}/file-versions/${versionId}/preview`;

/**
 * Issue a new device key for a room's presentation computer (D-077). The key is shown
 * once; issuing another cancels the previous one.
 */
export const issueDeviceKey = (roomId: string) =>
  request<{ agent_id: string; device_key: string; issued_at: string }>(`/rooms/${roomId}/device-key`, {
    method: "POST",
  });

/** Queue (or retry) a version's slide preview. */
export const requestPreview = (versionId: string) =>
  request<{ queued: number }>(`/file-versions/${versionId}/preview`, { method: "POST" });

export type FleetRoom = {
  room_id: string;
  room: string;
  readiness: "ready" | "attention" | "agent_offline";
  files_current: number;
  files_total: number;
  heartbeat_age: number | null;
  /** When this room's computer was last given a device key; null if it never was (D-077). */
  key_issued_at: string | null;
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
  /** For request revision / reject: who was emailed, and who has no address (D-073). */
  notice?: { emailed: string[]; without_email: string[] };
};

export const transitionVersion = (
  versionId: string,
  body: { action: string; lock_version: number; reason?: string; note?: string },
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
  event: { id: string; name: string; accent: string | null; timezone: string };
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
  stations: SrrStation[];
};

/** A Speaker Ready Room desk, set up per event (D-080). */
export type SrrStation = {
  id: string;
  station: string;
  name: string;
  technician: string | null;
  speaker: string | null;
  busy: boolean;
  lock_version: number;
};

export const addStation = (eventId: string, name: string) =>
  request<SrrStation>(`/events/${eventId}/srr/stations`, { method: "POST", body: JSON.stringify({ name }) });

export const renameStation = (eventId: string, stationId: string, name: string) =>
  request<SrrStation>(`/events/${eventId}/srr/stations/${stationId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const retireStation = (eventId: string, stationId: string) =>
  request<{ retired: true }>(`/events/${eventId}/srr/stations/${stationId}`, { method: "DELETE" });

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

export const startCheckin = (eventId: string, speakerId: string, stationId: string) =>
  request<{ checkin_id: string }>(
    `/events/${eventId}/srr/checkins`,
    { method: "POST", body: JSON.stringify({ speaker_id: speakerId, station_id: stationId }) },
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
  /** PDF copy of this version (D-072): null until it is queued, which happens on approval. */
  pdf_state: "queued" | "converting" | "done" | "failed" | null;
  pdf_error: string | null;
};

export type PresentationDetail = {
  event: { id: string; timezone: string };
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
  /** Which version of the talk the note was left on — the list covers them all (D-070). */
  version_number: number;
  from_speaker: boolean;
};

export const getPresentation = (slotId: string) => request<PresentationDetail>(`/slots/${slotId}`);

export const getFindings = (versionId: string) =>
  request<{ items: FindingRow[] }>(`/file-versions/${versionId}/findings`);

export const getComments = (versionId: string) =>
  request<{ items: CommentRow[] }>(`/file-versions/${versionId}/comments`);

/** Add a comment. `internal` is DXG staff only; `speaker_visible` shows in the speaker portal. */
export const addComment = (versionId: string, lane: "internal" | "speaker_visible", body: string) =>
  request<{ id: string }>(`/file-versions/${versionId}/comments`, {
    method: "POST",
    body: JSON.stringify({ lane, body }),
  });

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
  /** Presentations with at least one file / with an approved file (D-087). */
  talks_with_files: number;
  talks_approved: number;
  /** The last email this speaker was sent (D-086); null when never emailed. */
  last_email: { status: string; at: string; to: string; count: number } | null;
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

export type NewSpeakerInput = { name: string; email: string; organization: string; slot_id?: string };

export const addSpeaker = (eventId: string, input: NewSpeakerInput) =>
  request<{ speaker_id: string; created: boolean; slot_id: string | null }>(`/events/${eventId}/speakers`, {
    method: "POST",
    body: JSON.stringify(input),
  });

/* ── event details tabs (D-063) ────────────────────────────────────────── */

export type AgendaSpeaker = { id: string; name: string; organization: string | null; role: string };

export type AgendaPresentation = {
  slot_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  speakers: AgendaSpeaker[];
  version_count: number;
  status: string;
  status_label: string;
};

export type AgendaSession = {
  id: string;
  title: string;
  kind: string;
  state: string;
  day: string | null;
  room: string | null;
  track: string | null;
  starts_at: string;
  ends_at: string;
  presentations: AgendaPresentation[];
};

export const getAgenda = (eventId: string) => request<{ items: AgendaSession[] }>(`/events/${eventId}/agenda`);

/* Editing the agenda from the event details (D-064). Times are `HH:MM` in the event's timezone. */
export type SessionInput = { title: string; room: string; track: string; date: string; start: string; end: string };
export type PresentationInput = { title: string; start: string; end: string };
export type PresenterInput = { name: string; email: string; organization: string };

const send = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const agendaApi = {
  createSession: (eventId: string, input: SessionInput & { presenter?: PresenterInput }) =>
    send<{ session_id: string }>(`/events/${eventId}/sessions`, "POST", input),
  updateSession: (eventId: string, sessionId: string, input: SessionInput) =>
    send<{ rooms_rerouted: number }>(`/events/${eventId}/sessions/${sessionId}`, "PATCH", input),
  cancelSession: (eventId: string, sessionId: string, reason: string) =>
    send(`/events/${eventId}/sessions/${sessionId}/cancel`, "POST", { reason }),
  reinstateSession: (eventId: string, sessionId: string, reason: string) =>
    send(`/events/${eventId}/sessions/${sessionId}/reinstate`, "POST", { reason }),
  deleteSession: (eventId: string, sessionId: string) => send(`/events/${eventId}/sessions/${sessionId}`, "DELETE"),
  addPresentation: (eventId: string, sessionId: string, input: PresentationInput & { presenter?: PresenterInput }) =>
    send(`/events/${eventId}/sessions/${sessionId}/presentations`, "POST", input),
  updatePresentation: (eventId: string, slotId: string, input: PresentationInput) =>
    send(`/events/${eventId}/presentations/${slotId}`, "PATCH", input),
  deletePresentation: (eventId: string, slotId: string) => send(`/events/${eventId}/presentations/${slotId}`, "DELETE"),
  addPresenter: (eventId: string, slotId: string, input: PresenterInput) =>
    send(`/events/${eventId}/presentations/${slotId}/presenters`, "POST", input),
  removePresenter: (eventId: string, slotId: string, speakerId: string) =>
    send(`/events/${eventId}/presentations/${slotId}/presenters/${speakerId}`, "DELETE"),
};

export const getDuplicates = (eventId: string) =>
  request<{ items: DuplicatePair[] }>(`/events/${eventId}/speaker-duplicates`);

export const mergeSpeakers = (speakerId: string, into: string) =>
  request<{ merged_into: string }>(
    `/speakers/${speakerId}/merge`,
    { method: "POST", body: JSON.stringify({ into }) },
  );

/** Emails one speaker their upload link — once; a second call is refused (D-086). */
export const sendUploadLink = (eventId: string, speakerId: string) =>
  request<{ communication_id: string; to: string }>(`/events/${eventId}/speakers/${speakerId}/send-link`, {
    method: "POST",
  });

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
  /** Everyone this row names, presenter 1 first. */
  presenters: { name: string; email: string }[];
  /** The presentation's own window inside the session, when the file gives one. */
  slot_starts_at: string | null;
  slot_ends_at: string | null;
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
  /** Row numbers the operator removed; absent from `rows` and never committed. */
  excluded: readonly number[];
  /**
   * Typed agendas only: the rows that are already on the event. A typed row is
   * written when it is saved, so these are sessions, not staged rows.
   */
  saved_rows?: readonly number[];
  /** True when the agenda is being typed in rather than read from a file. */
  manual?: boolean;
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

/** What the importer reads, and what the server's raw body parser will accept. */
export const AGENDA_EXTENSIONS = [".xlsx", ".csv"] as const;
export const AGENDA_MAX_BYTES = 64 * 1024 * 1024;
/*
 * Written out rather than formatted. `formatBytes` is decimal and correct — 64 MiB is
 * 67.1 MB — but "up to 67.1 MB" reads like a number someone measured rather than a
 * limit someone set, and the limit is the server's own `limit: "64mb"`.
 */
export const AGENDA_MAX_LABEL = "64 MB";

/**
 * A header value may only hold Latin-1, and both `fetch` and `XMLHttpRequest` throw on
 * a name that does not — an agenda called "Programm – Übersicht.csv" would have failed
 * before a byte was sent. The name is display text and the extension chooses the
 * parser, so anything unrepresentable becomes an underscore rather than an exception.
 */
const headerSafeName = (name: string): string =>
  name.replace(/[^\x20-\x7E]/g, "_") || "agenda.csv";

/**
 * Uploads the agenda, reporting how much of it has been sent.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: it is still the only way to
 * watch a request body go out. The preview that comes back is the whole file parsed
 * and validated, so the bytes arriving is not the end of the wait — `onProgress`
 * reaching the total means the server has the file and is now reading it, which is
 * what the screen says at that point.
 */
export const uploadImport = (
  eventId: string,
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<ImportPreview> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${BASE}/events/${eventId}/imports`);
    request.withCredentials = true;
    request.setRequestHeader("content-type", "application/octet-stream");
    request.setRequestHeader("x-file-name", headerSafeName(file.name));

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };

    request.onload = () => {
      let body: { code?: string; message?: string } | null = null;
      try {
        body = JSON.parse(request.responseText) as { code?: string; message?: string };
      } catch {
        body = null;
      }
      if (request.status >= 200 && request.status < 300 && body) {
        resolve(body as unknown as ImportPreview);
        return;
      }
      reject(
        new ApiError(
          body?.code ?? "import.failed",
          body?.message ?? "That file could not be read.",
          request.status,
        ),
      );
    };

    request.onerror = () =>
      reject(new ApiError("network", "The upload did not reach the server.", 0));
    request.onabort = () => reject(new ApiError("aborted", "Upload cancelled.", 0));

    request.send(file);
  });

/**
 * Starts an agenda with no file, for an event whose schedule is small enough to type
 * or not yet in a spreadsheet. It is the same import the upload path produces — one
 * empty row to fill — so validation and commit are shared.
 */
export const startManualImport = (eventId: string) =>
  request<ImportPreview>(`/events/${eventId}/imports/blank`, { method: "POST" });

/**
 * Appends a row, with its values. Manual agendas only.
 *
 * The cells go up with the row rather than after it: the editor for a new session
 * opens over nothing, so a dialog that is cancelled has added nothing to cancel.
 */
export const addImportRow = (uploadId: string, cells: Record<string, string>) =>
  request<ImportPreview>(`/imports/${uploadId}/rows`, {
    method: "POST",
    body: JSON.stringify({ cells }),
  });

/**
 * Takes a row out of the import. Works on an uploaded agenda as well as a typed one:
 * the row is skipped, not renumbered, so the rows below keep their numbers and the
 * corrections typed into them stay attached.
 */
export const removeImportRow = (uploadId: string, row: number) =>
  request<ImportPreview>(`/imports/${uploadId}/rows/${row}`, { method: "DELETE" });

/** Puts every removed row back. */
export const restoreImportRows = (uploadId: string) =>
  request<ImportPreview>(`/imports/${uploadId}/rows/restore`, { method: "POST" });

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

/**
 * Turns the staged rows into sessions. Keyed by the upload, not by a
 * `schedule_imports` row: that record is written by the commit now, so there is
 * nothing to name until it succeeds. The event comes from the server's own cache
 * entry rather than being sent from here.
 */
export const commitImport = (uploadId: string, rows: StagedRow[]) =>
  request<{ created: number; updated: number; unchanged: number; speakers: number }>(
    `/imports/${uploadId}/commit`,
    { method: "POST", body: JSON.stringify({ rows }) },
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
  manifest: { file_count?: number; pdf?: { file_count: number; eligible: number } } | null;
  link_expires_at: string | null;
  created_at: string;
  downloads: string;
  /** False for a package built before PDF packages existed (D-067). */
  has_pdf: boolean;
};

/** Where PDF conversion stands for the talks that belong in the PDF package (D-067). */
export type PdfProgress = {
  eligible: number;
  converted: number;
  in_progress: number;
  not_started: number;
  failed: { title: string; speaker: string | null; error: string }[];
  converter_available: boolean;
};

export type ArchiveScope = {
  included: ArchiveCandidate[];
  excluded: { title: string; speaker: string | null; reason: string }[];
  total_bytes: number;
  rooms: number;
  days: number;
  pptx_count: number;
  pdf: PdfProgress;
  emails: number;
  earlier_versions: number;
  latest_package: ArchivePackageRow | null;
  downloads: DownloadRecord[];
  rules: { retention_days: number; event_ends_on: string | null; link_expires_if_delivered_now: string | null };
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
    pdf_file_count: number;
    pdf_not_converted: number;
  }>(`/events/${eventId}/archive-packages`, { method: "POST" });

/** Queue PDF conversion for everything not yet converted; `retry` re-runs failures. */
export const convertArchivePdfs = (eventId: string, retry = false) =>
  request<{ queued: number }>(`/events/${eventId}/archive/pdfs`, {
    method: "POST",
    body: JSON.stringify({ retry }),
  });

/** The link lasts 30 days from the event's end, set by the server (D-069). */
export const deliverArchive = (packageId: string) =>
  request<{ link_expires_at: string }>(`/archive-packages/${packageId}/deliver`, { method: "POST" });

export const archiveDownloadUrl = (packageId: string, format: "pptx" | "pdf" = "pptx") =>
  `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1"}/archive-packages/${packageId}/download?format=${format}`;

/** One download of an archive package — who and when (FR-ARCH-002). */
export type DownloadRecord = { downloaded_at: string; downloaded_by: string | null; format: "pptx" | "pdf" };

export type ClientView = {
  event: { id: string; name: string; starts_on: string; ends_on: string; client_name: string };
  totals: { total: string; collected: string; approved: string };
  tracks: { track: string; total: string; collected: string }[];
  package: ArchivePackageRow | null;
  downloads: DownloadRecord[];
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
  venue: string | null;
  timezone: string;
  starts_on: string;
  ends_on: string;
  rooms: string[];
  tracks: string[];
  days: number;
  /** Zero until an agenda is imported — which is what gates steps 3 and 4 (D-027). */
  sessions: number;
  settings: Record<string, unknown>;
  branding: Record<string, unknown>;
};

export type EventBasics = {
  name: string;
  venue: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
};

export const getTimezones = () => request<{ items: string[] }>(`/timezones`);

export const createEvent = (body: EventBasics) =>
  request<{ event_id: string }>(`/events`, { method: "POST", body: JSON.stringify(body) });

export const getDraft = (eventId: string) =>
  request<EventDraft>(`/events/${eventId}/draft`);

export const configureEvent = (
  eventId: string,
  body: {
    basics?: EventBasics;
    rooms?: string[];
    tracks?: string[];
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
  },
) => request<EventDraft>(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) });

export const activateEvent = (eventId: string) =>
  request<EventDraft>(`/events/${eventId}/activate`, { method: "POST" });

/** Archiving hides an event from the portfolio; restoring puts it back as it was (D-061). */
export const archiveEvent = (eventId: string, reason = "") =>
  request<EventDraft>(`/events/${eventId}/archive`, { method: "POST", body: JSON.stringify({ reason }) });

export const restoreEvent = (eventId: string) =>
  request<EventDraft>(`/events/${eventId}/restore`, { method: "POST" });

export type CommRecipient = {
  speaker_id: string;
  name: string;
  email: string | null;
  /** Every presentation the email is about, joined with " · " (D-087). */
  talk_title: string;
  room: string | null;
  starts_at: string;
  status: string;
  talks: { title: string; room: string | null; starts_at: string; status: string }[];
  bounced: boolean;
  already_sent: boolean;
};

export type CommsView = {
  templates: { id: string; name: string; subject: string; body: string }[];
  /** The merge fields a template may use (D-080). */
  merge_fields: string[];
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

/**
 * The seeded reminder template's name, as `DEFAULT_TEMPLATES` writes it onto every
 * event. The Speakers screen has to find this template by name because it is created
 * per event and has no stable id — see `remindSpeakersWithoutFiles`.
 */
export const REMINDER_TEMPLATE_NAME = "Reminder — file still missing";

/**
 * Chases everyone whose talk has no file, with the event's reminder template.
 *
 * Two calls rather than a new endpoint: `POST /comms/send` already filters to the
 * speakers with nothing uploaded and carries the guards that belong to sending —
 * an event with no rooms or days cannot invite anyone, a bounced address is not
 * written to again, and nobody receives the same batch twice. A second route would
 * have had to repeat all of it.
 */
export const remindSpeakersWithoutFiles = async (eventId: string) => {
  const { templates } = await getComms(eventId);
  const template =
    templates.find((candidate) => candidate.name === REMINDER_TEMPLATE_NAME) ??
    // Renamed by hand, most likely. Better than refusing to chase anyone.
    templates.find((candidate) => /reminder/i.test(candidate.name));
  if (!template) {
    throw new ApiError(
      "comms.template_not_found",
      "This event has no reminder template — add one on Communications.",
      404,
    );
  }
  return sendBatch(eventId, template.id, true);
};

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

/* ── Event files (FR-FILE-005, D-079) ─────────────────────────────────────── */

export type FileStatus = "review" | "approved" | "changes" | "blocked" | "other";

export type FileVersionRow = {
  id: string;
  file_id: string;
  version_number: number;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  source: string;
  review_state: string;
  processing_state: string;
  sha256: string | null;
  downloadable: boolean;
};

export type FileRow = {
  file_id: string;
  slot_id: string;
  talk: string;
  restricted: boolean;
  session: string;
  starts_at: string;
  room_id: string | null;
  room: string | null;
  speakers: string | null;
  version_id: string;
  version_number: number;
  versions: number;
  filename: string;
  size_bytes: number;
  total_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  source: string;
  review_state: string;
  processing_state: string;
  inspection_state: string;
  open_findings: number;
  rooms_synced: number;
  status: FileStatus;
  status_label: string;
  downloadable: boolean;
};

export type EventFiles = {
  rooms: { room_id: string | null; room: string; files: number; bytes: number }[];
  recent: (FileRow & { history: FileVersionRow[] })[];
  counts: Record<FileStatus | "all", number>;
  items: (FileRow & { history: FileVersionRow[] })[];
  total: number;
  page: number;
  pages: number;
  limit: number;
};

export type FileQuery = {
  q?: string;
  status?: FileStatus | "all";
  room?: string;
  sort?: "uploaded" | "name" | "speaker" | "location" | "size";
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
};

export const getEventFiles = (eventId: string, query: FileQuery = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const suffix = params.toString();
  return request<EventFiles>(`/events/${eventId}/files${suffix ? `?${suffix}` : ""}`);
};

/** A plain link: a top-level navigation carries the session cookie, like the archive's. */
export const fileDownloadUrl = (versionId: string) => `${API_BASE_URL}/file-versions/${versionId}/download`;

/**
 * Several versions as one zip. A POST (it carries a list), so it cannot be a link; the
 * browser fetches it and saves the result.
 */
export async function downloadFilesZip(eventId: string, versionIds: string[]): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE_URL}/events/${eventId}/files:bulk-download`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version_ids: versionIds }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(error.code ?? "unknown", error.message ?? "The download could not be built.", response.status);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "event-files.zip";
  return { blob: await response.blob(), filename };
}

/** Save an event's email template (D-080). Mail already sent keeps the text it went out with. */
export const updateTemplate = (eventId: string, templateId: string, subject: string, body: string) =>
  request<{ id: string; name: string; subject: string; body: string }>(
    `/events/${eventId}/comms/templates/${templateId}`,
    { method: "PATCH", body: JSON.stringify({ subject, body }) },
  );
