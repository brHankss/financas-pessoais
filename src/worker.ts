import type { Env } from './types';
import { isAuthenticated } from './lib/auth';
import { errorJson } from './lib/http';
import { handleAuthRoutes } from './routes/auth';
import { handleHealthRoute } from './routes/health';
import { handleStateRoutes } from './routes/state';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      try {
        const health = await handleHealthRoute(request, env, pathname);
        if (health) return health;

        const authRes = await handleAuthRoutes(request, env, pathname);
        if (authRes) return authRes;

        const authed = await isAuthenticated(env, request);
        if (!authed) {
          return errorJson('Sessão expirada ou não autenticada.', 401);
        }

        const stateRes = await handleStateRoutes(request, env, pathname);
        if (stateRes) return stateRes;

        return errorJson('Endpoint não encontrado.', 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro interno no servidor.';
        return errorJson(message, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
