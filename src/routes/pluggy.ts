import type { Env, ImportGroup } from '../types';
import { errorJson, json, parseJsonBody } from '../lib/http';

const groups: ImportGroup[] = ['accounts', 'cards', 'investments'];
const defaults = { accounts: true, cards: false, investments: true, itemIds: [] as string[], auto: false };
type Preferences = typeof defaults;
type Source = {
  id: string;
  itemId: string;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  currencyCode?: string | null;
  type?: string;
  balance?: number | null;
  code?: string | null;
  subtype?: string;
  institution?: { name?: string } | null;
  creditData?: { creditLimit?: number | null; balanceDueDate?: string | null; balanceCloseDate?: string | null } | null;
};
type ProductPage = { page: number; total: number; totalPages: number; results: Source[] };
const itemProducts = { accounts: 'accounts', cards: 'creditCards', investments: 'investments' } as const;
type Item = {
  id: string;
  status: string;
  executionStatus: string;
  consentExpiresAt?: string | null;
  statusDetail?: Partial<Record<typeof itemProducts[ImportGroup], { isUpdated: boolean } | null>> | null;
};
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const incompleteResponse = 'Resposta incompleta da Pluggy. Tente novamente.';
const expiredConsent = 'Renove a autorização da conexão no Meu Pluggy.';
const ready = (e: Env) => Boolean(e.DB && e.APP_PASSWORD?.trim() && e.PLUGGY_CLIENT_ID?.trim() && e.PLUGGY_CLIENT_SECRET?.trim());
async function init(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS pluggy_config (id INTEGER PRIMARY KEY, prefs TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, last_sync TEXT, status TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pluggy_positions (id TEXT PRIMARY KEY, item TEXT NOT NULL, category TEXT NOT NULL, payload TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pluggy_excluded (id TEXT PRIMARY KEY)"),
    db.prepare('INSERT OR IGNORE INTO pluggy_config(id,prefs) VALUES(1,?)').bind(JSON.stringify(defaults)),
  ]);
}
async function config(db: D1Database) {
  const row = await db.prepare('SELECT * FROM pluggy_config WHERE id=1').first<{prefs:string; revision:number; last_sync:string|null; status:string|null}>();
  return {...row!, prefs: JSON.parse(row!.prefs) as Preferences};
}
function mapProduct(r: Source, group: ImportGroup, item: string) {
  if (r.currencyCode && r.currencyCode !== 'BRL') return null;
  if (typeof r.name !== 'string' || !r.name.trim()) throw new Error(incompleteResponse);
  const id = 'pluggy_' + item + '_' + r.id;
  const name = r.marketingName || r.name;
  const balance = typeof r.balance === 'number' && Number.isFinite(r.balance) ? r.balance : null;
  if (group === 'cards') {
    const data = r.creditData;
    return {
      id, name, last4: r.number?.replace(/\D/g, '').slice(-4) || '—', institution: 'Meu Pluggy',
      closeDay: Number(data?.balanceCloseDate?.slice(8, 10)) || '—',
      dueDay: Number(data?.balanceDueDate?.slice(8, 10)) || '—',
      limit: data?.creditLimit ?? null, bankBalance: balance,
    };
  }
  if (balance === null) throw new Error(incompleteResponse);
  if (group === 'accounts') return { id, name, balance, color: '#2563eb' };
  // The existing UI field holds the current balance displayed by Meu Pluggy.
  return { id, name, gross: balance, detail: [r.institution?.name, r.code || r.subtype, r.id.slice(-8)].filter(Boolean).join(' · ') };
}
async function fetchJson<T>(path: string, options: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch('https://api.pluggy.ai' + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('Não foi possível consultar a Pluggy. Tente novamente.');
  }
  if (res.status === 404) throw new Error('A conexão não foi encontrada. Confira o itemId no painel da Pluggy.');
  if (res.status === 401 || res.status === 403) throw new Error('Confira as credenciais da API e a autorização da conexão no Meu Pluggy.');
  if (!res.ok) throw new Error('A Pluggy retornou HTTP ' + res.status + '. Tente novamente.');
  try {
    return await res.json<T>();
  } catch {
    throw new Error(incompleteResponse);
  }
}
async function validateItem(key: string, item: string, enabled: ImportGroup[]) {
  const itemId = item.toLowerCase();
  const info = await fetchJson<Item | null>('/items/' + itemId, { headers: { 'X-API-KEY': key } });
  if (typeof info?.id !== 'string' || info.id.toLowerCase() !== itemId) throw new Error(incompleteResponse);
  const expiry = info.consentExpiresAt == null ? null : Date.parse(info.consentExpiresAt);
  if (expiry !== null) {
    if (!Number.isFinite(expiry)) throw new Error(incompleteResponse);
    if (expiry <= Date.now()) throw new Error(expiredConsent);
  }
  if (info.status === 'UPDATING') throw new Error('A Pluggy está atualizando a conexão. Tente novamente em instantes.');
  if (info.status !== 'UPDATED') throw new Error('Revise a autorização e o estado da conexão no Meu Pluggy.');
  if (info.executionStatus === 'SUCCESS') return expiry;
  const { statusDetail } = info;
  if (info.executionStatus === 'PARTIAL_SUCCESS' && statusDetail &&
      typeof statusDetail === 'object' && !Array.isArray(statusDetail) &&
      enabled.every(category => {
        const product = statusDetail[itemProducts[category]];
        return product == null || product.isUpdated === true;
      })) return expiry;
  throw new Error('A Pluggy ainda não atualizou todos os dados selecionados. Tente novamente após atualizar a conexão.');
}
async function products(key: string, item: string, group: ImportGroup) {
  const endpoint = group === 'investments' ? '/investments' : '/accounts';
  const itemId = item.toLowerCase();
  const params = new URLSearchParams({ itemId });
  const type = group === 'investments' ? null : group === 'cards' ? 'CREDIT' : 'BANK';
  if (type) params.set('type', type);
  const result = [];
  const ids = new Set<string>();
  let total = 0;
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    params.set('page', String(page));
    const data = await fetchJson<ProductPage | null>(endpoint + '?' + params, { headers: { 'X-API-KEY': key } });
    if (!data || data.page !== page || !Array.isArray(data.results) ||
        !Number.isSafeInteger(data.total) || data.total < 0 ||
        !Number.isSafeInteger(data.totalPages) || data.totalPages < 0 || data.totalPages > Math.max(1, data.total) ||
        (data.total > 0 && (data.totalPages < 1 || data.results.length === 0))) {
      throw new Error(incompleteResponse);
    }
    if (page === 1) {
      total = data.total;
      pages = data.totalPages;
    } else if (total !== data.total || pages !== data.totalPages) {
      throw new Error(incompleteResponse);
    }
    for (const row of data.results) {
      if (typeof row?.id !== 'string' || !row.id.trim() || ids.has(row.id) ||
          typeof row.itemId !== 'string' || row.itemId.toLowerCase() !== itemId || (type && row.type !== type)) {
        throw new Error(incompleteResponse);
      }
      ids.add(row.id);
      const value = mapProduct(row, group, item);
      if (value) result.push(value);
    }
  }
  if (ids.size !== total) throw new Error(incompleteResponse);
  return result;
}

export async function syncPluggy(env: Env, scheduled = false) {
  if (!ready(env)) { if (scheduled) return; throw new Error('Configure os secrets da integração no Worker.'); }
  const db = env.DB!;
  await init(db);
  const {prefs, revision} = await config(db);
  const enabled = groups.filter(g => prefs[g]);
  if (scheduled && !prefs.auto) return;
  if (!prefs.itemIds.length || !enabled.length) { if (scheduled) return; throw new Error('Salve uma conexão e selecione uma categoria.'); }
  // Optimistic revision makes a later edit or completed synchronization win.
  const guard = 'EXISTS (SELECT 1 FROM pluggy_config WHERE id=1 AND revision=?)';
  try {
    const auth = await fetchJson<{apiKey:string} | null>('/auth', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:env.PLUGGY_CLIENT_ID,clientSecret:env.PLUGGY_CLIENT_SECRET})});
    if (typeof auth?.apiKey !== 'string' || !auth.apiKey.trim()) throw new Error('Credenciais não aceitas pela Pluggy.');
    const { apiKey } = auth;
    const statements: D1PreparedStatement[] = [];
    for (const item of prefs.itemIds) {
      const expiry = await validateItem(apiKey, item, enabled);
      for (const category of enabled) {
        const rows = await products(apiKey, item, category);
        statements.push(db.prepare('DELETE FROM pluggy_positions WHERE item=? AND category=? AND ' + guard).bind(item, category, revision));
        if (rows.length) {
          statements.push(db.prepare(`INSERT INTO pluggy_positions(id,item,category,payload)
            SELECT json_extract(value, '$.id'), ?, ?, value FROM json_each(?) WHERE ${guard}`)
            .bind(item, category, JSON.stringify(rows), revision));
        }
      }
      // Meu Pluggy can return empty lists as soon as consent expires, before the item status changes.
      if (expiry !== null && expiry <= Date.now()) throw new Error(expiredConsent);
    }
    statements.push(db.prepare("UPDATE pluggy_config SET revision=revision+1,last_sync=?,status=NULL WHERE id=1 AND revision=?").bind(new Date().toISOString(),revision));
    const results = await db.batch(statements);
    if (!results.at(-1)?.meta.changes) throw new Error('A configuração mudou. Sincronize novamente.');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha ao atualizar a conexão.';
    await db.prepare('UPDATE pluggy_config SET status=? WHERE id=1 AND revision=?').bind(message,revision).run();
    throw e;
  }
}

export async function pluggyRoute(req:Request, env:Env, path:string) {
  if (!path.startsWith('/api/pluggy/')) return null;
  const protectedApp = Boolean(env.APP_PASSWORD?.trim());
  if (!protectedApp || !env.DB) {
    if (path.endsWith('/status') && req.method === 'GET') return json({ready:false, protectedApp, prefs:defaults, positions:[]});
    return errorJson('Configure APP_PASSWORD e o banco D1 no Worker antes de vincular a conta.',403);
  }
  const db = env.DB;
  if (req.method === 'POST' && req.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return errorJson('Use JSON.',415);
  if (path === '/api/pluggy/sync' && req.method === 'POST') {
    await syncPluggy(env);
    return json({ ok: true });
  }
  await init(db);
  if (path === '/api/pluggy/status' && req.method === 'GET') {
    const cfg = await config(db);
    const result = await db.prepare('SELECT p.category,p.payload,e.id AS excluded FROM pluggy_positions p LEFT JOIN pluggy_excluded e ON e.id=p.id ORDER BY p.category,p.item,p.id').all<{category:ImportGroup;payload:string;excluded:string|null}>();
    return json({ready:ready(env),protectedApp,...cfg, positions:result.results.map(r=>({...JSON.parse(r.payload),category:r.category,excluded:Boolean(r.excluded)}))});
  }
  if (path === '/api/pluggy/preferences' && req.method === 'POST') {
    const body = await parseJsonBody<Preferences>(req);
    if (!body || !Array.isArray(body.itemIds) || body.itemIds.length > 10 || !body.itemIds.every(i=>typeof i==='string' && uuid.test(i)) ||
      ![...groups,'auto' as const].every(g=>typeof body[g]==='boolean')) return errorJson('Informe IDs de conexão válidos e confira as categorias.');
    const savedItems = (await config(db)).prefs.itemIds;
    // Keep IDs already used by saved positions and card purchases when a UUID changes case.
    const originalIds = new Map(savedItems.map(id => [id.toLowerCase(), id]));
    const itemIds = [...new Set(body.itemIds.map(id => id.toLowerCase()))].map(id => originalIds.get(id) ?? id);
    const prefs: Preferences = { accounts: body.accounts, cards: body.cards, investments: body.investments, auto: body.auto, itemIds };
    // Changing enabled categories freezes their last balances. Removing a connection removes its snapshot.
    await db.batch([
      db.prepare('UPDATE pluggy_config SET prefs=?,revision=revision+1,status=NULL WHERE id=1').bind(JSON.stringify(prefs)),
      db.prepare('DELETE FROM pluggy_positions WHERE item NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(prefs.itemIds)),
    ]);
    return json({ok:true});
  }
  if (path === '/api/pluggy/inclusion' && req.method==='POST') {
    const body = await parseJsonBody<{id:string; included:boolean}>(req);
    if (!body || typeof body.included!=='boolean' || typeof body.id!=='string') return errorJson('Posição inválida.');
    const row = await db.prepare("SELECT id FROM pluggy_positions WHERE id=? AND category='investments'").bind(body.id).first();
    if (!row) return errorJson('Aplicação não encontrada.',404);
    await (body.included ? db.prepare('DELETE FROM pluggy_excluded WHERE id=?') : db.prepare('INSERT OR IGNORE INTO pluggy_excluded(id) VALUES(?)')).bind(body.id).run();
    return json({ok:true});
  }
  return errorJson('Rota de importação não encontrada.',404);
}
