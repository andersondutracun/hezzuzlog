# Instalação — HEZZUZ Logs 3.0

## A. Banco PostgreSQL

Crie na sua VPS:

```sql
CREATE USER hezzuz_logs WITH PASSWORD 'SENHA_FORTE';
CREATE DATABASE hezzuz_logs OWNER hezzuz_logs ENCODING 'UTF8';
```

Você NÃO precisa criar tabelas: o backend faz as migrations sozinho.

## B. Backend + Frontend

1. Envie a pasta `HEZZUZ-Logs-3.0` para a VPS.
2. Copie `.env.example` para `.env`.
3. Ajuste `DATABASE_URL`.
4. Defina `ADMIN_PASSWORD`.
5. Gere `AUTH_SECRET`, por exemplo:

```bash
openssl rand -hex 32
```

6. Gere uma chave por servidor Paper:

```bash
openssl rand -hex 32
```

Exemplo:

```env
HEZZUZ_INGEST_KEYS={"survival":"SEGREDO1","lobby":"SEGREDO2","skyblock":"SEGREDO3"}
```

7. Suba:

```bash
docker compose up -d --build
```

8. Abra `http://IP:8080` e entre com `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### Coolify

- Repositório/projeto: esta pasta.
- Build: Docker Compose.
- Domínio público: serviço `frontend`, porta interna `80`.
- Sugestão: `logs.SEUDOMINIO`.
- Não precisa expor o backend na internet; o Nginx do frontend encaminha `/api` e `/ws`.

## C. Plugin Survival

1. Pare totalmente o Survival.
2. Faça backup de `plugins/HezzChatDiscord/` e do JAR 2.x.
3. Substitua pelo `plugin/HezzChatDiscord-3.0.0-HEZZUZ.jar`.
4. No seu `plugins/HezzChatDiscord/config.yml`, adicione/ajuste:

```yaml
hezzuz-api:
  enabled: true
  endpoint: "https://logs.SEUDOMINIO/api/v1/events/batch"
  heartbeat-url: "https://logs.SEUDOMINIO/api/v1/heartbeat"
  server-id: "survival"
  api-key: "SEGREDO1"
  batch-size: 100
  flush-interval-ms: 500
  timeout-seconds: 8
  max-queue-files: 100000

discord:
  direct-enabled: false
```

5. Para enviar o console inteiro ao site:

```yaml
paper-events:
  console-stream:
    enabled: true
    minimum-level: "INFO"
    stacktrace-lines: 16
```

6. Ligue o servidor normalmente. Não use PlugMan para trocar o JAR.

## D. Como validar

No boot procure:

```text
[HezzChatDiscord] [API] HEZZUZ Logs API ativa: server-id=survival...
Paper Native Audit 3.0 ativo...
```

Depois teste:

- entrar e sair;
- morrer;
- trocar de mundo;
- executar comando;
- fazer troca AxTrade;
- criar/remover QuickShop;
- punir conta teste via AdvancedBanZ;
- alterar permissão LuckPerms.

Os eventos devem aparecer no painel quase em tempo real.

## E. Se a API/site cair

O servidor Minecraft NÃO espera a API na thread principal.
Os eventos ficam em:

```text
plugins/HezzChatDiscord/api-queue/
```

Quando a API voltar, o plugin reenvia os lotes e apaga os arquivos somente após HTTP 2xx.

## F. Volume de dados

`INFO` captura praticamente o console inteiro e pode gerar muito volume. O sistema aguenta melhor que Discord porque usa lotes + PostgreSQL, mas armazenamento continua sendo finito.

Comece com:

```env
EVENT_RETENTION_DAYS=90
```

Se o banco crescer rápido, altere o console para:

```yaml
minimum-level: "WARNING"
```

Os eventos estruturados (join, quit, death, chat, moderação, economia etc.) continuam sendo armazenados normalmente.

## G. Discord

O recomendado é:

```env
DISCORD_FORWARD_MODE=critical
```

Assim 100% vai para PostgreSQL/site e só alertas importantes vão ao Discord.

Se usar `all`, o backend aplica fila/retry, mas o próprio Discord ainda pode responder HTTP 429. Isso não afeta a gravação no PostgreSQL.
