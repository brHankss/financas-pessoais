export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  APP_PASSWORD?: string;
  PLUGGY_CLIENT_ID?: string;
  PLUGGY_CLIENT_SECRET?: string;
}

export interface MarketRates {
  cdi: number;
  ipca: number;
  irRate: number;
}

export type OriginKind = 'Manual' | 'Pluggy' | 'Vinculado';

export interface Account {
  id: string;
  name: string;
  balance: number;
  color: string;
  includeInCash?: boolean;
}

export interface Card {
  id: string;
  name: string;
  institution: string;
  last4: string;
  limit: number;
  closeDay: number;
  dueDay: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
}

export interface PurchaseSplit {
  personId: string;
  cents: number;
}

export interface CardPurchase {
  id: string;
  cardId: string;
  date: string;
  startMonth: string;
  description: string;
  category: string;
  totalCents: number;
  installments: number;
  splits: PurchaseSplit[];
  statementAmounts?: Record<string, number>;
  source?: 'manual' | 'pluggy' | 'statement';
  externalId?: string | null;
  importKey?: string | null;
}

export interface PersonEvent {
  id: string;
  personId: string;
  month: string;
  type: 'repayment' | 'advance' | 'refund';
  cents: number;
  date: string;
  accountId: string | null;
  note: string;
}

export interface FixedIncome {
  id: string;
  title: string;
  amount: number;
  payDay: number;
  accountId: string;
  receivedMonths: Record<string, boolean>;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  type: 'income' | 'expense';
  category: string;
  accountId: string;
  amount: number;
  source?: 'manual' | 'pluggy';
  externalId?: string | null;
}

export interface Investment {
  id: string;
  name: string;
  rateType: 'CDI' | 'IPCA' | 'PRE';
  rateVal: number;
  taxFree: boolean;
  gross: number;
}

export interface FinancialState {
  theme: 'dark' | 'light';
  monthlyBudgetCap: number;
  marketRates: MarketRates;
  accounts: Account[];
  cards: Card[];
  people: Person[];
  cardPurchases: CardPurchase[];
  personEvents: PersonEvent[];
  fixedIncomes: FixedIncome[];
  bankTransactions: BankTransaction[];
  investments: Investment[];
}

export type ImportGroup = 'accounts' | 'cards' | 'investments';

export interface PluggyPreferences {
  accounts: boolean;
  cards: boolean;
  investments: boolean;
  itemIds: string[];
  auto: boolean;
  syncTransactions: boolean;
  txDays: number;
}

export interface PluggyPosition {
  id: string;
  item: string;
  category: ImportGroup;
  pluggyAccountId?: string;
  name: string;
  excluded: boolean;
  linkedTargetId: string | null;
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
}

export interface PluggyLink {
  pluggyId: string;
  category: ImportGroup;
  targetId: string;
}

export interface PluggySyncSummary {
  accounts: number;
  cards: number;
  investments: number;
  newBankTx: number;
  skippedBankTx: number;
  newCardPurchases: number;
  skippedCardPurchases: number;
}

export interface StatementImportRow {
  date: string;
  description: string;
  cents: number;
  index: number;
  count: number;
  category?: string;
  personId?: string;
}

export interface StatementImportPlanItem extends StatementImportRow {
  baseSignature: string;
  occurrenceIndex: number;
  importKey: string;
  duplicate: boolean;
  matchedPurchaseId: string | null;
}

export interface StatementImportResult {
  added: number;
  ignored: number;
  addedPurchases: CardPurchase[];
  ignoredKeys: string[];
}
