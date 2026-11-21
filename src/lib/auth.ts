import type { Env } from '../types';
import { ensureSchema } from './db';
import { parseCookies } from './http';

const SESSION_COOKIE = 'financas_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

export function isAuthRequired(env: Env): boolean {
  return Boolean(env.APP_PASSWORD && env.APP_PASSWORD.trim().length > 0);
}

export async function verifyPassword(env: Env, password: string): Promise<boolean> {
  if (!isAuthRequired(env)) return true;
  const expected = env.APP_PASSWORD!.trim();
  const [a, b] = await Promise.all([sha256Hex(password), sha256Hex(expected)]);
  return timingSafeEqual(a, b);
}

export async function createSession(db: D1Database, deviceName: string): Promise<string> {
  await ensureSchema(db);

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = toHex(bytes.buffer);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db.prepare('INSERT INTO sessions (token_hash, device_name, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, deviceName.slice(0, 80) || 'Navegador', expiresAt)
    .run();

  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export async function revokeSession(env: Env, request: Request): Promise<string> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (token && env.DB) {
    await ensureSchema(env.DB);
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isAuthenticated(env: Env, request: Request): Promise<boolean> {
  if (!isAuthRequired(env)) return true;
  if (!env.DB) return false;
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;

  await ensureSchema(env.DB);
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT expires_at FROM sessions WHERE token_hash = ?'
  )
    .bind(tokenHash)
    .first<{ expires_at: string }>();

  if (!row) return false;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return false;
  }
  return true;
}
