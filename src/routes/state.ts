import { isFinancialState } from '../../public/js/financial-state.js';
import type { Env } from '../types';
import { ensureSchema, getDefaultState, loadFullState, saveFullState } from '../lib/db';
import { errorJson, json, parseJsonBody } from '../lib/http';

export async function handleStateRoutes(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === '/api/state' && request.method === 'GET') {
    if (!env.DB) {
      return json({
        ok: true,
        storage: 'local-fallback',
        d1Connected: false,
        state: null,
      });
    }
    const { state, revision } = await loadFullState(env.DB);
    return json({
      ok: true,
      storage: 'cloudflare-d1',
      d1Connected: true,
      state,
      revision,
    });
  }

  if (pathname === '/api/state' && request.method === 'PUT') {
    if (!env.DB) {
      return json({
        ok: true,
        storage: 'local-fallback',
        d1Connected: false,
      });
    }
    const body = await parseJsonBody<{ state?: unknown; revision?: unknown }>(request);
    if (!body || !isFinancialState(body.state)) {
      return errorJson('Estrutura de estado inválida.', 400);
    }
    if (body.revision !== undefined && typeof body.revision !== 'string') {
      return errorJson('Revisão de estado inválida.', 400);
    }
    await ensureSchema(env.DB);
    const revision = await saveFullState(env.DB, body.state, { expectedRevision: body.revision });
    if (revision === null) return errorJson('Os dados na nuvem mudaram desde a última leitura.', 409);
    return json({
      ok: true,
      storage: 'cloudflare-d1',
      d1Connected: true,
      savedAt: new Date().toISOString(),
      revision,
    });
  }

  if (pathname === '/api/state/reset' && request.method === 'POST') {
    const fresh = getDefaultState();
    if (env.DB) {
      await ensureSchema(env.DB);
      await saveFullState(env.DB, fresh);
    }
    return json({
      ok: true,
      storage: env.DB ? 'cloudflare-d1' : 'local-fallback',
      d1Connected: Boolean(env.DB),
      state: fresh,
    });
  }

  return null;
}
