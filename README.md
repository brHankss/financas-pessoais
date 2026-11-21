# Finanças Pessoais — Cloudflare Workers + D1

Aplicativo completo de gestão financeira pessoal (contas, cartões compartilhados com rateio por pessoa, extrato, rendas fixas e investimentos), construído na mesma arquitetura full-stack do **Palace Carnes**: **Cloudflare Workers (TypeScript)** + **Cloudflare D1 (SQLite na nuvem)** + **deploy automático via GitHub**.

## Estrutura do projeto

- `wrangler.jsonc` — configuração do Worker `financas-pessoais` (`src/worker.ts` + `./public`).
- `migrations/` — schema SQL normalizado (`0001_initial_schema.sql`) e seed inicial (`0002_seed_initial.sql`).
- `src/worker.ts` — entrypoint do Worker com roteamento `/api/*` e entrega de assets.
- `src/lib/db.ts` — leitura/gravação transacional no Cloudflare D1 com criação automática de tabelas na primeira execução.
- `src/lib/auth.ts` — autenticação opcional com cookie `HttpOnly` e sessões salvas no D1 (ativada ao definir o secret `APP_PASSWORD`).
- `src/routes/` — endpoints `/api/health`, `/api/auth/*` e `/api/state`.
- `public/` — interface web (`index.html`), cliente de sincronização D1 (`js/api-sync.js`) e `manifest.json`.

## Rodar localmente

Use Node.js 22.12 ou superior.

```sh
npm install
npm run db:migrate:local
npm run dev
```

Abra `http://localhost:8787`. As alterações feitas nesse ambiente ficam no D1 local.

## Como publicar na Cloudflare (com atualizações automáticas)

1. Suba todos os arquivos deste projeto na branch `main` do repositório `brHankss/financas-pessoais`.
2. Na Cloudflare, conecte o Worker `financas-pessoais` ao repositório para que as alterações na `main` disparem o deploy automaticamente.
3. No painel da Cloudflare, crie ou selecione o banco D1 `financas-pessoais-db`. Copie o UUID do banco e confira o `database_id` em `wrangler.jsonc`. O Worker usa esse UUID no vínculo `DB`.
   - Para um banco novo, o Worker cria as tabelas e os dados de exemplo no primeiro acesso. Se preferir aplicar as migrações manualmente, execute `npm run db:migrate:remote` antes do primeiro acesso ao banco novo. A migração inicial inclui dados de exemplo.
4. **(Opcional) Proteger com senha própria (sem Zero Trust):**
   - Em `financas-pessoais` > **Settings > Variables and Secrets > Add**, adicione um **Secret** chamado `APP_PASSWORD` com a senha desejada. O sistema passa a exibir a tela de login automaticamente.
