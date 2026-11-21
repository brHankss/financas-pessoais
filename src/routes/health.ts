import type { Env } from '../types';
import { isAuthRequired } from '../lib/auth';
import { getDbStats } from '../lib/db';
import { json } from '../lib/http';

export async function handleHealthRoute(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/health' || request.method !== 'GET') return null;

  if (!env.DB) {
    return json({
      ok: true,
      service: 'folego-financas-workers',
      d1Connected: false,
      authRequired: isAuthRequired(env),
      message: 'Worker ativo em modo local. Vincule um banco D1 com o nome DB em Settings > Bindings.',
    });
  }

  const counts = await getDbStats(env.DB);
  return json({
    ok: true,
    service: 'folego-financas-workers',
    d1Connected: true,
    authRequired: isAuthRequired(env),
    counts,
  });
}
