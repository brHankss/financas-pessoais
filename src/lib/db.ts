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

export function getDefaultState(): FinancialState {
  return {
    theme: 'dark',
    monthlyBudgetCap: 12000,
    marketRates: { cdi: 13.65, ipca: 4.5, irRate: 0.175 },
    accounts: [
      { id: 'acc_itau', name: 'Itaú Personnalité', balance: 22350.0, color: '#3B82F6' },
      { id: 'acc_nu', name: 'Conta Nubank', balance: 14820.5, color: '#8B5CF6' },
      { id: 'acc_cash', name: 'Espécie', balance: 1850.0, color: '#10B981' },
    ],
    cards: [
      { id: 'card_nu', name: 'Nubank Ultravioleta', institution: 'Nubank', last4: '8412', limit: 28000, closeDay: 4, dueDay: 11 },
      { id: 'card_itau', name: 'Itaú Black', institution: 'Itaú', last4: '3390', limit: 35000, closeDay: 15, dueDay: 22 },
      { id: 'card_res', name: 'Cartão Reserva', institution: 'Manual', last4: '1044', limit: 8000, closeDay: 10, dueDay: 18 },
    ],
    people: [
      { id: 'p_italo', name: 'Ítalo', role: 'Titular', isOwner: true },
      { id: 'p_marcelly', name: 'Marcelly', role: 'Dependente', isOwner: false },
      { id: 'p_palace', name: 'Açougue', role: 'Negócio', isOwner: false },
      { id: 'p_sogra', name: 'Sogra', role: 'Família', isOwner: false },
    ],
    cardPurchases: [
      { id: 'cp_01', cardId: 'card_nu', date: '2026-11-08', startMonth: '2026-11', description: 'Supermercado Zona Sul', category: 'Alimentação', totalCents: 120000, installments: 1, splits: [{ personId: 'p_italo', cents: 80000 }, { personId: 'p_sogra', cents: 40000 }] },
      { id: 'cp_02', cardId: 'card_nu', date: '2026-11-10', startMonth: '2026-11', description: 'Shopping Barra — Roupas', category: 'Compras', totalCents: 90000, installments: 3, splits: [{ personId: 'p_marcelly', cents: 90000 }] },
      { id: 'cp_03', cardId: 'card_itau', date: '2026-11-12', startMonth: '2026-11', description: 'Embalagens Açougue', category: 'Compras', totalCents: 240000, installments: 4, splits: [{ personId: 'p_palace', cents: 240000 }] },
      { id: 'cp_04', cardId: 'card_nu', date: '2026-11-14', startMonth: '2026-11', description: 'Drogaria Venancio', category: 'Saúde', totalCents: 46000, installments: 2, splits: [{ personId: 'p_sogra', cents: 46000 }] },
      { id: 'cp_05', cardId: 'card_itau', date: '2026-11-16', startMonth: '2026-11', description: 'Jantar em Família', category: 'Lazer', totalCents: 60000, installments: 1, splits: [{ personId: 'p_italo', cents: 30000 }, { personId: 'p_marcelly', cents: 30000 }] },
      { id: 'cp_06', cardId: 'card_res', date: '2026-11-17', startMonth: '2026-11', description: 'Posto Ipiranga', category: 'Transporte', totalCents: 35000, installments: 1, splits: [{ personId: 'p_italo', cents: 35000 }] },
    ],
    personEvents: [
      { id: 'ev_01', personId: 'p_sogra', month: '2026-11', type: 'repayment', cents: 30000, date: '2026-11-15', accountId: 'acc_nu', note: 'Pix parcial do mercado' },
      { id: 'ev_02', personId: 'p_palace', month: '2026-11', type: 'advance', cents: 40000, date: '2026-11-14', accountId: 'acc_itau', note: 'Adiantamento caixa loja' },
      { id: 'ev_03', personId: 'p_marcelly', month: '2026-11', type: 'refund', cents: 8500, date: '2026-11-18', accountId: null, note: 'Estorno peça devolvida' },
    ],
    fixedIncomes: [
      { id: 'fi_01', title: 'Pró-labore Palace Carnes', amount: 15000, payDay: 5, accountId: 'acc_itau', receivedMonths: { '2026-11': true } },
      { id: 'fi_02', title: 'Retirada Multi Frutti', amount: 3500, payDay: 10, accountId: 'acc_itau', receivedMonths: { '2026-11': true } },
    ],
    bankTransactions: [
      { id: 'bt_01', date: '2026-11-05', description: 'Pró-labore Palace Carnes', type: 'income', category: 'Salário', accountId: 'acc_itau', amount: 15000 },
      { id: 'bt_02', date: '2026-11-10', description: 'Retirada Multi Frutti', type: 'income', category: 'Salário', accountId: 'acc_itau', amount: 3500 },
      { id: 'bt_03', date: '2026-11-12', description: 'Honorários Advocatícios', type: 'income', category: 'Extra', accountId: 'acc_nu', amount: 6400 },
      { id: 'bt_04', date: '2026-11-06', description: 'Condomínio e IPTU', type: 'expense', category: 'Moradia', accountId: 'acc_itau', amount: 1980 },
      { id: 'bt_05', date: '2026-11-10', description: 'Plano de Saúde Familiar', type: 'expense', category: 'Saúde', accountId: 'acc_itau', amount: 2390 },
      { id: 'bt_06', date: '2026-11-14', description: 'Escola Infantil', type: 'expense', category: 'Educação', accountId: 'acc_itau', amount: 1850 },
    ],
    investments: [
      { id: 'inv_01', name: 'Caixinha Reserva (CDB)', rateType: 'CDI', rateVal: 100, taxFree: false, gross: 49860.4 },
      { id: 'inv_02', name: 'CDB Itaú 2028', rateType: 'CDI', rateVal: 108, taxFree: false, gross: 67420.0 },
      { id: 'inv_03', name: 'LCI Liquidez 90d', rateType: 'CDI', rateVal: 93, taxFree: true, gross: 26900.0 },
      { id: 'inv_04', name: 'Tesouro IPCA+ 2035', rateType: 'IPCA', rateVal: 6.45, taxFree: false, gross: 39180.5 },
    ],
  };
}

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#3B82F6', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, institution TEXT NOT NULL DEFAULT 'Manual', last4 TEXT NOT NULL DEFAULT '0000', credit_limit REAL NOT NULL DEFAULT 0, close_day INTEGER NOT NULL DEFAULT 1, due_day INTEGER NOT NULL DEFAULT 10, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Família', is_owner INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS card_purchases (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, purchase_date TEXT NOT NULL, start_month TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros', total_cents INTEGER NOT NULL DEFAULT 0, installments INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS card_purchase_splits (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, person_id TEXT NOT NULL, cents INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS person_events (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, month_key TEXT NOT NULL, event_type TEXT NOT NULL, cents INTEGER NOT NULL DEFAULT 0, event_date TEXT NOT NULL, account_id TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS fixed_incomes (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, pay_day INTEGER NOT NULL DEFAULT 5, account_id TEXT NOT NULL, received_months_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS bank_transactions (id TEXT PRIMARY KEY, tx_date TEXT NOT NULL, description TEXT NOT NULL, tx_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros', account_id TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS investments (id TEXT PRIMARY KEY, name TEXT NOT NULL, rate_type TEXT NOT NULL DEFAULT 'CDI', rate_val REAL NOT NULL DEFAULT 100, tax_free INTEGER NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, device_name TEXT NOT NULL DEFAULT 'Navegador', created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)`,
  ];

  await db.batch(ddl.map((sql) => db.prepare(sql)));

  const existing = await db.prepare('SELECT COUNT(*) as total FROM accounts').first<{ total: number }>();
  if (!existing || existing.total === 0) {
    await saveFullState(db, getDefaultState());
  }

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
  ] = await db.batch([
    db.prepare('SELECT key, value FROM app_settings'),
    db.prepare('SELECT id, name, balance, color FROM accounts ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, name, institution, last4, credit_limit, close_day, due_day FROM cards ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, name, role, is_owner FROM people ORDER BY sort_order ASC, created_at ASC'),
    db.prepare('SELECT id, card_id, purchase_date, start_month, description, category, total_cents, installments FROM card_purchases ORDER BY purchase_date DESC, created_at DESC'),
    db.prepare('SELECT purchase_id, person_id, cents FROM card_purchase_splits ORDER BY id ASC'),
    db.prepare('SELECT id, person_id, month_key, event_type, cents, event_date, account_id, note FROM person_events ORDER BY event_date DESC'),
    db.prepare('SELECT id, title, amount, pay_day, account_id, received_months_json FROM fixed_incomes ORDER BY pay_day ASC'),
    db.prepare('SELECT id, tx_date, description, tx_type, category, account_id, amount FROM bank_transactions ORDER BY tx_date DESC'),
    db.prepare('SELECT id, name, rate_type, rate_val, tax_free, gross FROM investments ORDER BY gross DESC'),
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

  const cardPurchases: CardPurchase[] = ((purchasesRes.results as Array<Record<string, unknown>>) || []).map((r) => ({
    id: String(r.id),
    cardId: String(r.card_id),
    date: String(r.purchase_date),
    startMonth: String(r.start_month),
    description: String(r.description),
    category: String(r.category || 'Outros'),
    totalCents: Number(r.total_cents) || 0,
    installments: Number(r.installments) || 1,
    splits: splitsByPurchase.get(String(r.id)) || [],
  }));

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
    monthlyBudgetCap: Number(settingsMap.get('monthlyBudgetCap')) || 12000,
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
    ).bind(String(Number(state.monthlyBudgetCap) || 12000)),
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('marketRates', ?, datetime('now'))"
    ).bind(JSON.stringify(state.marketRates || { cdi: 13.65, ipca: 4.5, irRate: 0.175 })),
  ];

  (state.accounts || []).forEach((a, idx) => {
    stmts.push(
      db.prepare(
        'INSERT INTO accounts (id, name, balance, color, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).bind(a.id, a.name, Number(a.balance) || 0, a.color || '#3B82F6', idx + 1)
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
    stmts.push(
      db.prepare(
        'INSERT INTO card_purchases (id, card_id, purchase_date, start_month, description, category, total_cents, installments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(cp.id, cp.cardId, cp.date, cp.startMonth, cp.description, cp.category || 'Outros', Math.round(Number(cp.totalCents) || 0), Math.max(1, Number(cp.installments) || 1))
    );
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
    stmts.push(
      db.prepare(
        'INSERT INTO bank_transactions (id, tx_date, description, tx_type, category, account_id, amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(bt.id, bt.date, bt.description, bt.type === 'income' ? 'income' : 'expense', bt.category || 'Outros', bt.accountId, Number(bt.amount) || 0)
    );
  });

  (state.investments || []).forEach((inv) => {
    stmts.push(
      db.prepare(
        'INSERT INTO investments (id, name, rate_type, rate_val, tax_free, gross) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(inv.id, inv.name, inv.rateType || 'CDI', Number(inv.rateVal) || 100, inv.taxFree ? 1 : 0, Number(inv.gross) || 0)
    );
  });

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
