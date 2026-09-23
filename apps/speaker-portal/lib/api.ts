const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

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
    throw new PortalError(error.code ?? "unknown", error.message ?? "Request failed.", response.status);
  }
  return body as T;
}

export type Finding = { check_code: string; severity: string; detail: Record<string, unknown> };

export type PortalTalk = {
  slot_id: string;
  title: string;
  room: string | null;
  starts_at: string;
  final_locked: boolean;
  status: string;
  status_label: string;
  versions: { version_number: number; size_bytes: string; created_at: string; state: string }[];
  findings: Finding[];
  /** Notes the DXG team wrote to the speaker, newest first (D-070). */
  feedback: { body: string; created_at: string; version_number: number }[];
};

export type PortalSession = {
  speaker: { id: string; name: string };
  event: { id: string; name: string; timezone: string };
};

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

export const presenterLogin = (email: string, code: string) =>
  request<{ principal: { display_name: string } }>("/portal/login", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });

export const presenterLogout = () => request<void>("/auth/logout", { method: "POST" });

export const getSession = () => request<PortalSession>("/portal/session");
export const getTalks = () => request<{ items: PortalTalk[] }>("/portal/talks");

export const beginUpload = (body: { slot_id: string; file_name: string; total_bytes: number }) =>
  request<UploadSession>("/portal/uploads", { method: "POST", body: JSON.stringify(body) });

export const getUploadState = (uploadId: string) =>
  request<{ received: number[]; bytes: number }>(`/portal/uploads/${uploadId}`);

export const putPart = (uploadId: string, partNumber: number, chunk: ArrayBuffer) =>
  request<{ part_number: number; size: number; sha256: string }>(
    `/portal/uploads/${uploadId}/parts/${partNumber}`,
    { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream" } },
  );

export const completeUpload = (uploadId: string, body: { slot_id: string; file_name: string; sha256?: string }) =>
  request<CompleteResult>(`/portal/uploads/${uploadId}/complete`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Whole-file SHA-256 in the browser, so the server can verify what arrived (I-3). */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
