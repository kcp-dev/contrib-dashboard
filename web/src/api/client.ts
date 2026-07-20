// Thin typed client over the same-origin BFF. All kcp REST goes through
// /api/kcp/clusters/<path>/... ; app endpoints live under /api and /auth.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const msg =
      (body as { message?: string } | undefined)?.message ??
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// kcp REST scoped to a workspace path (e.g. "root", "root:org:team").
export function kcpUrl(clusterPath: string, apiPath: string): string {
  const clean = apiPath.replace(/^\/+/, "");
  return `/api/kcp/clusters/${encodeURIComponent(clusterPath)}/${clean}`;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  post: <T>(url: string, data: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(data) }),
};
