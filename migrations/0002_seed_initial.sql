-- Seed inicial idempotente para o banco D1 financas-pessoais-db

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('theme', 'dark'),
  ('monthlyBudgetCap', '12000'),
  ('marketRates', '{"cdi":13.65,"ipca":4.5,"irRate":0.175}');

INSERT OR IGNORE INTO accounts (id, name, balance, color, sort_order) VALUES
  ('acc_itau', 'Itaú Personnalité', 22350.00, '#3B82F6', 1),
  ('acc_nu', 'Conta Nubank', 14820.50, '#8B5CF6', 2),
  ('acc_cash', 'Espécie', 1850.00, '#10B981', 3);

INSERT OR IGNORE INTO cards (id, name, institution, last4, credit_limit, close_day, due_day, sort_order) VALUES
  ('card_nu', 'Nubank Ultravioleta', 'Nubank', '8412', 28000, 4, 11, 1),
  ('card_itau', 'Itaú Black', 'Itaú', '3390', 35000, 15, 22, 2),
  ('card_res', 'Cartão Reserva', 'Manual', '1044', 8000, 10, 18, 3);

INSERT OR IGNORE INTO people (id, name, role, is_owner, sort_order) VALUES
  ('p_italo', 'Ítalo', 'Titular', 1, 1),
  ('p_marcelly', 'Marcelly', 'Dependente', 0, 2),
  ('p_palace', 'Açougue', 'Negócio', 0, 3),
  ('p_sogra', 'Sogra', 'Família', 0, 4);

INSERT OR IGNORE INTO card_purchases (id, card_id, purchase_date, start_month, description, category, total_cents, installments) VALUES
  ('cp_01', 'card_nu', '2026-11-08', '2026-11', 'Supermercado Zona Sul', 'Alimentação', 120000, 1),
  ('cp_02', 'card_nu', '2026-11-10', '2026-11', 'Shopping Barra — Roupas', 'Compras', 90000, 3),
  ('cp_03', 'card_itau', '2026-11-12', '2026-11', 'Embalagens Açougue', 'Compras', 240000, 4),
  ('cp_04', 'card_nu', '2026-11-14', '2026-11', 'Drogaria Venancio', 'Saúde', 46000, 2),
  ('cp_05', 'card_itau', '2026-11-16', '2026-11', 'Jantar em Família', 'Lazer', 60000, 1),
  ('cp_06', 'card_res', '2026-11-17', '2026-11', 'Posto Ipiranga', 'Transporte', 35000, 1);

INSERT OR IGNORE INTO card_purchase_splits (id, purchase_id, person_id, cents) VALUES
  (1, 'cp_01', 'p_italo', 80000),
  (2, 'cp_01', 'p_sogra', 40000),
  (3, 'cp_02', 'p_marcelly', 90000),
  (4, 'cp_03', 'p_palace', 240000),
  (5, 'cp_04', 'p_sogra', 46000),
  (6, 'cp_05', 'p_italo', 30000),
  (7, 'cp_05', 'p_marcelly', 30000),
  (8, 'cp_06', 'p_italo', 35000);

INSERT OR IGNORE INTO person_events (id, person_id, month_key, event_type, cents, event_date, account_id, note) VALUES
  ('ev_01', 'p_sogra', '2026-11', 'repayment', 30000, '2026-11-15', 'acc_nu', 'Pix parcial do mercado'),
  ('ev_02', 'p_palace', '2026-11', 'advance', 40000, '2026-11-14', 'acc_itau', 'Adiantamento caixa loja'),
  ('ev_03', 'p_marcelly', '2026-11', 'refund', 8500, '2026-11-18', NULL, 'Estorno peça devolvida');

INSERT OR IGNORE INTO fixed_incomes (id, title, amount, pay_day, account_id, received_months_json) VALUES
  ('fi_01', 'Pró-labore Palace Carnes', 15000, 5, 'acc_itau', '{"2026-11":true}'),
  ('fi_02', 'Retirada Multi Frutti', 3500, 10, 'acc_itau', '{"2026-11":true}');

INSERT OR IGNORE INTO bank_transactions (id, tx_date, description, tx_type, category, account_id, amount) VALUES
  ('bt_01', '2026-11-05', 'Pró-labore Palace Carnes', 'income', 'Salário', 'acc_itau', 15000),
  ('bt_02', '2026-11-10', 'Retirada Multi Frutti', 'income', 'Salário', 'acc_itau', 3500),
  ('bt_03', '2026-11-12', 'Honorários Advocatícios', 'income', 'Extra', 'acc_nu', 6400),
  ('bt_04', '2026-11-06', 'Condomínio e IPTU', 'expense', 'Moradia', 'acc_itau', 1980),
  ('bt_05', '2026-11-10', 'Plano de Saúde Familiar', 'expense', 'Saúde', 'acc_itau', 2390),
  ('bt_06', '2026-11-14', 'Escola Infantil', 'expense', 'Educação', 'acc_itau', 1850);

INSERT OR IGNORE INTO investments (id, name, rate_type, rate_val, tax_free, gross) VALUES
  ('inv_01', 'Caixinha Reserva (CDB)', 'CDI', 100, 0, 49860.40),
  ('inv_02', 'CDB Itaú 2028', 'CDI', 108, 0, 67420.00),
  ('inv_03', 'LCI Liquidez 90d', 'CDI', 93, 1, 26900.00),
  ('inv_04', 'Tesouro IPCA+ 2035', 'IPCA', 6.45, 0, 39180.50);
