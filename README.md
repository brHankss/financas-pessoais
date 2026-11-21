# Finanças Pessoais — Cloudflare Workers + D1

Aplicativo completo de gestão financeira pessoal (contas, cartões compartilhados com rateio por pessoa, extrato, rendas fixas e investimentos), construído na mesma arquitetura full-stack do **Palace Carnes**: **Cloudflare Workers (TypeScript)** + **Cloudflare D1 (SQLite na nuvem)** + **deploy automático via GitHub**.

## Estrutura do projeto

- `wrangler.jsonc` — configuração do Worker `financas-pessoais` (`src/worker.ts` + `./public`).
- `migrations/` — tabelas do D1. As instalações novas começam com os cadastros vazios.
- `src/worker.ts` — entrypoint do Worker com roteamento `/api/*` e entrega de assets.
- `src/lib/db.ts` — leitura/gravação transacional no Cloudflare D1 com criação automática de tabelas na primeira execução.
- `src/lib/auth.ts` — autenticação opcional com cookie `HttpOnly` e sessões salvas no D1 (ativada ao definir o secret `APP_PASSWORD`).
- `src/routes/` — endpoints de sessão, estado, mercado e importação do Meu Pluggy.
- `public/` — interface web (`index.html`), cliente de sincronização D1 (`js/api-sync.js`) e `manifest.json`.

## Rodar localmente

Use Node.js 22.12 ou superior.

```sh
npm install
npm run db:migrate:local
npm run dev
```

Abra `http://localhost:8787`. A versão de cadastro do zero limpa os registros da versão anterior uma vez. As tabelas preservam os cadastros feitos depois desse primeiro acesso.

## Configurar o Meu Pluggy

1. Conecte seus bancos no [Meu Pluggy](https://meu.pluggy.ai/).
2. No Dashboard do Pluggy, abra a sua aplicação e conecte o conector **MeuPluggy** na aba **Demo**. Copie um `itemId` de cada banco que deseja importar. [Guia oficial do Meu Pluggy](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use)
3. Em **Settings → Variables and Secrets** do Worker `financas-pessoais`, configure os secrets `APP_PASSWORD`, `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`. As credenciais ficam no Worker.
4. Entre no aplicativo, abra **Importação**, cole os IDs e escolha **Saldos de contas**, **Cartões de crédito** e **Investimentos**. Salve e clique em **Sincronizar agora**. Saldos e investimentos vêm marcados por padrão. Ative a atualização diária se desejar.
5. Em **Aplicações importadas**, desmarque as aplicações que devem ficar fora do patrimônio. Elas continuam visíveis no total importado e a escolha é preservada nas próximas atualizações.

Desmarcar uma categoria pausa as próximas consultas daquela categoria. A última posição importada continua disponível.

## Como publicar na Cloudflare

1. Suba todos os arquivos deste projeto na branch `main` do repositório `brHankss/financas-pessoais`.
2. Na Cloudflare, o Worker `financas-pessoais` conectado ao repositório publica as atualizações da `main`.
3. Confira se o `database_id` em `wrangler.jsonc` corresponde ao banco D1 `financas-pessoais-db` que deve ser usado pelo Worker. O vínculo se chama `DB`.
