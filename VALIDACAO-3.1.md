# Validação HEZZUZ Logs 3.1

Validações offline executadas antes da entrega:

- JavaScript do backend: `node --check` OK;
- YAML de todos os arquivos `.yml`: parser OK;
- compose principal: sem portas públicas do backend;
- healthchecks presentes em backend e frontend;
- endpoint externo de diagnóstico: `/api/healthz`;
- backend com retry do PostgreSQL e shutdown gracioso;
- autenticação do dashboard migrada de localStorage/query string para cookie HttpOnly;
- API HMAC do plugin preservada, portanto HezzChatDiscord 3.0 continua compatível.

Não foi possível executar um deploy Docker real neste ambiente. O primeiro teste integral deve ser feito no Coolify com PostgreSQL real e HTTPS.
