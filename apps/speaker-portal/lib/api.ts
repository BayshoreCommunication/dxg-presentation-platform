import { friendlyError } from "@pmp/format";
/**
 * Where the API is (production readiness). The browser always calls `/api/v1` on the
 * app's own address — the web server in production (Caddy) and Next's rewrite in
 * development pass it to the API — so the session cookie belongs to this site and one
 * build runs on any domain. Server-rendered code has no "own address" to call, so it
 * uses the API's internal origin, read at run time rather than baked into the build.
 */
const BASE =
  typeof window === "undefined"
    ? `${process.env.API_INTERNAL_ORIGIN ?? "http://localhost:4000"}/api/v1`
    : "/api/v1";
/** For URLs placed in the page (links, images): always the browser's path. */
const BROWSER_BASE = "/api/v1";

export class PortalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const onServer = typeof window === "undefined";
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (!(init?.body instanceof ArrayBuffer) && !(init?.body instanceof Uint8Array)) {
    headers["content-type"] ??= "application/json";
  }

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
    const error = body as { code?: string; message?: string };
    throw new PortalError(error.code ?? "unknown", friendlyError(error.code, error.message, response.status), response.status);
  }
  return body as T;
}

/* ── the speaker's account (D-146, D-148) ─────────────────────────────────── */

export type Principal = {
  kind: "staff";
  user_id: string;
  email: string;
  display_name: string;
  account_kind: "staff" | "speaker";
  must_change_password: boolean;
};

/** Sign in with email and password; a staff member's password opens nothing here. */
export const login = (email: string, password: string) =>
  request<{ step: "signed_in" | "mfa_required"; principal?: Principal }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const getSession = () => request<{ principal: Principal }>("/me/session");
export const logout = () => request<void>("/me/logout", { method: "POST" });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ changed: true }>("/me/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

export const requestPasswordReset = (email: string) =>
  request<{ message: string }>("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });

export const confirmPasswordReset = (token: string, newPassword: string) =>
  request<{ reset: true }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });

/* ── the speaker's presentations ─────────────────────────────────────────── */

export type Finding = { check_code: string; severity: string; detail: Record<string, unknown> };

/** One of the speaker's uploads (D-140). */
export type PortalVersion = {
  id: string;
  version_number: number;
  file_name: string;
  size_bytes: string;
  created_at: string;
  state: string;
  review_state: string;
  downloadable: boolean;
};

export type PortalTalk = {
  slot_id: string;
  title: string;
  /** The session this presentation is in, which can be titled differently from the talk. */
  session_title: string;
  room: string | null;
  starts_at: string;
  ends_at: string | null;
  final_locked: boolean;
  status: string;
  status_label: string;
  versions: PortalVersion[];
  /** What the room will show: the approved version, and whether it is on the room's PC (D-140). */
  room_copy: { version_number: number; loaded: boolean } | null;
  findings: Finding[];
  /** Notes the DXG team wrote to the speaker, newest first (D-070). */
  feedback: { body: string; created_at: string; version_number: number }[];
};

/** One event the speaker is on, with their talks on it. */
export type MyEvent = {
  id: string;
  name: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  status: string;
  upload_deadline: string | null;
  accent: string | null;
  speaker_id: string;
  talks: PortalTalk[];
};

export const getMyPresentations = () =>
  request<{ speaker: { name: string; email: string }; events: MyEvent[] }>("/me/presentations");

export type UploadSession = {
  upload_id: string;
  slot_id: string;
  file_name: string;
  total_bytes: number;
  part_size: number;
};

export type CompleteResult = {
  file_version_id: string;
  version_number: number;
  sha256: string;
  processing_state: string;
  inspection_state: string;
  findings: Finding[];
};

export const beginUpload = (body: { slot_id: string; file_name: string; total_bytes: number }) =>
  request<UploadSession>("/me/uploads", { method: "POST", body: JSON.stringify(body) });

export const getUploadState = (uploadId: string) =>
  request<{ received: number[]; bytes: number }>(`/me/uploads/${uploadId}`);

export const putPart = (uploadId: string, partNumber: number, chunk: ArrayBuffer) =>
  request<{ part_number: number; size: number; sha256: string }>(`/me/uploads/${uploadId}/parts/${partNumber}`, {
    method: "PUT",
    body: chunk,
    headers: { "content-type": "application/octet-stream" },
  });

export const completeUpload = (uploadId: string, body: { slot_id: string; file_name: string; sha256?: string }) =>
  request<CompleteResult>(`/me/uploads/${uploadId}/complete`, { method: "POST", body: JSON.stringify(body) });

/** The browser's path (it goes in an `href`), never the server's internal origin. */
export const downloadUrl = (versionId: string) => `${BROWSER_BASE}/me/file-versions/${versionId}/download`;

/** Whole-file SHA-256 in the browser, so the server can verify what arrived (I-3). */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
