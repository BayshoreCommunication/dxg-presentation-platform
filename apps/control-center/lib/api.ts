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
