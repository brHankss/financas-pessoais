import type {
  Account,
  CardPurchase,
  OriginKind,
  PluggyPosition,
  StatementImportPlanItem,
  StatementImportRow,
} from '../types';

export const APP_CATEGORIES = [
  'Alimentação',
  'Moradia',
  'Saúde',
  'Educação',
  'Transporte',
  'Lazer',
  'Compras',
  'Assinaturas',
  'Salário',
  'Extra',
  'Outros',
] as const;

const INSTALLMENT_RE = /(?:\b(?:parc(?:ela)?\.?)\s*)?\b(\d{1,2})\s*(?:\/|\bde\b)\s*(\d{1,2})\b/i;

export function addMonths(ym: string, offset: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function splitCents(total: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rem : 0));
}

export function extractInstallmentFromText(raw: string): {
  description: string;
  index: number;
  count: number;
} {
  const trimmed = String(raw || '').trim();
  const match = trimmed.match(INSTALLMENT_RE);
  if (!match) {
    return { description: trimmed, index: 1, count: 1 };
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!index || count < index || count > 99) {
    return { description: trimmed, index: 1, count: 1 };
  }
  const cleaned = trimmed
    .replace(match[0], '')
    .replace(/[\s(\-–]+$|^\s*\)\s*|\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    description: cleaned || trimmed,
    index,
    count,
  };
}

export function normalizeDescription(input: string): string {
  const { description } = extractInstallmentFromText(input);
  return description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function isCardPaymentOrRefund(description: string): boolean {
  const s = String(description || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return /^(pagamento (?:recebido|de fatura|efetuado|fatura)|pagto fatura|estorno|saldo anterior|total\b|credito de|devolucao|cashback|desconto antecipacao)/.test(s);
}

export function inferCategory(description: string, remoteCategory?: string | null): string {
  const text = `${remoteCategory || ''} ${description || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/(salari|pro-labore|prolabore|holerite|remunerac|rendimento|dividend|juros sobre|payroll|salary)/.test(text)) return 'Salário';
  if (/(ifood|rappi|uber\s*eats|mercado|supermerc|atacad|padaria|acougue|restaur|lanch|cafe|pizza|burger|hortifruti|food|grocer|dining|bakery)/.test(text)) return 'Alimentação';
  if (/(uber|99app|99pop|cabify|posto|combustiv|gasolina|etanol|estacionam|pedagio|sem parar|veloe|metro|onibus|passagem|aerea|latam|gol|azul|transport|taxi|fuel|parking)/.test(text)) return 'Transporte';
  if (/(aluguel|condomin|energia|enel|cemig|copel|light|agua|sabesp|sanepar|gas|internet|vivo|claro|tim|oi|iptu|housing|rent|utilit)/.test(text)) return 'Moradia';
  if (/(farmac|drogaria|droga|raia|pacheco|hospital|clinic|medic|odonto|dentist|exame|laborat|plano de saude|unimed|amil|sulamerica|health|pharmacy|doctor)/.test(text)) return 'Saúde';
  if (/(escola|faculd|univers|curso|udemy|alura|coursera|livro|livraria|educac|mensalidade escolar|education|school)/.test(text)) return 'Educação';
  if (/(netflix|spotify|disney|hbo|max|prime video|amazon prime|youtube|icloud|apple\.com|google one|chatgpt|openai|assinat|subscription|stream)/.test(text)) return 'Assinaturas';
  if (/(cinema|ingresso|teatro|show|viagem|hotel|airbnb|booking|bar|clube|entreten|lazer|entertainment|travel|leisure)/.test(text)) return 'Lazer';
  if (/(amazon|mercado livre|mercadolivre|shopee|shein|magalu|magazine|americanas|casas bahia|renner|riachuelo|zara|nike|adidas|loja|shopping)/.test(text)) return 'Compras';
  return 'Outros';
}

export function buildStatementBaseSignature(params: {
  cardId: string;
  statementMonth: string;
  date: string;
  description: string;
  cents: number;
  index: number;
  count: number;
}): string {
  const norm = normalizeDescription(params.description);
  const idx = Math.max(1, Math.floor(params.index || 1));
  const cnt = Math.max(idx, Math.floor(params.count || 1));
  const cents = Math.round(Number(params.cents) || 0);
  return `${params.cardId}|${params.statementMonth}|${params.date}|${norm}|${cents}|${idx}/${cnt}`;
}

export function assignStatementKeys<T extends StatementImportRow>(
  cardId: string,
  statementMonth: string,
  rows: T[],
): Array<T & { baseSignature: string; occurrenceIndex: number; importKey: string }> {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const baseSignature = buildStatementBaseSignature({
      cardId,
      statementMonth,
      date: row.date,
      description: row.description,
      cents: row.cents,
      index: row.index,
      count: row.count,
    });
    const occ = (counts.get(baseSignature) || 0) + 1;
    counts.set(baseSignature, occ);
    return {
      ...row,
      baseSignature,
      occurrenceIndex: occ,
      importKey: `${baseSignature}#${occ}`,
    };
  });
}

export interface MonthInstallmentSlice {
  purchaseId: string;
  cardId: string;
  date: string;
  description: string;
  category: string;
  installmentNumber: number;
  installmentsTotal: number;
  fullCents: number;
  importKey?: string | null;
}

export function getMonthInstallmentsForCard(
  purchases: CardPurchase[],
  cardId: string,
  monthKey: string,
): MonthInstallmentSlice[] {
  const rows: MonthInstallmentSlice[] = [];
  for (const cp of purchases) {
    if (cp.cardId !== cardId) continue;
    const n = Math.max(1, Number(cp.installments) || 1);
    const confirmed = cp.statementAmounts || {};
    const parts = splitCents(cp.totalCents, n);
    for (let i = 0; i < n; i++) {
      if (addMonths(cp.startMonth, i) !== monthKey) continue;
      const instCents = confirmed[monthKey] ?? parts[i];
      rows.push({
        purchaseId: cp.id,
        cardId: cp.cardId,
        date: cp.date,
        description: cp.description,
        category: cp.category,
        installmentNumber: i + 1,
        installmentsTotal: n,
        fullCents: instCents,
        importKey: cp.importKey || null,
      });
    }
  }
  return rows;
}

export function computeMonthlyCardTotalCents(
  purchases: CardPurchase[],
  cardId: string,
  monthKey: string,
): number {
  return getMonthInstallmentsForCard(purchases, cardId, monthKey).reduce(
    (sum, r) => sum + r.fullCents,
    0,
  );
}

/**
 * Computes the incremental import plan for a card statement.
 * Existing purchases are NEVER modified (their splits, owners, and categories stay 100% intact).
 * Duplicate detection handles:
 *  1) Exact stored importKey match (`cardId|month|date|normDesc|cents|X/Y#occ`)
 *  2) Deterministic baseSignature + occurrenceIndex match for previously entered/imported rows
 *  3) Identical same-day purchases differentiated by occurrence index (#1, #2, ...)
 */
export function planIncrementalStatementImport(
  existingPurchases: CardPurchase[],
  cardId: string,
  statementMonth: string,
  incomingRows: StatementImportRow[],
  defaultOwnerId: string,
): {
  items: StatementImportPlanItem[];
  newPurchases: CardPurchase[];
  addedCount: number;
  ignoredCount: number;
} {
  const existingSlices = getMonthInstallmentsForCard(existingPurchases, cardId, statementMonth);

  // Track exact import keys and base-signature occurrence counts already present in this card+month
  const existingExactKeys = new Map<string, string>(); // importKey -> purchaseId
  const existingByBase = new Map<string, string[]>(); // baseSignature -> purchaseIds[]
  // Also track installment matches ignoring purchase date (e.g. parcel 2/6 from a prior month)
  const existingInstallmentLoose = new Map<string, string[]>(); // normDesc|cents|X/Y -> purchaseIds[]

  for (const slice of existingSlices) {
    const base = buildStatementBaseSignature({
      cardId,
      statementMonth,
      date: slice.date,
      description: slice.description,
      cents: slice.fullCents,
      index: slice.installmentNumber,
      count: slice.installmentsTotal,
    });
    const list = existingByBase.get(base) || [];
    list.push(slice.purchaseId);
    existingByBase.set(base, list);

    const computedKey = `${base}#${list.length}`;
    existingExactKeys.set(computedKey, slice.purchaseId);
    if (slice.importKey) {
      existingExactKeys.set(slice.importKey, slice.purchaseId);
    }

    if (slice.installmentsTotal > 1) {
      const looseKey = `${cardId}|${statementMonth}|${normalizeDescription(slice.description)}|${slice.fullCents}|${slice.installmentNumber}/${slice.installmentsTotal}`;
      const looseList = existingInstallmentLoose.get(looseKey) || [];
      looseList.push(slice.purchaseId);
      existingInstallmentLoose.set(looseKey, looseList);
    }
  }

  const keyedIncoming = assignStatementKeys(cardId, statementMonth, incomingRows);
  const consumedPurchaseIds = new Set<string>();
  const items: StatementImportPlanItem[] = [];
  const newPurchases: CardPurchase[] = [];

  for (const row of keyedIncoming) {
    let matchedId: string | null = null;

    // 1. Exact deterministic key match (including occurrence index)
    const exactMatch = existingExactKeys.get(row.importKey);
    if (exactMatch && !consumedPurchaseIds.has(exactMatch)) {
      matchedId = exactMatch;
    }

    // 2. Fallback: base signature pool (covers rows whose occurrence order shifted slightly)
    if (!matchedId) {
      const pool = existingByBase.get(row.baseSignature) || [];
      const free = pool.find((id) => !consumedPurchaseIds.has(id));
      if (free) matchedId = free;
    }

    // 3. Fallback for multi-installment items entered manually with different purchase date
    if (!matchedId && row.count > 1) {
      const looseKey = `${cardId}|${statementMonth}|${normalizeDescription(row.description)}|${row.cents}|${row.index}/${row.count}`;
      const pool = existingInstallmentLoose.get(looseKey) || [];
      const free = pool.find((id) => !consumedPurchaseIds.has(id));
      if (free) matchedId = free;
    }

    if (matchedId) {
      consumedPurchaseIds.add(matchedId);
      items.push({
        ...row,
        duplicate: true,
        matchedPurchaseId: matchedId,
      });
      continue;
    }

    items.push({
      ...row,
      duplicate: false,
      matchedPurchaseId: null,
    });

    const ownerId = row.personId || defaultOwnerId;
    const totalCents = Math.round(row.cents) * Math.max(1, row.count);
    const category = row.category || inferCategory(row.description);
    newPurchases.push({
      id: 'stmt_' + crypto.randomUUID(),
      cardId,
      date: row.date,
      startMonth: addMonths(statementMonth, 1 - row.index),
      description: row.description,
      category,
      totalCents,
      installments: Math.max(1, row.count),
      splits: ownerId ? [{ personId: ownerId, cents: totalCents }] : [],
      statementAmounts: { [statementMonth]: Math.round(row.cents) },
      source: 'statement',
      externalId: null,
      importKey: row.importKey,
    });
  }

  const ignoredCount = items.filter((i) => i.duplicate).length;
  const addedCount = items.length - ignoredCount;
  return { items, newPurchases, addedCount, ignoredCount };
}

export interface ResolvedAccountView {
  id: string;
  name: string;
  balance: number;
  color: string;
  origin: OriginKind;
  includeInCash: boolean;
  excludedByPluggy: boolean;
  linkedPluggyId: string | null;
}

/**
 * Resolves manual and Pluggy accounts without ever duplicating balances.
 * - Linked manual accounts take the Pluggy balance (unless the linked Pluggy item is excluded)
 *   and hide the separate Pluggy copy.
 * - Unlinked Pluggy accounts appear only once with origin='Pluggy', respecting `excluded`.
 * - Available cash sums only accounts with `!excludedByPluggy && includeInCash`.
 */
export function resolveAccountsWithoutDuplication(
  manualAccounts: Account[],
  pluggyAccountPositions: PluggyPosition[],
): { accounts: ResolvedAccountView[]; availableCash: number } {
  const byLinkedTarget = new Map<string, PluggyPosition>();
  for (const pos of pluggyAccountPositions) {
    if (pos.category === 'accounts' && pos.linkedTargetId) {
      byLinkedTarget.set(pos.linkedTargetId, pos);
    }
  }

  const manualIds = new Set(manualAccounts.map((a) => a.id));
  const resolved: ResolvedAccountView[] = [];

  for (const acc of manualAccounts) {
    const linked = byLinkedTarget.get(acc.id);
    if (linked) {
      const balance = Number.isFinite(linked.balance) ? Number(linked.balance) : acc.balance;
      resolved.push({
        id: acc.id,
        name: acc.name,
        balance,
        color: acc.color || '#2563eb',
        origin: 'Vinculado',
        includeInCash: acc.includeInCash !== false,
        excludedByPluggy: Boolean(linked.excluded),
        linkedPluggyId: linked.id,
      });
    } else {
      resolved.push({
        id: acc.id,
        name: acc.name,
        balance: acc.balance,
        color: acc.color || '#2563eb',
        origin: 'Manual',
        includeInCash: acc.includeInCash !== false,
        excludedByPluggy: false,
        linkedPluggyId: null,
      });
    }
  }

  for (const pos of pluggyAccountPositions) {
    if (pos.category !== 'accounts') continue;
    if (pos.linkedTargetId && manualIds.has(pos.linkedTargetId)) continue;
    resolved.push({
      id: pos.id,
      name: pos.name,
      balance: Number(pos.balance) || 0,
      color: pos.color || '#2563eb',
      origin: 'Pluggy',
      includeInCash: !pos.excluded,
      excludedByPluggy: Boolean(pos.excluded),
      linkedPluggyId: pos.id,
    });
  }

  const availableCash = resolved
    .filter((a) => !a.excludedByPluggy && a.includeInCash)
    .reduce((sum, a) => sum + a.balance, 0);

  return { accounts: resolved, availableCash };
}
