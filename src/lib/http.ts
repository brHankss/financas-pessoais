export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorJson(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}
