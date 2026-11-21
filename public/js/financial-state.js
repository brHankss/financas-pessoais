const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isId = (value) => isString(value) && value.length > 0;
const isCents = (value) => Number.isSafeInteger(value) && value >= 0;
const isDay = (value) => Number.isInteger(value) && value >= 1 && value <= 31;
const isDate = (value) => isString(value) && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
const isBoolean = (value) => typeof value === 'boolean';

export function isMonthKey(value) {
  return isString(value) && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

const rowFields = {
  accounts: { name: isString, balance: Number.isFinite, color: isString },
  cards: {
    name: isString, institution: isString, last4: isString, limit: Number.isFinite,
    closeDay: isDay, dueDay: isDay,
  },
  people: { name: isString, role: isString, isOwner: isBoolean },
  cardPurchases: {
    cardId: isId, date: isDate, startMonth: isMonthKey, description: isString, category: isString,
    totalCents: isCents,
    installments: (value) => Number.isInteger(value) && value >= 1 && value <= 24,
    splits: (value) => Array.isArray(value)
      && value.every((split) => isObject(split) && isId(split.personId) && isCents(split.cents)),
  },
  personEvents: {
    personId: isId, month: isMonthKey, type: (value) => ['repayment', 'advance', 'refund'].includes(value),
    cents: isCents, date: isDate, accountId: (value) => value === null || isId(value), note: isString,
  },
  fixedIncomes: {
    title: isString, amount: Number.isFinite, payDay: isDay, accountId: isId,
    receivedMonths: (value) => isObject(value)
      && Object.entries(value).every(([month, received]) => isMonthKey(month) && isBoolean(received)),
  },
  bankTransactions: {
    date: isDate, description: isString, category: isString, accountId: isId, amount: Number.isFinite,
    type: (value) => ['income', 'expense', 'reimbursement_in', 'bill_payment'].includes(value),
  },
  investments: {
    name: isString, rateType: (value) => ['CDI', 'IPCA', 'PRE'].includes(value), rateVal: Number.isFinite,
    taxFree: isBoolean, gross: Number.isFinite,
  },
};

/**
 * @param {unknown} value
 * @returns {value is import('../../src/types').FinancialState}
 */
export function isFinancialState(value) {
  if (!isObject(value) || !['light', 'dark'].includes(value.theme) || !Number.isFinite(value.monthlyBudgetCap)
      || !isObject(value.marketRates) || !['cdi', 'ipca', 'irRate'].every((key) => Number.isFinite(value.marketRates[key]))) {
    return false;
  }

  for (const [key, fields] of Object.entries(rowFields)) {
    const rows = value[key];
    if (!Array.isArray(rows) || !rows.every((row) => isObject(row) && isId(row.id)
      && Object.entries(fields).every(([field, check]) => check(row[field])))) return false;
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  }

  const cards = new Set(value.cards.map((card) => card.id));
  const people = new Set(value.people.map((person) => person.id));
  return value.cardPurchases.every((purchase) => cards.has(purchase.cardId)
    && new Set(purchase.splits.map((split) => split.personId)).size === purchase.splits.length
    && purchase.splits.every((split) => people.has(split.personId))
    && purchase.splits.reduce((sum, split) => sum + split.cents, 0) === purchase.totalCents)
    && value.personEvents.every((event) => people.has(event.personId));
}
