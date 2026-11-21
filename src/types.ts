export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  APP_PASSWORD?: string;
}

export interface MarketRates {
  cdi: number;
  ipca: number;
  irRate: number;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  color: string;
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
