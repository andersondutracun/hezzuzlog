# HEZZUZ Logs 3.1 — Coolify Edition

Central de auditoria da rede HEZZUZ:

- plugin Paper `HezzChatDiscord 3.0`;
- API Node.js/Express;
- PostgreSQL;
- painel React em tempo real;
- WebSocket;
- espelho opcional para Discord;
- deploy preparado especificamente para Coolify.

## Arquitetura recomendada

```text
Survival / Lobby / SkyBlock
          │
          ▼
HezzChatDiscord 3.0
          │ HTTPS + HMAC + batch
          ▼
     frontend Nginx
       │       │
     /api     /ws
       │       │
       └── backend 3.1
              │
              ▼
         PostgreSQL
```

O PostgreSQL deve preferencialmente ser criado como **recurso separado no Coolify**. O aplicativo usa a URL interna; não é necessário expor a porta 5432.

## Comece aqui

Leia:

`COOLIFY-DEPLOY.md`

O `docker-compose.yml` da raiz já é a versão recomendada para Coolify.

## Serviços públicos

Somente:

```text
frontend :80
```

deve receber domínio público.

O backend fica privado na rede Docker:

```text
backend :3001
```

## Segredos automáticos do Coolify

O Compose usa variáveis mágicas do Coolify para gerar automaticamente:

- senha inicial do admin;
- segredo das sessões;
- chave HMAC do Survival;
- chave HMAC do Lobby;
- chave HMAC do SkyBlock.

Você só precisa copiar a chave HMAC correspondente para cada plugin Paper.

## Principais melhorias da 3.1

- deploy Coolify sem `ports:` publicados no host;
- healthchecks independentes;
- retry de PostgreSQL no startup;
- shutdown gracioso em redeploy;
- inserção SQL realmente em lote;
- retenção em lotes;
- BRIN para consultas temporais de grande volume;
- login protegido contra brute force;
- sessão `HttpOnly/SameSite=Strict`;
- token removido de `localStorage` e da URL do WebSocket;
- WebSocket com reconnect e ping/pong;
- CSP e headers de segurança;
- backend não-root e filesystem read-only;
- proxy `/api` + `/ws` pronto para HTTPS do Coolify.

## Plugin

O protocolo da API continua compatível com:

`plugin/HezzChatDiscord-3.0.0-HEZZUZ.jar`

Use o snippet:

`plugin/CONFIG/COOLIFY-HEZZUZ-API.yml`

## Compose alternativo

`coolify/docker-compose.coolify-com-postgres.yml`

inclui PostgreSQL dentro do mesmo stack. É útil para testes, porém a instalação recomendada em produção é banco separado para facilitar backup e manutenção.
