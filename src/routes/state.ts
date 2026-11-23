import type { Env, FinancialState, StatementImportRow } from '../types';
import { ensureSchema, insertCardPurchasesIncremental, loadFullState, saveFullState } from '../lib/db';
import { planIncrementalStatementImport } from '../lib/dedup';
import { errorJson, json, parseJsonBody } from '../lib/http';

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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

  if (pathname === '/api/cards/import-statement' && request.method === 'POST') {
    if (!env.DB) {
      return errorJson('Banco D1 não conectado.', 503);
    }
    const body = await parseJsonBody<{
      cardId?: string;
      month?: string;
      items?: StatementImportRow[];
      defaultPersonId?: string;
    }>(request);

    if (!body || typeof body.cardId !== 'string' || !body.cardId.trim() || !body.month || !monthPattern.test(body.month) || !Array.isArray(body.items)) {
      return errorJson('Dados de importação inválidos. Informe cardId, month (YYYY-MM) e items.', 400);
    }

    const sanitized: StatementImportRow[] = [];
    for (const raw of body.items) {
      if (!raw || typeof raw.description !== 'string' || !raw.description.trim()) continue;
      if (typeof raw.date !== 'string' || !datePattern.test(raw.date)) continue;
      const cents = Math.round(Number(raw.cents) || 0);
      if (!Number.isSafeInteger(cents) || cents <= 0) continue;
      const count = Math.max(1, Math.min(99, Math.floor(Number(raw.count) || 1)));
      const index = Math.max(1, Math.min(count, Math.floor(Number(raw.index) || 1)));
      sanitized.push({
        date: raw.date,
        description: raw.description.trim(),
        cents,
        index,
        count,
        category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : undefined,
        personId: typeof raw.personId === 'string' && raw.personId.trim() ? raw.personId.trim() : undefined,
      });
    }

    const state = await loadFullState(env.DB);
    const defaultOwner =
      (body.defaultPersonId && state.people.some((p) => p.id === body.defaultPersonId) ? body.defaultPersonId : null) ||
      state.people.find((p) => p.isOwner)?.id ||
      state.people[0]?.id ||
      'p_italo';

    const plan = planIncrementalStatementImport(
      state.cardPurchases,
      body.cardId.trim(),
      body.month,
      sanitized,
      defaultOwner,
    );

    if (plan.newPurchases.length) {
      await insertCardPurchasesIncremental(env.DB, plan.newPurchases);
    }

    return json({
      ok: true,
      added: plan.addedCount,
      ignored: plan.ignoredCount,
      addedPurchases: plan.newPurchases,
      ignoredKeys: plan.items.filter((i) => i.duplicate).map((i) => i.importKey),
    });
  }

  return null;
}
