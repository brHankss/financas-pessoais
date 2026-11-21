import type { Env, ImportGroup } from '../types';
import { errorJson, json, parseJsonBody } from '../lib/http';

const groups: ImportGroup[] = ['accounts', 'cards', 'investments'];
const defaults = { accounts: true, cards: false, investments: true, itemIds: [] as string[], auto: false };
type Preferences = typeof defaults;
type Source = { id: string; name: string; marketingName?: string; number?: string; currencyCode?: string;
  type?: string; balance?: number; code?: string; subtype?: string; institution?: { name?: string };
  creditData?: { creditLimit?: number; balanceDueDate?: string; balanceCloseDate?: string } };
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const ready = (e: Env) => Boolean(e.DB && e.APP_PASSWORD?.trim() && e.PLUGGY_CLIENT_ID && e.PLUGGY_CLIENT_SECRET);
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
  if (!r.id || !r.name || (r.currencyCode && r.currencyCode !== 'BRL')) return null;
  const id = 'pluggy_' + item + '_' + r.id;
  const name = r.marketingName || r.name;
  if (group === 'accounts') return r.type === 'BANK' && Number.isFinite(r.balance) ? { id, name, balance:r.balance, color:'#2563eb' } : null;
  if (group === 'cards') {
    if (r.type !== 'CREDIT') return null;
    const data = r.creditData;
    return {id, name, last4: r.number?.replace(/\D/g,'').slice(-4) || '—', institution: 'Meu Pluggy',
      closeDay: Number(data?.balanceCloseDate?.slice(8,10)) || '—', dueDay:Number(data?.balanceDueDate?.slice(8,10)) || '—',
      limit:data?.creditLimit ?? null, bankBalance:r.balance ?? null};
  }
  if (!Number.isFinite(r.balance)) return null;
  return {id,name,gross:r.balance,detail:[r.institution?.name, r.code || r.subtype, r.id.slice(-8)].filter(Boolean).join(' · ')};
}
async function fetchJson<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch('https://api.pluggy.ai' + path, {...options, signal:AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error('A Pluggy retornou HTTP ' + res.status + '. Confira a autorização e as credenciais.');
  return res.json<T>();
}
async function products(key: string, item: string, group: ImportGroup) {
  const endpoint = group === 'investments' ? '/investments' : '/accounts';
  const params = new URLSearchParams({itemId:item});
  if (group !== 'investments') params.set('type', group === 'cards' ? 'CREDIT' : 'BANK');
  const result = [];
  let page = 1;
  while (true) {
    params.set('page',String(page));
    const data = await fetchJson<{results: Source[]; totalPages:number}>(endpoint + '?' + params, {headers:{'X-API-KEY':key}});
    if (!Array.isArray(data.results)) throw new Error('Resposta incompleta da Pluggy. Tente novamente.');
    for (const row of data.results) {
      const value = mapProduct(row, group, item);
      if (value) result.push(value);
    }
    if (page >= (data.totalPages || 1)) return result;
    page++;
  }
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
    const {apiKey} = await fetchJson<{apiKey:string}>('/auth', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:env.PLUGGY_CLIENT_ID,clientSecret:env.PLUGGY_CLIENT_SECRET})});
    if (!apiKey) throw new Error('Credenciais não aceitas pela Pluggy.');
    const statements = [];
    for (const item of prefs.itemIds) {
      const info = await fetchJson<{consentExpiresAt?:string;status?:string}>('/items/'+item,{headers:{'X-API-KEY':apiKey}});
      if ((info.consentExpiresAt && Date.parse(info.consentExpiresAt) <= Date.now()) || ['LOGIN_ERROR','OUTDATED','WAITING_USER_INPUT'].includes(info.status || '')) throw new Error('Revise a autorização da conexão no Meu Pluggy.');
      for (const category of enabled) {
        const rows = await products(apiKey,item,category);
        statements.push(db.prepare('DELETE FROM pluggy_positions WHERE item=? AND category=? AND '+guard).bind(item,category,revision));
        for (const r of rows) statements.push(db.prepare('INSERT OR REPLACE INTO pluggy_positions(id,item,category,payload) SELECT ?,?,?,? WHERE '+guard).bind(r.id,item,category,JSON.stringify(r),revision));
      }
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
  await init(db);
  if (req.method === 'POST' && req.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return errorJson('Use JSON.',415);
  if (path === '/api/pluggy/status' && req.method === 'GET') {
    const cfg = await config(db);
    const result = await db.prepare('SELECT p.category,p.payload,e.id AS excluded FROM pluggy_positions p LEFT JOIN pluggy_excluded e ON e.id=p.id ORDER BY p.category,p.item,p.id').all<{category:ImportGroup;payload:string;excluded:string|null}>();
    return json({ready:ready(env),protectedApp,...cfg, positions:result.results.map(r=>({...JSON.parse(r.payload),category:r.category,excluded:Boolean(r.excluded)}))});
  }
  if (path === '/api/pluggy/preferences' && req.method === 'POST') {
    const body = await parseJsonBody<Preferences>(req);
    if (!body || !Array.isArray(body.itemIds) || body.itemIds.length > 10 || !body.itemIds.every(i=>typeof i==='string' && uuid.test(i)) ||
      ![...groups,'auto' as const].every(g=>typeof body[g]==='boolean')) return errorJson('Informe IDs de conexão válidos e confira as categorias.');
    const prefs:Preferences = {accounts:body.accounts,cards:body.cards,investments:body.investments,auto:body.auto,itemIds:[...new Set(body.itemIds)]};
    // Changing enabled categories freezes their last balances. Removing a connection removes its snapshot.
    await db.batch([
      db.prepare('UPDATE pluggy_config SET prefs=?,revision=revision+1,status=NULL WHERE id=1').bind(JSON.stringify(prefs)),
      db.prepare('DELETE FROM pluggy_positions WHERE item NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(prefs.itemIds)),
    ]);
    return json({ok:true});
  }
  if (path === '/api/pluggy/sync' && req.method==='POST') {
    await syncPluggy(env);
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
