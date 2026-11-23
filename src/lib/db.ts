import type {
  Account,
  BankTransaction,
  Card,
  CardPurchase,
  FinancialState,
  FixedIncome,
  Investment,
  MarketRates,
  Person,
  PersonEvent,
} from '../types';

let schemaInitialized = false;

export function resetSchemaCacheForTests(): void {
  schemaInitialized = false;
}

export function getDefaultState(): FinancialState {
  return {
    theme: 'dark',
    monthlyBudgetCap: 0,
    marketRates: { cdi: 13.65, ipca: 4.5, irRate: 0.175 },
    accounts: [], cards: [], people: [], cardPurchases: [], personEvents: [],
    fixedIncomes: [], bankTransactions: [], investments: [],
  };
}

async function ensureColumns(
  db: D1Database,
  table: string,
  columns: Array<{ name: string; definition: string }>,
): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const existing = new Set((info.results || []).map((r) => String(r.name)));
  const alters: D1PreparedStatement[] = [];
  for (const col of columns) {
    if (!existing.has(col.name)) {
      alters.push(db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.definition}`));
    }
  }
  if (alters.length) {
    await db.batch(alters);
  }
}

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#3B82F6', include_in_cash INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, institution TEXT NOT NULL DEFAULT 'Manual', last4 TEXT NOT NULL DEFAULT '0000', credit_limit REAL NOT NULL DEFAULT 0, close_day INTEGER NOT NULL DEFAULT 1, due_day INTEGER NOT NULL DEFAULT 10, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Família', is_owner INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS card_purchases (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, purchase_date TEXT NOT NULL, start_month TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros', total_cents INTEGER NOT NULL DEFAULT 0, installments INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT, import_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS card_statement_amounts (purchase_id TEXT NOT NULL, month_key TEXT NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (purchase_id, month_key))`,
    `CREATE TABLE IF NOT EXISTS card_purchase_splits (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, person_id TEXT NOT NULL, cents INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS person_events (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, month_key TEXT NOT NULL, event_type TEXT NOT NULL, cents INTEGER NOT NULL DEFAULT 0, event_date TEXT NOT NULL, account_id TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS fixed_incomes (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, pay_day INTEGER NOT NULL DEFAULT 5, account_id TEXT NOT NULL, received_months_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS bank_transactions (id TEXT PRIMARY KEY, tx_date TEXT NOT NULL, description TEXT NOT NULL, tx_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros', account_id TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS investments (id TEXT PRIMARY KEY, name TEXT NOT NULL, rate_type TEXT NOT NULL DEFAULT 'CDI', rate_val REAL NOT NULL DEFAULT 100, tax_free INTEGER NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, device_name TEXT NOT NULL DEFAULT 'Navegador', created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pluggy_config (id INTEGER PRIMARY KEY, prefs TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, last_sync TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS pluggy_positions (id TEXT PRIMARY KEY, item TEXT NOT NULL, category TEXT NOT NULL, payload TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pluggy_excluded (id TEXT PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS pluggy_links (pluggy_id TEXT PRIMARY KEY, category TEXT NOT NULL, target_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS pluggy_synced_tx (pluggy_tx_id TEXT PRIMARY KEY, pluggy_account_id TEXT NOT NULL, kind TEXT NOT NULL, local_id TEXT NOT NULL, tx_date TEXT NOT NULL, synced_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  await db.batch(ddl.map((sql) => db.prepare(sql)));

  // Safely upgrade pre-existing tables without dropping or altering existing user data.
  await ensureColumns(db, 'accounts', [
    { name: 'include_in_cash', definition: 'INTEGER NOT NULL DEFAULT 1' },
  ]);
  await ensureColumns(db, 'bank_transactions', [
    { name: 'source', definition: "TEXT NOT NULL DEFAULT 'manual'" },
    { name: 'external_id', definition: 'TEXT' },
  ]);
  await ensureColumns(db, 'card_purchases', [
    { name: 'source', definition: "TEXT NOT NULL DEFAULT 'manual'" },
    { name: 'external_id', definition: 'TEXT' },
    { name: 'import_key', definition: 'TEXT' },
  ]);

  await db.batch([
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pluggy_links_target ON pluggy_links(category, target_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pluggy_synced_tx_local ON pluggy_synced_tx(kind, local_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_bank_tx_external ON bank_transactions(external_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_card_purchases_external ON card_purchases(external_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_card_purchases_import_key ON card_purchases(import_key)'),
  ]);

  // A single D1 transaction clears the old dataset once, including during concurrent cold starts.
  const tables = ['card_purchase_splits', 'card_statement_amounts', 'card_purchases', 'person_events',
    'bank_transactions', 'fixed_incomes', 'investments', 'cards', 'accounts', 'people', 'app_settings'];
  const guard = "NOT EXISTS (SELECT 1 FROM workspace_migrations WHERE id = 'fresh-start-20261121')";
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS workspace_migrations (id TEXT PRIMARY KEY)'),
    ...tables.map(table => db.prepare(`DELETE FROM ${table} WHERE ${guard}`)),
    db.prepare("INSERT OR IGNORE INTO workspace_migrations(id) VALUES ('fresh-start-20261121')"),
  ]);

  schemaInitialized = true;
}

export async function loadFullState(db: D1Database): Promise<FinancialState> {
  await ensureSchema(db);

  const [
    settingsRes,
    accountsRes,
    cardsRes,
    peopleRes,
    purchasesRes,
    splitsRes,
    eventsRes,
    fixedRes,
    bankRes,
    invRes,
    statementRes,
  ] = await db.batch([
    db.prepare('SELECT key, value FROM app_settings'),
    db.prepare('SELECT id, name, balance, color, include_in_cash FROM accounts ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, name, institution, last4, credit_limit, close_day, due_day FROM cards ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, name, role, is_owner FROM people ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, card_id, purchase_date, start_month, description, category, total_cents, installments, source, external_id, import_key FROM card_purchases ORDER BY purchase_date DESC, created_at DESC'),
    db.prepare('SELECT purchase_id, person_id, cents FROM card_purchase_splits ORDER BY id ASC'),
    db.prepare('SELECT id, person_id, month_key, event_type, cents, event_date, account_id, note FROM person_events ORDER BY event_date DESC'),
    db.prepare('SELECT id, title, amount, pay_day, account_id, received_months_json FROM fixed_incomes ORDER BY pay_day ASC'),
    db.prepare('SELECT id, tx_date, description, tx_type, category, account_id, amount, source, external_id FROM bank_transactions ORDER BY tx_date DESC'),
    db.prepare('SELECT id, name, rate_type, rate_val, tax_free, gross FROM investments ORDER BY gross DESC'),
    db.prepare('SELECT purchase_id, month_key, cents FROM card_statement_amounts'),
  ]);

  const settingsMap = new Map<string, string>();
  for (const row of (settingsRes.results as Array<{ key: string; value: string }>) || []) {
    settingsMap.set(row.key, row.value);
  }

  let marketRates: MarketRates = { cdi: 13.65, ipca: 4.5, irRate: 0.175 };
  try {
    const rawRates = settingsMap.get('marketRates');
    if (rawRates) marketRates = JSON.parse(rawRates) as MarketRates;
  } catch {
    // mantém taxas padrão
  }

  const splitsByPurchase = new Map<string, Array<{ personId: string; cents: number }>>();
  for (const row of (splitsRes.results as Array<{ purchase_id: string; person_id: string; cents: number }>) || []) {
    const list = splitsByPurchase.get(row.purchase_id) || [];
    list.push({ personId: row.person_id, cents: Number(row.cents) || 0 });
    splitsByPurchase.set(row.purchase_id, list);
  }

  const accounts: Account[] = ((accountsRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    balance: Number(r.balance) || 0,
    color: String(r.color || '#3B82F6'),
    includeInCash: r.include_in_cash === undefined || r.include_in_cash === null ? true : Boolean(Number(r.include_in_cash)),
  }));

  const cards: Card[] = ((cardsRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    institution: String(r.institution || 'Manual'),
    last4: String(r.last4 || '0000'),
    limit: Number(r.credit_limit) || 0,
    closeDay: Number(r.close_day) || 1,
    dueDay: Number(r.due_day) || 10,
  }));

  const people: Person[] = ((peopleRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    role: String(r.role || 'Família'),
    isOwner: Boolean(r.is_owner),
  }));

  const statements = new Map<string, Record<string, number>>();
  for (const row of (statementRes.results as Array<{ purchase_id: string; month_key: string; cents: number }>) || []) {
    const months = statements.get(row.purchase_id) || {};
    months[row.month_key] = Number(row.cents) || 0;
    statements.set(row.purchase_id, months);
  }

  const cardPurchases: CardPurchase[] = ((purchasesRes.results as Array<Record<string, unknown>>) || []).map((r) => {
    const rawSource = String(r.source || 'manual');
    const source: CardPurchase['source'] =
      rawSource === 'pluggy' ? 'pluggy' : rawSource === 'statement' ? 'statement' : 'manual';
    return {
      id: String(r.id),
      cardId: String(r.card_id),
      date: String(r.purchase_date),
      startMonth: String(r.start_month),
      description: String(r.description),
      category: String(r.category || 'Outros'),
      totalCents: Number(r.total_cents) || 0,
      installments: Number(r.installments) || 1,
      statementAmounts: statements.get(String(r.id)),
      splits: splitsByPurchase.get(String(r.id)) || [],
      source,
      externalId: r.external_id ? String(r.external_id) : null,
      importKey: r.import_key ? String(r.import_key) : null,
    };
  });

  const personEvents: PersonEvent[] = ((eventsRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    personId: String(r.person_id),
    month: String(r.month_key),
    type: (String(r.event_type) as PersonEvent['type']) || 'repayment',
    cents: Number(r.cents) || 0,
    date: String(r.event_date),
    accountId: r.account_id ? String(r.account_id) : null,
    note: String(r.note || ''),
  }));

  const fixedIncomes: FixedIncome[] = ((fixedRes.results as Array<Record<string, unknown>>) || []).map((r) => {
    let receivedMonths: Record<string, boolean> = {};
    try {
      receivedMonths = JSON.parse(String(r.received_months_json || '{}')) as Record<string, boolean>;
    } catch {
      receivedMonths = {};
    }
    return {
      id: String(r.id),
      title: String(r.title),
      amount: Number(r.amount) || 0,
      payDay: Number(r.pay_day) || 5,
      accountId: String(r.account_id),
      receivedMonths,
    };
  });

  const bankTransactions: BankTransaction[] = ((bankRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    date: String(r.tx_date),
    description: String(r.description),
    type: String(r.tx_type) === 'income' ? 'income' : 'expense',
    category: String(r.category || 'Outros'),
    accountId: String(r.account_id),
    amount: Number(r.amount) || 0,
    source: String(r.source || 'manual') === 'pluggy' ? 'pluggy' : 'manual',
    externalId: r.external_id ? String(r.external_id) : null,
  }));

  const investments: Investment[] = ((invRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    rateType: (String(r.rate_type) as Investment['rateType']) || 'CDI',
    rateVal: Number(r.rate_val) || 100,
    taxFree: Boolean(r.tax_free),
    gross: Number(r.gross) || 0,
  }));

  return {
    theme: settingsMap.get('theme') === 'light' ? 'light' : 'dark',
    monthlyBudgetCap: Number(settingsMap.get('monthlyBudgetCap')) || 0,
    marketRates,
    accounts,
    cards,
    people,
    cardPurchases,
    personEvents,
    fixedIncomes,
    bankTransactions,
    investments,
  };
}

export async function saveFullState(db: D1Database, state: FinancialState): Promise<void> {
  await ensureSchema(db);
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM card_purchase_splits'),
    db.prepare('DELETE FROM card_purchases'),
    db.prepare('DELETE FROM person_events'),
    db.prepare('DELETE FROM fixed_incomes'),
    db.prepare('DELETE FROM bank_transactions'),
    db.prepare('DELETE FROM investments'),
    db.prepare('DELETE FROM cards'),
    db.prepare('DELETE FROM people'),
    db.prepare('DELETE FROM accounts'),
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('theme', ?, datetime('now'))"
    ).bind(state.theme === 'light' ? 'light' : 'dark'),
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('monthlyBudgetCap', ?, datetime('now'))"
    ).bind(String(Number(state.monthlyBudgetCap) || 0)),
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('marketRates', ?, datetime('now'))"
    ).bind(JSON.stringify(state.marketRates || { cdi: 13.65, ipca: 4.5, irRate: 0.175 })),
  ];

  (state.accounts || []).forEach((a, idx) => {
    stmts.push(
      db.prepare(
        'INSERT INTO accounts (id, name, balance, color, include_in_cash, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        a.id,
        a.name,
        Number(a.balance) || 0,
        a.color || '#3B82F6',
        a.includeInCash === false ? 0 : 1,
        idx + 1,
      )
    );
  });

  (state.cards || []).forEach((c, idx) => {
    stmts.push(
      db.prepare(
        'INSERT INTO cards (id, name, institution, last4, credit_limit, close_day, due_day, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(c.id, c.name, c.institution || 'Manual', c.last4 || '0000', Number(c.limit) || 0, Number(c.closeDay) || 1, Number(c.dueDay) || 10, idx + 1)
    );
  });

  (state.people || []).forEach((p, idx) => {
    stmts.push(
      db.prepare(
        'INSERT INTO people (id, name, role, is_owner, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).bind(p.id, p.name, p.role || 'Família', p.isOwner ? 1 : 0, idx + 1)
    );
  });

  (state.cardPurchases || []).forEach((cp) => {
    const source = cp.source === 'pluggy' ? 'pluggy' : cp.source === 'statement' ? 'statement' : 'manual';
    stmts.push(
      db.prepare(
        'INSERT INTO card_purchases (id, card_id, purchase_date, start_month, description, category, total_cents, installments, source, external_id, import_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        cp.id,
        cp.cardId,
        cp.date,
        cp.startMonth,
        cp.description,
        cp.category || 'Outros',
        Math.round(Number(cp.totalCents) || 0),
        Math.max(1, Number(cp.installments) || 1),
        source,
        cp.externalId || null,
        cp.importKey || null,
      )
    );
    for (const [month, cents] of Object.entries(cp.statementAmounts || {})) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number.isSafeInteger(cents) && cents > 0) {
        stmts.push(db.prepare('INSERT OR REPLACE INTO card_statement_amounts (purchase_id, month_key, cents) VALUES (?, ?, ?)').bind(cp.id, month, cents));
      }
    }
    (cp.splits || []).forEach((sp) => {
      stmts.push(
        db.prepare(
          'INSERT INTO card_purchase_splits (purchase_id, person_id, cents) VALUES (?, ?, ?)'
        ).bind(cp.id, sp.personId, Math.round(Number(sp.cents) || 0))
      );
    });
  });

  (state.personEvents || []).forEach((ev) => {
    stmts.push(
      db.prepare(
        'INSERT INTO person_events (id, person_id, month_key, event_type, cents, event_date, account_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(ev.id, ev.personId, ev.month, ev.type, Math.round(Number(ev.cents) || 0), ev.date, ev.accountId || null, ev.note || '')
    );
  });

  (state.fixedIncomes || []).forEach((fi) => {
    stmts.push(
      db.prepare(
        'INSERT INTO fixed_incomes (id, title, amount, pay_day, account_id, received_months_json) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(fi.id, fi.title, Number(fi.amount) || 0, Number(fi.payDay) || 5, fi.accountId, JSON.stringify(fi.receivedMonths || {}))
    );
  });

  (state.bankTransactions || []).forEach((bt) => {
    const source = bt.source === 'pluggy' ? 'pluggy' : 'manual';
    stmts.push(
      db.prepare(
        'INSERT INTO bank_transactions (id, tx_date, description, tx_type, category, account_id, amount, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        bt.id,
        bt.date,
        bt.description,
        bt.type === 'income' ? 'income' : 'expense',
        bt.category || 'Outros',
        bt.accountId,
        Number(bt.amount) || 0,
        source,
        bt.externalId || null,
      )
    );
  });

  (state.investments || []).forEach((inv) => {
    stmts.push(
      db.prepare(
        'INSERT INTO investments (id, name, rate_type, rate_val, tax_free, gross) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(inv.id, inv.name, inv.rateType || 'CDI', Number(inv.rateVal) || 100, inv.taxFree ? 1 : 0, Number(inv.gross) || 0)
    );
  });

  stmts.push(db.prepare('DELETE FROM card_statement_amounts WHERE purchase_id NOT IN (SELECT id FROM card_purchases)'));
  await db.batch(stmts);
}

export async function insertCardPurchasesIncremental(
  db: D1Database,
  purchases: CardPurchase[],
): Promise<void> {
  if (!purchases.length) return;
  await ensureSchema(db);
  const stmts: D1PreparedStatement[] = [];
  for (const cp of purchases) {
    const source = cp.source === 'pluggy' ? 'pluggy' : cp.source === 'statement' ? 'statement' : 'manual';
    stmts.push(
      db.prepare(
        'INSERT OR IGNORE INTO card_purchases (id, card_id, purchase_date, start_month, description, category, total_cents, installments, source, external_id, import_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        cp.id,
        cp.cardId,
        cp.date,
        cp.startMonth,
        cp.description,
        cp.category || 'Outros',
        Math.round(Number(cp.totalCents) || 0),
        Math.max(1, Number(cp.installments) || 1),
        source,
        cp.externalId || null,
        cp.importKey || null,
      )
    );
    for (const [month, cents] of Object.entries(cp.statementAmounts || {})) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number.isSafeInteger(cents) && cents > 0) {
        stmts.push(
          db.prepare('INSERT OR REPLACE INTO card_statement_amounts (purchase_id, month_key, cents) VALUES (?, ?, ?)').bind(cp.id, month, cents)
        );
      }
    }
    for (const sp of cp.splits || []) {
      stmts.push(
        db.prepare('INSERT INTO card_purchase_splits (purchase_id, person_id, cents) VALUES (?, ?, ?)').bind(
          cp.id,
          sp.personId,
          Math.round(Number(sp.cents) || 0),
        )
      );
    }
  }
  await db.batch(stmts);
}

export async function getDbStats(db: D1Database): Promise<Record<string, number>> {
  await ensureSchema(db);
  const [acc, cards, people, purchases, tx, inv] = await db.batch([
    db.prepare('SELECT COUNT(*) as c FROM accounts'),
    db.prepare('SELECT COUNT(*) as c FROM cards'),
    db.prepare('SELECT COUNT(*) as c FROM people'),
    db.prepare('SELECT COUNT(*) as c FROM card_purchases'),
    db.prepare('SELECT COUNT(*) as c FROM bank_transactions'),
    db.prepare('SELECT COUNT(*) as c FROM investments'),
  ]);
  const pick = (r: D1Result) => Number((r.results?.[0] as { c?: number } | undefined)?.c || 0);
  return {
    accounts: pick(acc),
    cards: pick(cards),
    people: pick(people),
    cardPurchases: pick(purchases),
    bankTransactions: pick(tx),
    investments: pick(inv),
  };
}
