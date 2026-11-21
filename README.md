# Finanças Pessoais — Cloudflare Workers + D1

Aplicativo completo de gestão financeira pessoal (contas, cartões compartilhados com rateio por pessoa, extrato, rendas fixas e investimentos), construído na mesma arquitetura full-stack do **Palace Carnes**: **Cloudflare Workers (TypeScript)** + **Cloudflare D1 (SQLite na nuvem)** + **deploy automático via GitHub**.

## Estrutura do projeto

- `wrangler.jsonc` — configuração do Worker `folego-financas-workers` (`src/worker.ts` + `./public`).
- `migrations/` — schema SQL normalizado (`0001_initial_schema.sql`) e seed inicial (`0002_seed_initial.sql`).
- `src/worker.ts` — entrypoint do Worker com roteamento `/api/*` e entrega de assets.
- `src/lib/db.ts` — leitura/gravação transacional no Cloudflare D1 com criação automática de tabelas na primeira execução.
- `src/lib/auth.ts` — autenticação opcional com cookie `HttpOnly` e sessões salvas no D1 (ativada ao definir o secret `APP_PASSWORD`).
- `src/routes/` — endpoints `/api/health`, `/api/auth/*` e `/api/state`.
- `public/` — interface web (`index.html`), cliente de sincronização D1 (`js/api-sync.js`) e `manifest.json`.

## Como publicar na Cloudflare (com atualizações automáticas)

1. Suba todos os arquivos deste projeto na branch `main` do repositório `brHankss/financas-pessoais`.
2. Na Cloudflare, o Worker `folego-financas-workers` conectado ao repositório dispara o deploy automaticamente.
3. **Ativar o banco de dados na nuvem (D1):**
   - No painel da Cloudflare, vá em **Storage & Databases > D1 SQL Database > Create** e crie o banco `financas-pessoais-db`.
   - Abra o Worker `folego-financas-workers` > **Settings > Bindings > Add > D1 database**.
   - Em **Variable name**, digite `DB` e selecione `financas-pessoais-db`. Salve.
   - As tabelas e dados iniciais são criados automaticamente na primeira requisição (ou rode `npm run db:migrate:remote` pelo terminal).
4. **(Opcional) Proteger com senha própria (sem Zero Trust):**
   - Em `folego-financas-workers` > **Settings > Variables and Secrets > Add**, adicione um **Secret** chamado `APP_PASSWORD` com a senha desejada. O sistema passa a exibir a tela de login automaticamente.
