import type { Env } from '../types';
import { createSession, isAuthenticated, isAuthRequired, revokeSession, verifyPassword } from '../lib/auth';
import { errorJson, json, parseJsonBody } from '../lib/http';

export async function handleAuthRoutes(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const required = isAuthRequired(env);
    const authenticated = await isAuthenticated(env, request);
    return json({ ok: true, authRequired: required, authenticated, d1Connected: Boolean(env.DB) });
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await parseJsonBody<{ password?: string; deviceName?: string }>(request);
    if (!body || typeof body.password !== 'string') {
      return errorJson('Informe a senha para continuar.', 400);
    }
    const valid = await verifyPassword(env, body.password);
    if (!valid) {
      return errorJson('Senha incorreta.', 401);
    }
    if (!env.DB) {
      return isAuthRequired(env)
        ? errorJson('Vincule o banco D1 para iniciar a sessão.', 503)
        : json({ ok: true, authenticated: true });
    }
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : 'Navegador';
    const cookie = await createSession(env.DB, deviceName);
    return json({ ok: true, authenticated: true }, 200, { 'set-cookie': cookie });
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    const cookie = await revokeSession(env, request);
    return json({ ok: true, authenticated: false }, 200, { 'set-cookie': cookie });
  }

  return null;
}
