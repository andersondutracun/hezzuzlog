# HEZZUZ Logs 3.1 — Deploy no Coolify

Este pacote foi ajustado para rodar como **Docker Compose Application** no Coolify.
A arquitetura recomendada é:

- PostgreSQL como recurso separado no Coolify;
- `backend` privado, porta interna 3001;
- `frontend` público, porta interna 80;
- somente o frontend recebe domínio público;
- Nginx encaminha `/api/*` e `/ws` para o backend;
- o plugin Minecraft envia para o mesmo domínio HTTPS.

## 1. PostgreSQL

Crie um PostgreSQL no mesmo servidor/destination do Coolify.
Sugestão:

- Database: `hezzuz_logs`
- PostgreSQL 17 ou 18
- acesso público: **desativado**
- backups automáticos: **ativados**

Quando estiver saudável, copie a **Postgres URL (Internal)** mostrada pelo Coolify.
Ela será usada como `DATABASE_URL`.

Não exponha a porta 5432 publicamente só para o HEZZUZ Logs.

## 2. Subir o projeto

Recomendado: coloque esta pasta em um repositório Git privado.

No Coolify:

1. New Resource → Application.
2. Selecione o repositório.
3. Build Pack: `Docker Compose`.
4. Compose file: `/docker-compose.yml`.
5. Salve para o Coolify analisar `backend` e `frontend`.

O compose já possui healthchecks separados e não publica portas diretamente no host.

## 3. Variáveis

Após salvar o Compose, o Coolify criará automaticamente as variáveis `SERVICE_*` usadas pelo stack.

Você precisa preencher manualmente apenas o que for necessário, principalmente:

```env
DATABASE_URL=postgresql://...URL_INTERNA_DO_COOLIFY...
DATABASE_SSL=false
ADMIN_USERNAME=admin
EVENT_RETENTION_DAYS=90
DISCORD_FORWARD_MODE=critical
```

O Coolify gera automaticamente:

```text
SERVICE_PASSWORD_ADMIN       senha inicial do painel
SERVICE_HEX_64_AUTHSECRET    assinatura da sessão
SERVICE_HEX_64_SURVIVAL      chave da API do Survival
SERVICE_HEX_64_LOBBY         chave da API do Lobby
SERVICE_HEX_64_SKYBLOCK      chave da API do SkyBlock
```

**Não publique nem envie essas chaves em chat, print ou Git.**

## 4. Domínio

No componente `frontend` configure o domínio, por exemplo:

```text
https://logs.seudominio.com.br
```

Porta interna:

```text
80
```

Não atribua domínio ao `backend`.
Não publique a porta 3001.

Ative redirecionamento HTTP → HTTPS no Coolify.

## 5. Deploy

Clique em Deploy.

A ordem esperada é:

1. backend inicia;
2. espera o PostgreSQL;
3. aplica migrations idempotentes;
4. `/readyz` fica saudável;
5. frontend inicia;
6. `/healthz` do frontend fica saudável;
7. Coolify passa a rotear o domínio.

O backend aceita até 30 tentativas de conexão inicial ao PostgreSQL por padrão.

## 6. Testes após deploy

No navegador:

```text
https://logs.seudominio.com.br
```

Teste público do backend pelo proxy:

```text
https://logs.seudominio.com.br/api/healthz
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "hezzuz-logs",
  "version": "3.1.0",
  "database": "ok"
}
```

Login:

```text
Usuário: valor de ADMIN_USERNAME (padrão admin)
Senha: SERVICE_PASSWORD_ADMIN
```

A autenticação 3.1 usa cookie `HttpOnly + SameSite=Strict`; a sessão não fica mais em `localStorage` e o WebSocket usa o mesmo cookie.

## 7. Configurar Survival

No `plugins/HezzChatDiscord/config.yml`:

```yaml
hezzuz-api:
  enabled: true
  endpoint: "https://logs.seudominio.com.br/api/v1/events/batch"
  heartbeat-url: "https://logs.seudominio.com.br/api/v1/heartbeat"
  server-id: "survival"
  api-key: "COLE_O_VALOR_DE_SERVICE_HEX_64_SURVIVAL"
  batch-size: 100
  flush-interval-ms: 500
  timeout-seconds: 8
  max-queue-files: 100000
```

Para Lobby, use `server-id: lobby` e a chave `SERVICE_HEX_64_LOBBY`.
Para SkyBlock, use `server-id: skyblock` e a chave `SERVICE_HEX_64_SKYBLOCK`.

Faça restart completo do servidor Paper após mudar o plugin/config.

## 8. Discord

O banco/site recebe todos os eventos independentemente do Discord.

Recomendado:

```env
DISCORD_FORWARD_MODE=critical
```

Opções:

- `off`: nenhum espelho para Discord;
- `critical`: punições, erros e eventos críticos;
- `all`: todos os eventos (não recomendado por rate limit do Discord).

Webhooks opcionais:

```env
DISCORD_WEBHOOK_DEFAULT=
DISCORD_WEBHOOK_MODERATION=
DISCORD_WEBHOOK_ERRORS=
DISCORD_WEBHOOK_SERVER=
```

## 9. Backups

O PostgreSQL é o dado principal do sistema. Configure backup automático no recurso PostgreSQL do Coolify.

Sugestão inicial:

- backup diário;
- retenção mínima de 7 dias;
- se possível, destino S3 compatível externo à VPS;
- teste de restauração antes de considerar o backup confiável.

## 10. O que foi reforçado na 3.1

- healthcheck real de backend + PostgreSQL;
- healthcheck do frontend;
- espera/retry do banco durante boot;
- shutdown gracioso para redeploy do Coolify;
- insert de eventos em lote no PostgreSQL;
- limpeza de retenção em lotes;
- índice BRIN para alto volume temporal;
- login com rate limit;
- sessão em cookie HttpOnly em vez de token no localStorage/query string;
- WebSocket autenticado por cookie e reconnect exponencial;
- ping/pong de WebSocket;
- CSP e headers de segurança no Nginx;
- cache de assets estáticos;
- containers sem portas públicas no host;
- backend executando como usuário não-root;
- filesystem read-only no backend;
- segredos gerados pelo próprio Coolify através de `SERVICE_*`.

## 11. Resetar senha do admin

Altere temporariamente `ADMIN_PASSWORD`/`SERVICE_PASSWORD_ADMIN` no Coolify e execute dentro do container backend:

```text
npm run reset-admin
```

Depois mantenha a variável sincronizada com a senha desejada.

## 12. Compose alternativo com PostgreSQL incluso

Existe:

```text
coolify/docker-compose.coolify-com-postgres.yml
```

Ele é útil para laboratório ou instalação tudo-em-um, mas para sua VPS recomendo o PostgreSQL como recurso separado do Coolify, pois facilita backup e manutenção independente.
