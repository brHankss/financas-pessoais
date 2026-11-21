import type { Env, FinancialState } from '../types';
import { ensureSchema, loadFullState, saveFullState } from '../lib/db';
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
    const state = await loadFullState(env.DB);
    return json({
      ok: true,
      storage: 'cloudflare-d1',
      d1Connected: true,
      state,
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
    if (request.headers.get('X-Workspace-Version') !== 'fresh-20261121') {
      return errorJson('Atualize a página antes de salvar.', 409);
    }
    const body = await parseJsonBody<{ state?: FinancialState }>(request);
    if (!body?.state || !Array.isArray(body.state.accounts) || !Array.isArray(body.state.cards)) {
      return errorJson('Estrutura de estado inválida.', 400);
    }
    await ensureSchema(env.DB);
    await saveFullState(env.DB, body.state);
    return json({
      ok: true,
      storage: 'cloudflare-d1',
      d1Connected: true,
      savedAt: new Date().toISOString(),
    });
  }

  return null;
}
