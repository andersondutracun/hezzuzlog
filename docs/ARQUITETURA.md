# HEZZUZ Logs 3.0 — Arquitetura

```text
Paper / HezzChatDiscord 3.0
        |
        | HTTPS + HMAC SHA-256
        | POST /api/v1/events/batch
        v
HEZZUZ Logs Backend (Node.js)
        |-- PostgreSQL: 100% dos eventos
        |-- WebSocket: painel em tempo real
        |-- Discord router: somente o que for configurado
        v
React Dashboard / Nginx
```

## Por que isso evita travamentos/rate limit

O Minecraft nao conversa mais com o Discord para cada evento como fonte principal.
O plugin grava os eventos numa fila local e envia em lotes para a API em thread separada.
Se a API estiver indisponivel, os arquivos permanecem em `plugins/HezzChatDiscord/api-queue/` e sao reenviados depois.

O backend salva primeiro no PostgreSQL. O Discord vira apenas um espelho opcional.
`DISCORD_FORWARD_MODE=critical` e o modo recomendado. `all` existe, mas pode sofrer HTTP 429 do Discord.

## Seguranca

- cada servidor possui um segredo HMAC diferente;
- timestamp + nonce impedem replay simples;
- API key nunca e enviada no corpo nem salva nos eventos;
- senhas, tokens e mensagens privadas continuam sendo redigidos pelo plugin;
- o backend deve ser publicado somente por HTTPS;
- painel usa senha com scrypt e token assinado HMAC-SHA256;
- frontend acessa backend pela mesma origem via Nginx.
