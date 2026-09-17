const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1";

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
  version_number: number;
  sha256: string;
  processing_state: string;
  inspection_state: string;
  findings: Finding[];
};

export class PortalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body instanceof ArrayBuffer || init?.body instanceof Uint8Array
        ? { "content-type": "application/octet-stream" }
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body as { code?: string; message?: string };
    throw new PortalError(error.code ?? "unknown", error.message ?? "Request failed.");
  }
  return body as T;
}

export const getSession = (token: string) => call<PortalSession>(token, "/portal/session");
export const getTalks = (token: string) => call<{ items: PortalTalk[] }>(token, "/portal/talks");

export const beginUpload = (token: string, body: { slot_id: string; file_name: string; total_bytes: number }) =>
  call<UploadSession>(token, "/portal/uploads", { method: "POST", body: JSON.stringify(body) });

export const getUploadState = (token: string, uploadId: string) =>
  call<{ received: number[]; bytes: number }>(token, `/portal/uploads/${uploadId}`);

export const putPart = (token: string, uploadId: string, partNumber: number, chunk: ArrayBuffer) =>
  call<{ part_number: number; size: number; sha256: string }>(
    token,
    `/portal/uploads/${uploadId}/parts/${partNumber}`,
    { method: "PUT", body: chunk },
  );

export const completeUpload = (
  token: string,
  uploadId: string,
  body: { slot_id: string; file_name: string; sha256?: string },
) =>
  call<CompleteResult>(token, `/portal/uploads/${uploadId}/complete`, {
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
