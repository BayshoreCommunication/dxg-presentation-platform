const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

/** M0 stand-in for the OIDC session (BUILD_SPEC §13; replaced by M1-1). */
export const DEV_USER = "reviewer";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", "x-dev-user": DEV_USER, ...init?.headers },
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
