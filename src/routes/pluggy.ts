import type {
  CardPurchase,
  Env,
  ImportGroup,
  PluggyPreferences,
  PluggySyncSummary,
} from '../types';
import { ensureSchema } from '../lib/db';
import {
  addMonths,
  assignStatementKeys,
  extractInstallmentFromText,
  inferCategory,
  isCardPaymentOrRefund,
  normalizeDescription,
  planIncrementalStatementImport,
} from '../lib/dedup';
import { errorJson, json, parseJsonBody } from '../lib/http';

const groups: ImportGroup[] = ['accounts', 'cards', 'investments'];
const defaults: PluggyPreferences = {
  accounts: true,
  cards: false,
  investments: true,
  itemIds: [],
  auto: false,
  syncTransactions: true,
  txDays: 90,
};

type Source = {
  id: string;
  name: string;
  marketingName?: string;
  number?: string;
  currencyCode?: string;
  type?: string;
  balance?: number;
  code?: string;
  subtype?: string;
  institution?: { name?: string };
  creditData?: { creditLimit?: number; balanceDueDate?: string; balanceCloseDate?: string };
};

export type PluggyTransaction = {
  id: string;
  accountId?: string;
  date: string;
  description?: string;
  descriptionRaw?: string;
  amount: number;
  type?: 'DEBIT' | 'CREDIT' | string;
  currencyCode?: string;
  category?: string | null;
  status?: string;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    cardNumber?: string | null;
    billId?: string | null;
    purchaseDate?: string | null;
  } | null;
};

type MappedProduct = {
  id: string;
  pluggyAccountId: string;
  name: string;
  balance?: number;
  color?: string;
  last4?: string;
  institution?: string;
  closeDay?: number | string;
  dueDay?: number | string;
  limit?: number | null;
  bankBalance?: number | null;
  committedLimit?: number | null;
  gross?: number;
  detail?: string;
};

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const ready = (e: Env) => Boolean(e.DB && e.APP_PASSWORD?.trim() && e.PLUGGY_CLIENT_ID && e.PLUGGY_CLIENT_SECRET);

async function runBatched(db: D1Database, stmts: D1PreparedStatement[], chunkSize = 80) {
  let lastResults: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += chunkSize) {
    lastResults = await db.batch(stmts.slice(i, i + chunkSize));
  }
  return lastResults;
}

async function init(db: D1Database) {
  await ensureSchema(db);
  await db.prepare('INSERT OR IGNORE INTO pluggy_config(id,prefs) VALUES(1,?)').bind(JSON.stringify(defaults)).run();
}

async function config(db: D1Database) {
  const row = await db
    .prepare('SELECT * FROM pluggy_config WHERE id=1')
    .first<{ prefs: string; revision: number; last_sync: string | null; status: string | null }>();
  const parsed = row?.prefs ? (JSON.parse(row.prefs) as Partial<PluggyPreferences>) : {};
  const prefs: PluggyPreferences = {
    ...defaults,
    ...parsed,
    itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds : [],
    syncTransactions: parsed.syncTransactions !== false,
    txDays: Math.min(365, Math.max(7, Number(parsed.txDays) || 90)),
  };
  return {
    revision: row?.revision ?? 0,
    last_sync: row?.last_sync ?? null,
    status: row?.status ?? null,
    prefs,
  };
}

function mapProduct(r: Source, group: ImportGroup, item: string): MappedProduct | null {
  if (!r.id || !r.name || (r.currencyCode && r.currencyCode !== 'BRL')) return null;
  const id = 'pluggy_' + item + '_' + r.id;
  const name = r.marketingName || r.name;
  if (group === 'accounts') {
    return r.type === 'BANK' && Number.isFinite(r.balance)
      ? { id, pluggyAccountId: r.id, name, balance: r.balance, color: '#2563eb' }
      : null;
  }
  if (group === 'cards') {
    if (r.type !== 'CREDIT') return null;
    const data = r.creditData;
    const committed = Number.isFinite(r.balance) ? Number(r.balance) : null;
    return {
      id,
      pluggyAccountId: r.id,
      name,
      last4: r.number?.replace(/\D/g, '').slice(-4) || '—',
      institution: r.institution?.name || 'Meu Pluggy',
      closeDay: Number(data?.balanceCloseDate?.slice(8, 10)) || '—',
      dueDay: Number(data?.balanceDueDate?.slice(8, 10)) || '—',
      limit: data?.creditLimit ?? null,
      bankBalance: committed,
      committedLimit: committed,
    };
  }
  if (!Number.isFinite(r.balance)) return null;
  return {
    id,
    pluggyAccountId: r.id,
    name,
    gross: r.balance,
    detail: [r.institution?.name, r.code || r.subtype, r.id.slice(-8)].filter(Boolean).join(' · '),
  };
}

async function fetchJson<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch('https://api.pluggy.ai' + path, { ...options, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('A Pluggy retornou HTTP ' + res.status + '. Confira a autorização e as credenciais.');
  return res.json<T>();
}

async function products(key: string, item: string, group: ImportGroup): Promise<MappedProduct[]> {
  const endpoint = group === 'investments' ? '/investments' : '/accounts';
  const params = new URLSearchParams({ itemId: item });
  if (group !== 'investments') params.set('type', group === 'cards' ? 'CREDIT' : 'BANK');
  const result: MappedProduct[] = [];
  let page = 1;
  while (true) {
    params.set('page', String(page));
    const data = await fetchJson<{ results: Source[]; totalPages?: number }>(endpoint + '?' + params, {
      headers: { 'X-API-KEY': key },
    });
    if (!Array.isArray(data.results)) throw new Error('Resposta incompleta da Pluggy. Tente novamente.');
    for (const row of data.results) {
      const value = mapProduct(row, group, item);
      if (value) result.push(value);
    }
    if (page >= (data.totalPages || 1) || page >= 20) return result;
    page++;
  }
}

export async function fetchAccountTransactions(
  key: string,
  accountId: string,
  from: string,
  to: string,
): Promise<PluggyTransaction[]> {
  const params = new URLSearchParams({
    accountId,
    from,
    to,
    pageSize: '200',
  });
  const result: PluggyTransaction[] = [];
  let page = 1;
  while (true) {
    params.set('page', String(page));
    const data = await fetchJson<{ results?: PluggyTransaction[]; totalPages?: number }>(
      '/transactions?' + params,
      { headers: { 'X-API-KEY': key } },
    );
    if (!Array.isArray(data.results)) break;
    result.push(...data.results);
    if (page >= (data.totalPages || 1) || page >= 25) break;
    page++;
  }
  return result;
}

function formatDateOffset(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Persists Pluggy bank (BANK) and credit card (CREDIT) transactions into D1 with
 * full deduplication by Pluggy transaction ID and deterministic signatures.
 */
export async function ingestPluggyTransactions(
  db: D1Database,
  params: {
    kind: 'bank' | 'card';
    pluggyAccountId: string;
    targetId: string;
    transactions: PluggyTransaction[];
  },
): Promise<{ inserted: number; skipped: number }> {
  const { kind, pluggyAccountId, targetId, transactions } = params;
  if (!transactions.length) return { inserted: 0, skipped: 0 };

  const syncedRows = await db
    .prepare('SELECT pluggy_tx_id FROM pluggy_synced_tx WHERE pluggy_account_id = ?')
    .bind(pluggyAccountId)
    .all<{ pluggy_tx_id: string }>();
  const alreadySynced = new Set((syncedRows.results || []).map((r) => String(r.pluggy_tx_id)));

  if (kind === 'bank') {
    const existingRes = await db
      .prepare('SELECT id, tx_date, description, tx_type, amount, external_id FROM bank_transactions WHERE account_id = ?')
      .bind(targetId)
      .all<{ id: string; tx_date: string; description: string; tx_type: string; amount: number; external_id: string | null }>();

    const existingExternal = new Set<string>();
    const existingManualSigCounts = new Map<string, number>();
    for (const r of existingRes.results || []) {
      if (r.external_id) existingExternal.add(String(r.external_id));
      const cents = Math.round(Math.abs(Number(r.amount) || 0) * 100);
      const sig = `${r.tx_date}|${r.tx_type}|${cents}|${normalizeDescription(r.description)}`;
      existingManualSigCounts.set(sig, (existingManualSigCounts.get(sig) || 0) + 1);
    }

    const stmts: D1PreparedStatement[] = [];
    let inserted = 0;
    let skipped = 0;

    for (const tx of transactions) {
      if (!tx?.id || !tx.date || (tx.currencyCode && tx.currencyCode !== 'BRL')) {
        skipped++;
        continue;
      }
      if (alreadySynced.has(tx.id) || existingExternal.has(tx.id)) {
        skipped++;
        continue;
      }
      const rawAmount = Number(tx.amount);
      if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) < 0.005) {
        skipped++;
        continue;
      }
      const txType: 'income' | 'expense' =
        tx.type === 'CREDIT' ? 'income' : tx.type === 'DEBIT' ? 'expense' : rawAmount >= 0 ? 'income' : 'expense';
      const amount = Math.round(Math.abs(rawAmount) * 100) / 100;
      const txDate = String(tx.date).slice(0, 10);
      if (!isoDate.test(txDate)) {
        skipped++;
        continue;
      }
      const description = String(tx.description || tx.descriptionRaw || 'Movimentação Pluggy').trim();
      const cents = Math.round(amount * 100);
      const sig = `${txDate}|${txType}|${cents}|${normalizeDescription(description)}`;
      const manualMatch = existingManualSigCounts.get(sig) || 0;
      if (manualMatch > 0) {
        // Matches an existing manual entry: mark as synced so we never duplicate it.
        existingManualSigCounts.set(sig, manualMatch - 1);
        alreadySynced.add(tx.id);
        stmts.push(
          db
            .prepare('INSERT OR IGNORE INTO pluggy_synced_tx(pluggy_tx_id, pluggy_account_id, kind, local_id, tx_date) VALUES (?, ?, ?, ?, ?)')
            .bind(tx.id, pluggyAccountId, 'bank', 'manual_match', txDate),
        );
        skipped++;
        continue;
      }

      const localId = 'pgtx_' + tx.id;
      const category = inferCategory(description, tx.category);
      alreadySynced.add(tx.id);
      existingExternal.add(tx.id);

      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO bank_transactions (id, tx_date, description, tx_type, category, account_id, amount, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'pluggy', ?)",
          )
          .bind(localId, txDate, description, txType, category, targetId, amount, tx.id),
        db
          .prepare('INSERT OR IGNORE INTO pluggy_synced_tx(pluggy_tx_id, pluggy_account_id, kind, local_id, tx_date) VALUES (?, ?, ?, ?, ?)')
          .bind(tx.id, pluggyAccountId, 'bank', localId, txDate),
      );
      inserted++;
    }

    if (stmts.length) await runBatched(db, stmts);
    return { inserted, skipped };
  }

  // CREDIT card transactions
  const ownerRow = await db
    .prepare('SELECT id FROM people ORDER BY is_owner DESC, sort_order ASC, created_at ASC LIMIT 1')
    .first<{ id: string }>();
  const defaultOwnerId = ownerRow?.id || 'p_italo';

  const existingPurchasesRes = await db
    .prepare(
      'SELECT id, card_id, purchase_date, start_month, description, category, total_cents, installments, source, external_id, import_key FROM card_purchases WHERE card_id = ?',
    )
    .bind(targetId)
    .all<Record<string, unknown>>();
  const existingStmtRes = await db
    .prepare(
      'SELECT csa.purchase_id, csa.month_key, csa.cents FROM card_statement_amounts csa INNER JOIN card_purchases cp ON cp.id = csa.purchase_id WHERE cp.card_id = ?',
    )
    .bind(targetId)
    .all<{ purchase_id: string; month_key: string; cents: number }>();

  const stmtMap = new Map<string, Record<string, number>>();
  for (const r of existingStmtRes.results || []) {
    const m = stmtMap.get(r.purchase_id) || {};
    m[r.month_key] = Number(r.cents) || 0;
    stmtMap.set(r.purchase_id, m);
  }

  const existingExternal = new Set<string>();
  const existingPurchases: CardPurchase[] = (existingPurchasesRes.results || []).map((r) => {
    if (r.external_id) existingExternal.add(String(r.external_id));
    return {
      id: String(r.id),
      cardId: String(r.card_id),
      date: String(r.purchase_date),
      startMonth: String(r.start_month),
      description: String(r.description),
      category: String(r.category || 'Outros'),
      totalCents: Number(r.total_cents) || 0,
      installments: Number(r.installments) || 1,
      splits: [],
      statementAmounts: stmtMap.get(String(r.id)),
      externalId: r.external_id ? String(r.external_id) : null,
      importKey: r.import_key ? String(r.import_key) : null,
    };
  });

  // Group candidate card purchases by billing month (YYYY-MM) so deterministic occurrence keys work cleanly
  type CandidateCardTx = {
    tx: PluggyTransaction;
    date: string;
    billMonth: string;
    description: string;
    cents: number;
    index: number;
    count: number;
    category: string;
  };

  const byMonth = new Map<string, CandidateCardTx[]>();
  let skipped = 0;

  for (const tx of transactions) {
    if (!tx?.id || !tx.date || (tx.currencyCode && tx.currencyCode !== 'BRL')) {
      skipped++;
      continue;
    }
    if (alreadySynced.has(tx.id) || existingExternal.has(tx.id)) {
      skipped++;
      continue;
    }
    const rawDesc = String(tx.description || tx.descriptionRaw || '').trim();
    if (!rawDesc || isCardPaymentOrRefund(rawDesc)) {
      skipped++;
      continue;
    }
    // On Pluggy credit accounts, CREDIT entries are bill payments / refunds; DEBIT are purchases.
    if (tx.type === 'CREDIT') {
      skipped++;
      continue;
    }
    const rawAmount = Number(tx.amount);
    if (!Number.isFinite(rawAmount)) {
      skipped++;
      continue;
    }
    const cents = Math.round(Math.abs(rawAmount) * 100);
    if (cents <= 0) {
      skipped++;
      continue;
    }

    const postedDate = String(tx.date).slice(0, 10);
    if (!isoDate.test(postedDate)) {
      skipped++;
      continue;
    }
    const billMonth = postedDate.slice(0, 7);
    const meta = tx.creditCardMetadata;
    const purchaseDate =
      meta?.purchaseDate && isoDate.test(String(meta.purchaseDate).slice(0, 10))
        ? String(meta.purchaseDate).slice(0, 10)
        : postedDate;

    const parsedText = extractInstallmentFromText(rawDesc);
    const metaCount = Number(meta?.totalInstallments) || 0;
    const metaIndex = Number(meta?.installmentNumber) || 0;
    const count = metaCount >= 1 && metaCount <= 99 ? metaCount : parsedText.count;
    const index = metaIndex >= 1 && metaIndex <= count ? metaIndex : parsedText.index;
    const description = parsedText.description || rawDesc;
    const category = inferCategory(description, tx.category);

    const list = byMonth.get(billMonth) || [];
    list.push({ tx, date: purchaseDate, billMonth, description, cents, index, count, category });
    byMonth.set(billMonth, list);
  }

  const stmts: D1PreparedStatement[] = [];
  let inserted = 0;

  for (const [billMonth, candidates] of byMonth.entries()) {
    const plan = planIncrementalStatementImport(
      existingPurchases,
      targetId,
      billMonth,
      candidates.map((c) => ({
        date: c.date,
        description: c.description,
        cents: c.cents,
        index: c.index,
        count: c.count,
        category: c.category,
        personId: defaultOwnerId,
      })),
      defaultOwnerId,
    );

    const keyed = assignStatementKeys(
      targetId,
      billMonth,
      candidates.map((c) => ({
        date: c.date,
        description: c.description,
        cents: c.cents,
        index: c.index,
        count: c.count,
      })),
    );

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const item = plan.items[i];
      const key = keyed[i].importKey;

      if (item.duplicate) {
        alreadySynced.add(cand.tx.id);
        stmts.push(
          db
            .prepare('INSERT OR IGNORE INTO pluggy_synced_tx(pluggy_tx_id, pluggy_account_id, kind, local_id, tx_date) VALUES (?, ?, ?, ?, ?)')
            .bind(cand.tx.id, pluggyAccountId, 'card', item.matchedPurchaseId || 'existing', cand.date),
        );
        skipped++;
        continue;
      }

      const localId = 'pgcp_' + cand.tx.id;
      const totalCents = cand.cents * cand.count;
      const startMonth = addMonths(billMonth, 1 - cand.index);
      alreadySynced.add(cand.tx.id);
      existingExternal.add(cand.tx.id);

      const created: CardPurchase = {
        id: localId,
        cardId: targetId,
        date: cand.date,
        startMonth,
        description: cand.description,
        category: cand.category,
        totalCents,
        installments: cand.count,
        splits: [{ personId: defaultOwnerId, cents: totalCents }],
        statementAmounts: { [billMonth]: cand.cents },
        source: 'pluggy',
        externalId: cand.tx.id,
        importKey: key,
      };
      existingPurchases.push(created);

      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO card_purchases (id, card_id, purchase_date, start_month, description, category, total_cents, installments, source, external_id, import_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pluggy', ?, ?)",
          )
          .bind(
            localId,
            targetId,
            cand.date,
            startMonth,
            cand.description,
            cand.category,
            totalCents,
            cand.count,
            cand.tx.id,
            key,
          ),
        db
          .prepare('INSERT OR REPLACE INTO card_statement_amounts (purchase_id, month_key, cents) VALUES (?, ?, ?)')
          .bind(localId, billMonth, cand.cents),
        db
          .prepare('INSERT INTO card_purchase_splits (purchase_id, person_id, cents) VALUES (?, ?, ?)')
          .bind(localId, defaultOwnerId, totalCents),
        db
          .prepare('INSERT OR IGNORE INTO pluggy_synced_tx(pluggy_tx_id, pluggy_account_id, kind, local_id, tx_date) VALUES (?, ?, ?, ?, ?)')
          .bind(cand.tx.id, pluggyAccountId, 'card', localId, cand.date),
      );
      inserted++;
    }
  }

  if (stmts.length) await runBatched(db, stmts);
  return { inserted, skipped };
}

async function applyLinkedPositionsToManualRecords(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT p.id, p.category, p.payload, l.target_id, e.id AS excluded
       FROM pluggy_positions p
       INNER JOIN pluggy_links l ON l.pluggy_id = p.id AND l.category = p.category
       LEFT JOIN pluggy_excluded e ON e.id = p.id`,
    )
    .all<{ id: string; category: ImportGroup; payload: string; target_id: string; excluded: string | null }>();

  const stmts: D1PreparedStatement[] = [];
  for (const row of rows.results || []) {
    if (row.excluded) continue;
    const payload = JSON.parse(row.payload) as MappedProduct;
    if (row.category === 'accounts' && Number.isFinite(payload.balance)) {
      stmts.push(
        db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').bind(Number(payload.balance), row.target_id),
      );
    } else if (row.category === 'investments' && Number.isFinite(payload.gross)) {
      stmts.push(
        db.prepare('UPDATE investments SET gross = ? WHERE id = ?').bind(Number(payload.gross), row.target_id),
      );
    } else if (row.category === 'cards' && Number.isFinite(payload.limit) && Number(payload.limit) > 0) {
      stmts.push(
        db.prepare('UPDATE cards SET credit_limit = ? WHERE id = ?').bind(Number(payload.limit), row.target_id),
      );
    }
  }
  if (stmts.length) await runBatched(db, stmts);
}

export async function syncPluggy(
  env: Env,
  scheduled = false,
  opts?: { from?: string; to?: string; days?: number; syncTransactions?: boolean },
): Promise<PluggySyncSummary | undefined> {
  if (!ready(env)) {
    if (scheduled) return;
    throw new Error('Configure os secrets da integração no Worker.');
  }
  const db = env.DB!;
  await init(db);
  const { prefs, revision } = await config(db);
  const enabled = groups.filter((g) => prefs[g]);
  if (scheduled && !prefs.auto) return;
  if (!prefs.itemIds.length || !enabled.length) {
    if (scheduled) return;
    throw new Error('Salve uma conexão e selecione uma categoria.');
  }

  const guard = 'EXISTS (SELECT 1 FROM pluggy_config WHERE id=1 AND revision=?)';
  const summary: PluggySyncSummary = {
    accounts: 0,
    cards: 0,
    investments: 0,
    newBankTx: 0,
    skippedBankTx: 0,
    newCardPurchases: 0,
    skippedCardPurchases: 0,
  };

  try {
    const { apiKey } = await fetchJson<{ apiKey: string }>('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET }),
    });
    if (!apiKey) throw new Error('Credenciais não aceitas pela Pluggy.');

    const statements: D1PreparedStatement[] = [];
    const fetchedByGroup: Record<ImportGroup, MappedProduct[]> = {
      accounts: [],
      cards: [],
      investments: [],
    };

    for (const item of prefs.itemIds) {
      const info = await fetchJson<{ consentExpiresAt?: string; status?: string }>('/items/' + item, {
        headers: { 'X-API-KEY': apiKey },
      });
      if (
        (info.consentExpiresAt && Date.parse(info.consentExpiresAt) <= Date.now()) ||
        ['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT'].includes(info.status || '')
      ) {
        throw new Error('Revise a autorização da conexão no Meu Pluggy.');
      }
      for (const category of enabled) {
        const rows = await products(apiKey, item, category);
        fetchedByGroup[category].push(...rows);
        summary[category] += rows.length;
        statements.push(
          db.prepare('DELETE FROM pluggy_positions WHERE item=? AND category=? AND ' + guard).bind(item, category, revision),
        );
        for (const r of rows) {
          statements.push(
            db
              .prepare('INSERT OR REPLACE INTO pluggy_positions(id,item,category,payload) SELECT ?,?,?,? WHERE ' + guard)
              .bind(r.id, item, category, JSON.stringify(r), revision),
          );
        }
      }
    }

    statements.push(
      db
        .prepare('UPDATE pluggy_config SET revision=revision+1,last_sync=?,status=NULL WHERE id=1 AND revision=?')
        .bind(new Date().toISOString(), revision),
    );
    const results = await db.batch(statements);
    if (!results.at(-1)?.meta.changes) throw new Error('A configuração mudou. Sincronize novamente.');

    // Apply synced balances to linked manual accounts/cards/investments (no duplicate totals).
    await applyLinkedPositionsToManualRecords(db);

    // Fetch individual transactions for enabled, non-excluded bank accounts & credit cards.
    const shouldSyncTx = opts?.syncTransactions ?? prefs.syncTransactions;
    if (shouldSyncTx) {
      const days = Math.min(365, Math.max(7, Number(opts?.days) || prefs.txDays || 90));
      const from = opts?.from && isoDate.test(opts.from) ? opts.from : formatDateOffset(days);
      const to = opts?.to && isoDate.test(opts.to) ? opts.to : formatDateOffset(0);

      const [linksRes, exclRes] = await db.batch([
        db.prepare('SELECT pluggy_id, category, target_id FROM pluggy_links'),
        db.prepare('SELECT id FROM pluggy_excluded'),
      ]);
      const linkMap = new Map<string, string>();
      for (const l of (linksRes.results as Array<{ pluggy_id: string; target_id: string }>) || []) {
        linkMap.set(l.pluggy_id, l.target_id);
      }
      const excludedSet = new Set(
        ((exclRes.results as Array<{ id: string }>) || []).map((r) => String(r.id)),
      );

      for (const acc of fetchedByGroup.accounts) {
        if (excludedSet.has(acc.id) || !acc.pluggyAccountId) continue;
        const targetAccountId = linkMap.get(acc.id) || acc.id;
        const txs = await fetchAccountTransactions(apiKey, acc.pluggyAccountId, from, to);
        const res = await ingestPluggyTransactions(db, {
          kind: 'bank',
          pluggyAccountId: acc.pluggyAccountId,
          targetId: targetAccountId,
          transactions: txs,
        });
        summary.newBankTx += res.inserted;
        summary.skippedBankTx += res.skipped;
      }

      for (const card of fetchedByGroup.cards) {
        if (excludedSet.has(card.id) || !card.pluggyAccountId) continue;
        const targetCardId = linkMap.get(card.id) || card.id;
        const txs = await fetchAccountTransactions(apiKey, card.pluggyAccountId, from, to);
        const res = await ingestPluggyTransactions(db, {
          kind: 'card',
          pluggyAccountId: card.pluggyAccountId,
          targetId: targetCardId,
          transactions: txs,
        });
        summary.newCardPurchases += res.inserted;
        summary.skippedCardPurchases += res.skipped;
      }
    }

    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha ao atualizar a conexão.';
    await db.prepare('UPDATE pluggy_config SET status=? WHERE id=1 AND revision=?').bind(message, revision).run();
    throw e;
  }
}

export async function pluggyRoute(req: Request, env: Env, path: string) {
  if (!path.startsWith('/api/pluggy/')) return null;
  const protectedApp = Boolean(env.APP_PASSWORD?.trim());
  if (!protectedApp || !env.DB) {
    if (path.endsWith('/status') && req.method === 'GET') {
      return json({
        ready: false,
        protectedApp,
        prefs: defaults,
        positions: [],
        links: {},
        syncedTxCounts: { bank: 0, card: 0 },
      });
    }
    return errorJson('Configure APP_PASSWORD e o banco D1 no Worker antes de vincular a conta.', 403);
  }
  const db = env.DB;
  await init(db);

  if (req.method === 'POST' && req.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
    return errorJson('Use JSON.', 415);
  }

  if (path === '/api/pluggy/status' && req.method === 'GET') {
    const cfg = await config(db);
    const [posRes, txCountsRes] = await db.batch([
      db.prepare(
        `SELECT p.id, p.item, p.category, p.payload, e.id AS excluded, l.target_id AS linked_target_id
         FROM pluggy_positions p
         LEFT JOIN pluggy_excluded e ON e.id = p.id
         LEFT JOIN pluggy_links l ON l.pluggy_id = p.id AND l.category = p.category
         ORDER BY p.category, p.item, p.id`,
      ),
      db.prepare('SELECT kind, COUNT(*) AS cnt FROM pluggy_synced_tx GROUP BY kind'),
    ]);

    const links: Record<string, string> = {};
    const positions = ((posRes.results as Array<{
      id: string;
      item: string;
      category: ImportGroup;
      payload: string;
      excluded: string | null;
      linked_target_id: string | null;
    }>) || []).map((r) => {
      const payload = JSON.parse(r.payload) as Record<string, unknown>;
      if (r.linked_target_id) links[r.id] = r.linked_target_id;
      return {
        ...payload,
        id: r.id,
        item: r.item,
        category: r.category,
        excluded: Boolean(r.excluded),
        linkedTargetId: r.linked_target_id || null,
      };
    });

    const syncedTxCounts = { bank: 0, card: 0 };
    for (const row of (txCountsRes.results as Array<{ kind: string; cnt: number }>) || []) {
      if (row.kind === 'bank') syncedTxCounts.bank = Number(row.cnt) || 0;
      if (row.kind === 'card') syncedTxCounts.card = Number(row.cnt) || 0;
    }

    return json({
      ready: ready(env),
      protectedApp,
      ...cfg,
      positions,
      links,
      syncedTxCounts,
    });
  }

  if (path === '/api/pluggy/preferences' && req.method === 'POST') {
    const body = await parseJsonBody<Partial<PluggyPreferences>>(req);
    if (
      !body ||
      !Array.isArray(body.itemIds) ||
      body.itemIds.length > 10 ||
      !body.itemIds.every((i) => typeof i === 'string' && uuid.test(i)) ||
      ![...groups, 'auto' as const].every((g) => typeof body[g] === 'boolean')
    ) {
      return errorJson('Informe IDs de conexão válidos e confira as categorias.');
    }
    const prefs: PluggyPreferences = {
      accounts: Boolean(body.accounts),
      cards: Boolean(body.cards),
      investments: Boolean(body.investments),
      auto: Boolean(body.auto),
      itemIds: [...new Set(body.itemIds)],
      syncTransactions: body.syncTransactions !== false,
      txDays: Math.min(365, Math.max(7, Number(body.txDays) || 90)),
    };
    await db.batch([
      db
        .prepare('UPDATE pluggy_config SET prefs=?,revision=revision+1,status=NULL WHERE id=1')
        .bind(JSON.stringify(prefs)),
      db
        .prepare('DELETE FROM pluggy_positions WHERE item NOT IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(prefs.itemIds)),
      db.prepare('DELETE FROM pluggy_links WHERE pluggy_id NOT IN (SELECT id FROM pluggy_positions)'),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/pluggy/sync' && req.method === 'POST') {
    const body = (await parseJsonBody<{ from?: string; to?: string; days?: number; syncTransactions?: boolean }>(req)) || {};
    const summary = await syncPluggy(env, false, body);
    return json({ ok: true, summary });
  }

  if (path === '/api/pluggy/inclusion' && req.method === 'POST') {
    const body = await parseJsonBody<{ id: string; included: boolean }>(req);
    if (!body || typeof body.included !== 'boolean' || typeof body.id !== 'string') {
      return errorJson('Posição inválida.');
    }
    const row = await db
      .prepare('SELECT id, category FROM pluggy_positions WHERE id = ?')
      .bind(body.id)
      .first<{ id: string; category: ImportGroup }>();
    if (!row) return errorJson('Item do Meu Pluggy não encontrado.', 404);

    await (body.included
      ? db.prepare('DELETE FROM pluggy_excluded WHERE id = ?')
      : db.prepare('INSERT OR IGNORE INTO pluggy_excluded(id) VALUES (?)')
    )
      .bind(body.id)
      .run();

    if (body.included) {
      await applyLinkedPositionsToManualRecords(db);
    }

    return json({ ok: true, id: body.id, included: body.included });
  }

  if (path === '/api/pluggy/link' && req.method === 'POST') {
    const body = await parseJsonBody<{ pluggyId: string; targetId: string | null }>(req);
    if (!body || typeof body.pluggyId !== 'string') {
      return errorJson('Informe o item do Pluggy para vincular.');
    }
    const pos = await db
      .prepare('SELECT id, category, payload FROM pluggy_positions WHERE id = ?')
      .bind(body.pluggyId)
      .first<{ id: string; category: ImportGroup; payload: string }>();
    if (!pos) return errorJson('Item do Meu Pluggy não encontrado.', 404);

    const targetId = typeof body.targetId === 'string' && body.targetId.trim() ? body.targetId.trim() : null;

    if (!targetId) {
      await db.prepare('DELETE FROM pluggy_links WHERE pluggy_id = ?').bind(pos.id).run();
      return json({ ok: true, pluggyId: pos.id, targetId: null, migratedCount: 0 });
    }

    const tableByCategory: Record<ImportGroup, string> = {
      accounts: 'accounts',
      cards: 'cards',
      investments: 'investments',
    };
    const table = tableByCategory[pos.category];
    const targetExists = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(targetId).first<{ id: string }>();
    if (!targetExists) {
      return errorJson('Cadastro manual de destino não encontrado.', 404);
    }

    const payload = JSON.parse(pos.payload) as MappedProduct;
    const isExcluded = Boolean(
      await db.prepare('SELECT id FROM pluggy_excluded WHERE id = ?').bind(pos.id).first(),
    );

    const stmts: D1PreparedStatement[] = [
      // Keep 1:1 mapping per manual target within category
      db.prepare('DELETE FROM pluggy_links WHERE category = ? AND target_id = ?').bind(pos.category, targetId),
      db
        .prepare("INSERT OR REPLACE INTO pluggy_links (pluggy_id, category, target_id, updated_at) VALUES (?, ?, ?, datetime('now'))")
        .bind(pos.id, pos.category, targetId),
    ];

    let migratedCount = 0;

    if (pos.category === 'accounts') {
      if (!isExcluded && Number.isFinite(payload.balance)) {
        stmts.push(db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').bind(Number(payload.balance), targetId));
      }
      const migRes = await db
        .prepare('SELECT COUNT(*) AS c FROM bank_transactions WHERE account_id = ?')
        .bind(pos.id)
        .first<{ c: number }>();
      migratedCount = Number(migRes?.c) || 0;
      if (migratedCount > 0) {
        stmts.push(db.prepare('UPDATE bank_transactions SET account_id = ? WHERE account_id = ?').bind(targetId, pos.id));
      }
    } else if (pos.category === 'cards') {
      if (!isExcluded && Number.isFinite(payload.limit) && Number(payload.limit) > 0) {
        stmts.push(db.prepare('UPDATE cards SET credit_limit = ? WHERE id = ?').bind(Number(payload.limit), targetId));
      }
      const migRes = await db
        .prepare('SELECT COUNT(*) AS c FROM card_purchases WHERE card_id = ?')
        .bind(pos.id)
        .first<{ c: number }>();
      migratedCount = Number(migRes?.c) || 0;
      if (migratedCount > 0) {
        stmts.push(db.prepare('UPDATE card_purchases SET card_id = ? WHERE card_id = ?').bind(targetId, pos.id));
      }
    } else if (pos.category === 'investments') {
      if (!isExcluded && Number.isFinite(payload.gross)) {
        stmts.push(db.prepare('UPDATE investments SET gross = ? WHERE id = ?').bind(Number(payload.gross), targetId));
      }
    }

    await db.batch(stmts);
    return json({ ok: true, pluggyId: pos.id, targetId, migratedCount });
  }

  return errorJson('Rota de importação não encontrada.', 404);
}
