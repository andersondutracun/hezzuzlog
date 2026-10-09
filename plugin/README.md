# HezzChatDiscord 3.0.0-HEZZUZ

Patch da 2.1.0 para centralizar os logs na HEZZUZ Logs API.

## Alteracoes

- todo envio legado do HezzChatDiscord (chat, cla, staff, LuckPerms, QuickShop, crates, PlayerPoints, BetterRTP, RedProtect, AxTrade, InventoryRollback e moderacao) tambem vira evento da API;
- eventos nativos Paper (join/quit/death/world/gamemode/commands etc.) vao para API;
- stream do console INFO/WARNING/SEVERE pode ir para API;
- fila duravel em `plugins/HezzChatDiscord/api-queue/`;
- envio em lote;
- HMAC SHA-256 por servidor;
- heartbeat a cada 30 segundos;
- Discord direto desligado por padrao;
- webhooks antigos continuam compativeis se `discord.direct-enabled: true`.

Use `CONFIG/config-3.0.yml` como referencia. Se seu config atual possui URLs reais, prefira mesclar somente as novas secoes em vez de sobrescrever sem backup.
