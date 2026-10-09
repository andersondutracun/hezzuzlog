package br.com.hezz.chatdiscord;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HEZZUZ 2.1 native Paper/Bukkit audit layer.
 * Kept reflection-only on purpose so it remains ABI-safe across Paper builds.
 */
public final class PaperNativeAudit {
    private static volatile Object plugin;
    private static volatile Object hooks;
    private static volatile NativeDispatcher dispatcher;
    private static final Map<String, Long> sessions = new ConcurrentHashMap<>();
    private static final Map<String, Long> severeDedupe = new ConcurrentHashMap<>();
    private static Handler consoleHandler;

    private static final Pattern DISCORD_WEBHOOK = Pattern.compile("https?://(?:canary\\.|ptb\\.)?(?:discord(?:app)?\\.com)/api/webhooks/\\S+", Pattern.CASE_INSENSITIVE);
    private static final Pattern SECRET_KV = Pattern.compile("(?i)(password|passwd|senha|token|secret|api[-_]?key|authorization)\\s*[:=]\\s*([^\\s,;]+)");
    private static final Pattern RETRY_AFTER = Pattern.compile("\\\"retry_after\\\"\\s*:\\s*([0-9.]+)");
    private static final Set<String> SENSITIVE_COMMANDS = Set.of(
            "login", "logar", "register", "registrar", "reg", "changepassword", "password", "passwd",
            "senha", "2fa", "auth", "pin", "secret", "token"
    );
    private static final Set<String> PRIVATE_MESSAGE_COMMANDS = Set.of(
            "msg", "tell", "w", "whisper", "pm", "r", "reply", "message", "m"
    );

    private PaperNativeAudit() {}

    public static synchronized void enable(Object pluginObj, Object ignoredLegacyWebhook) {
        if (pluginObj == null || dispatcher != null) return;
        plugin = pluginObj;
        dispatcher = new NativeDispatcher(pluginObj);

        if (!bool("paper-events.enabled", true)) {
            logInfo("Paper Native Audit desativado em paper-events.enabled.");
            return;
        }

        try {
            ClassLoader cl = pluginObj.getClass().getClassLoader();
            Class<?> hooksClass = Class.forName("br.com.hezz.chatdiscord.DynamicEventHooks", true, cl);
            hooks = hooksClass.getConstructor(pluginObj.getClass()).newInstance(pluginObj);
            Method hook = hooksClass.getMethod("hook", String.class, String.class, Consumer.class, String[].class);

            int active = 0;
            active += addHook(hook, "PaperJoin", "org.bukkit.event.player.PlayerJoinEvent", PaperNativeAudit::onJoin);
            active += addHook(hook, "PaperQuit", "org.bukkit.event.player.PlayerQuitEvent", PaperNativeAudit::onQuit);
            active += addHook(hook, "PaperKick", "org.bukkit.event.player.PlayerKickEvent", PaperNativeAudit::onKick);
            active += addHook(hook, "PaperLogin", "org.bukkit.event.player.PlayerLoginEvent", PaperNativeAudit::onLogin);
            active += addHook(hook, "PaperDeath", "org.bukkit.event.entity.PlayerDeathEvent", PaperNativeAudit::onDeath);
            active += addHook(hook, "PaperWorld", "org.bukkit.event.player.PlayerChangedWorldEvent", PaperNativeAudit::onWorldChange);
            active += addHook(hook, "PaperRespawn", "org.bukkit.event.player.PlayerRespawnEvent", PaperNativeAudit::onRespawn);
            active += addHook(hook, "PaperGamemode", "org.bukkit.event.player.PlayerGameModeChangeEvent", PaperNativeAudit::onGameMode);
            active += addHook(hook, "PaperAdvancement", "org.bukkit.event.player.PlayerAdvancementDoneEvent", PaperNativeAudit::onAdvancement);
            active += addHook(hook, "PaperCommand", "org.bukkit.event.player.PlayerCommandPreprocessEvent", PaperNativeAudit::onPlayerCommand);
            active += addHook(hook, "PaperConsoleCommand", "org.bukkit.event.server.ServerCommandEvent", PaperNativeAudit::onConsoleCommand);

            // AdvancedBanZ keeps AdvancedBan's Bukkit event API in current forks.
            active += addPluginHook(hook, "AdvancedBanZ-Punishment", "AdvancedBanZ",
                    new String[]{"me.leoko.advancedban.bukkit.event.PunishmentEvent"}, PaperNativeAudit::onPunishment);
            active += addPluginHook(hook, "AdvancedBanZ-Revoke", "AdvancedBanZ",
                    new String[]{"me.leoko.advancedban.bukkit.event.RevokePunishmentEvent"}, PaperNativeAudit::onPunishmentRevoke);

            setupConsoleSevereCapture();
            dispatcher.cleanupOldLogs();
            if (bool("paper-events.server-lifecycle", true)) {
                dispatcher.emit("server", "server", null,
                        "🟢 **[" + now() + "] [" + serverName() + "] SERVIDOR** • HezzChatDiscord **2.1.0-HEZZUZ** iniciado • Paper hooks: **" + active + "**");
            }
            logInfo("Paper Native Audit 3.0 ativo com " + active + " hook(s). HEZZUZ Logs API + logs locais/Discord conforme config.");
        } catch (Throwable t) {
            logWarn("Falha ao iniciar Paper Native Audit: " + t);
        }
    }

    public static synchronized void disable() {
        try {
            if (dispatcher != null && bool("paper-events.server-lifecycle", true)) {
                dispatcher.emit("server", "server", null,
                        "🔴 **[" + now() + "] [" + serverName() + "] SERVIDOR** • servidor/plugin encerrando.");
            }
            if (consoleHandler != null) {
                try { Logger.getLogger("").removeHandler(consoleHandler); } catch (Throwable ignored) {}
                consoleHandler = null;
            }
            if (dispatcher != null) dispatcher.close();
        } finally {
            dispatcher = null;
            hooks = null;
            plugin = null;
            sessions.clear();
            severeDedupe.clear();
        }
    }

    private static int addHook(Method hook, String label, String eventClass, Consumer<Object> consumer) {
        return addPluginHook(hook, label, "HezzChatDiscord", new String[]{eventClass}, consumer);
    }

    private static int addPluginHook(Method hook, String label, String pluginName, String[] eventClasses, Consumer<Object> consumer) {
        try {
            Object ok = hook.invoke(hooks, label, pluginName, consumer, eventClasses);
            return Boolean.TRUE.equals(ok) ? 1 : 0;
        } catch (Throwable t) {
            debug("Hook " + label + " indisponivel: " + t.getClass().getSimpleName() + ": " + t.getMessage());
            return 0;
        }
    }

    private static void onJoin(Object event) {
        if (!bool("paper-events.joins", true)) return;
        Object player = call(event, "getPlayer");
        String name = playerName(player);
        String key = playerKey(player);
        sessions.put(key, System.currentTimeMillis());
        boolean first = !asBoolean(call(player, "hasPlayedBefore"), true);
        int online = onlineCount();
        String loc = bool("paper-events.include-location", true) ? " • `" + location(call(player, "getLocation")) + "`" : "";
        String tag = first && bool("paper-events.first-join", true) ? "✨ **PRIMEIRA ENTRADA**" : "🟢 **ENTRADA**";
        emit("server", "activity", player, tag + " • **" + esc(name) + "** entrou no servidor" + loc + " • online: **" + online + "**");
    }

    private static void onQuit(Object event) {
        if (!bool("paper-events.quits", true)) return;
        Object player = call(event, "getPlayer");
        String name = playerName(player);
        Long started = sessions.remove(playerKey(player));
        String session = started == null ? "" : " • sessão: **" + duration(System.currentTimeMillis() - started) + "**";
        String loc = bool("paper-events.include-location", true) ? " • `" + location(call(player, "getLocation")) + "`" : "";
        emit("server", "activity", player, "🔴 **SAÍDA** • **" + esc(name) + "** saiu do servidor" + session + loc);
    }

    private static void onKick(Object event) {
        if (!bool("paper-events.kicks", true)) return;
        Object player = call(event, "getPlayer");
        String reason = firstText(event, "getReason", "reason");
        if (reason.equals("-")) reason = firstText(event, "getLeaveMessage");
        sessions.remove(playerKey(player));
        emit("server", "activity", player, "🟠 **KICK** • **" + esc(playerName(player)) + "** foi removido • motivo: `" + esc(redact(reason)) + "`");
    }

    private static void onLogin(Object event) {
        if (!bool("paper-events.denied-logins", true)) return;
        String result = firstText(event, "getResult");
        if (result.equalsIgnoreCase("ALLOWED") || result.equals("-")) return;
        Object player = call(event, "getPlayer");
        String msg = firstText(event, "getKickMessage", "kickMessage");
        emit("server", "activity", player, "⛔ **LOGIN RECUSADO** • **" + esc(playerName(player)) + "** • `" + esc(result) + "` • " + esc(redact(msg)));
    }

    private static void onDeath(Object event) {
        if (!bool("paper-events.deaths", true)) return;
        Object player = call(event, "getEntity", "getPlayer");
        String name = playerName(player);
        String death = firstText(event, "getDeathMessage");
        Object killer = call(player, "getKiller");
        Object damage = call(player, "getLastDamageCause");
        String cause = firstText(damage, "getCause");
        String killerPart = killer == null ? "" : " • killer: **" + esc(playerName(killer)) + "**";
        String loc = bool("paper-events.include-location", true) ? " • `" + location(call(player, "getLocation")) + "`" : "";
        if (death.equals("-")) death = name + " morreu";
        emit("gameplay", "death", player, "💀 **MORTE** • " + esc(death) + killerPart + " • causa: `" + esc(cause) + "`" + loc);
    }

    private static void onWorldChange(Object event) {
        if (!bool("paper-events.world-changes", true)) return;
        Object player = call(event, "getPlayer");
        Object from = call(event, "getFrom");
        Object to = call(player, "getWorld");
        String fromName = firstText(from, "getName");
        String toName = firstText(to, "getName");
        emit("gameplay", "world", player, "🌍 **MUNDO** • **" + esc(playerName(player)) + "**: `" + esc(fromName) + "` → `" + esc(toName) + "`");
    }

    private static void onRespawn(Object event) {
        if (!bool("paper-events.respawns", false)) return;
        Object player = call(event, "getPlayer");
        Object loc = call(event, "getRespawnLocation");
        emit("gameplay", "respawn", player, "♻️ **RESPAWN** • **" + esc(playerName(player)) + "** • `" + location(loc) + "`");
    }

    private static void onGameMode(Object event) {
        if (!bool("paper-events.gamemode-changes", true)) return;
        Object player = call(event, "getPlayer");
        String oldMode = firstText(player, "getGameMode");
        String newMode = firstText(event, "getNewGameMode");
        emit("server", "staff", player, "🎮 **GAMEMODE** • **" + esc(playerName(player)) + "**: `" + esc(oldMode) + "` → `" + esc(newMode) + "`");
    }

    private static void onAdvancement(Object event) {
        if (!bool("paper-events.advancements", false)) return;
        Object player = call(event, "getPlayer");
        Object adv = call(event, "getAdvancement");
        Object key = call(adv, "getKey");
        String id = key == null ? String.valueOf(adv) : String.valueOf(key);
        if (id.contains("recipes/")) return;
        emit("gameplay", "advancement", player, "🏆 **CONQUISTA** • **" + esc(playerName(player)) + "** concluiu `" + esc(id) + "`");
    }

    private static void onPlayerCommand(Object event) {
        if (!bool("paper-events.commands.players", true)) return;
        Object player = call(event, "getPlayer");
        String raw = firstText(event, "getMessage");
        if (raw.equals("-")) return;
        String safe = redactCommand(raw);
        String root = commandRoot(raw);
        List<String> ignored = stringList("paper-events.commands.ignore");
        if (ignored.isEmpty()) ignored = List.of("afk", "ping");
        for (String s : ignored) if (root.equalsIgnoreCase(stripSlash(s))) return;
        emit("server", "commands", player, "⌨️ **COMANDO** • **" + esc(playerName(player)) + "**: `" + esc(safe) + "`");
    }

    private static void onConsoleCommand(Object event) {
        if (!bool("paper-events.commands.console", false)) return;
        String raw = firstText(event, "getCommand");
        if (raw.equals("-")) return;
        String root = commandRoot(raw);
        // Prevent floods from bulk LuckPerms/Skript automation unless explicitly opted in.
        if (!bool("paper-events.commands.console-log-luckperms", false) && (root.equals("lp") || root.equals("luckperms"))) return;
        emit("server", "commands", null, "🖥️ **CONSOLE** • `" + esc(redactCommand(raw)) + "`");
    }

    private static void onPunishment(Object event) {
        if (!bool("integrations.advancedbanz.enabled", bool("integrations.advancedban.enabled", true))) return;
        Object p = call(event, "getPunishment");
        if (p == null) p = event;
        String type = firstText(p, "getType");
        String target = firstText(p, "getName", "getPunishedName", "getUuid");
        String actor = firstText(p, "getOperator", "getPunisher");
        String reason = firstText(p, "getReason");
        String duration = firstText(p, "getDuration", "getEnd");
        String id = firstText(p, "getId");
        emit("moderation", "moderation", null, "🔨 **AdvancedBanZ • " + esc(type) + "** • alvo: **" + esc(target) + "** • por: **" + esc(actor) + "** • motivo: `" + esc(redact(reason)) + "` • duração/fim: `" + esc(duration) + "` • id: `" + esc(id) + "`");
    }

    private static void onPunishmentRevoke(Object event) {
        if (!bool("integrations.advancedbanz.enabled", bool("integrations.advancedban.enabled", true))) return;
        Object p = call(event, "getPunishment");
        if (p == null) p = event;
        String type = firstText(p, "getType");
        String target = firstText(p, "getName", "getPunishedName", "getUuid");
        String actor = firstText(event, "getOperator", "getPunisher");
        emit("moderation", "moderation", null, "♻️ **AdvancedBanZ • REVOGAÇÃO** • `" + esc(type) + "` de **" + esc(target) + "** • por: **" + esc(actor) + "**");
    }

    private static void setupConsoleSevereCapture() {
        if (!bool("paper-events.console-stream.enabled", true) && !bool("paper-events.console-errors.enabled", true)) return;
        consoleHandler = new Handler() {
            @Override public void publish(LogRecord record) {
                try {
                    if (record == null) return;
                    String logger = String.valueOf(record.getLoggerName());
                    if (logger.toLowerCase(Locale.ROOT).contains("hezzchatdiscord") || logger.toLowerCase(Locale.ROOT).contains("hezzlogs")) return;

                    Level minimum = parseLevel(string("paper-events.console-stream.minimum-level", "INFO"), Level.INFO);
                    if (record.getLevel().intValue() < minimum.intValue()) return;

                    String msg = String.valueOf(record.getMessage());
                    StringBuilder raw = new StringBuilder(redact(msg));
                    if (record.getThrown() != null) {
                        Throwable t = record.getThrown();
                        raw.append(" | ").append(t.getClass().getName()).append(": ").append(redact(String.valueOf(t.getMessage())));
                        StackTraceElement[] stack = t.getStackTrace();
                        int max = Math.min(stack.length, (int)Math.max(1L, longValue("paper-events.console-stream.stacktrace-lines", 16L)));
                        for (int i=0;i<max;i++) raw.append("\n  at ").append(stack[i]);
                    }

                    HezzLogsApiClient api = HezzLogsApiClient.get();
                    if (api != null && bool("paper-events.console-stream.enabled", true)) {
                        api.emitConsole(record.getLevel().getName(), logger, raw.toString());
                    }

                    if (record.getLevel().intValue() < Level.SEVERE.intValue() || !bool("paper-events.console-errors.enabled", true)) return;
                    String key = logger + "|" + msg;
                    long now = System.currentTimeMillis();
                    long window = longValue("paper-events.console-errors.dedupe-seconds", 60L) * 1000L;
                    Long prev = severeDedupe.put(key, now);
                    if (prev != null && now - prev < window) return;
                    severeDedupe.entrySet().removeIf(e -> now - e.getValue() > Math.max(window * 3, 180_000L));
                    NativeDispatcher d = dispatcher;
                    if (d != null) d.emit("server", "errors", null,
                            "**[" + now() + "] [" + esc(serverName()) + "]** 🚨 **ERRO SEVERO DO SERVIDOR** • `" + esc(logger) + "` • " + esc(raw.toString()));
                } catch (Throwable ignored) {}
            }
            @Override public void flush() {}
            @Override public void close() {}
        };
        Logger.getLogger("").addHandler(consoleHandler);
    }

    private static Level parseLevel(String value, Level def) {
        try { return Level.parse(String.valueOf(value).toUpperCase(Locale.ROOT)); }
        catch (Throwable ignored) { return def; }
    }

    private static void emit(String target, String category, Object player, String body) {
        String content = "**[" + now() + "] [" + esc(serverName()) + "]** " + body;
        HezzLogsApiClient api = HezzLogsApiClient.get();
        if (api != null) {
            String uuid = player == null ? null : firstText(player, "getUniqueId");
            String name = player == null ? null : playerName(player);
            api.emitNative(eventType(category, body), category, eventSeverity(category, body), uuid, name, redact(body), "{}");
        }
        NativeDispatcher d = dispatcher;
        if (d == null) return;
        String avatar = player == null ? null : avatar(player);
        d.emit(target, category, avatar, content);
    }

    private static String eventType(String category, String body) {
        String b = String.valueOf(body).toUpperCase(Locale.ROOT);
        if (b.contains("PRIMEIRA ENTRADA")) return "FIRST_JOIN";
        if (b.contains("ENTRADA")) return "JOIN";
        if (b.contains("SAÍDA") || b.contains("SAIDA")) return "QUIT";
        if (b.contains("KICK")) return "KICK";
        if (b.contains("LOGIN RECUSADO")) return "LOGIN_DENIED";
        if (b.contains("MORTE")) return "DEATH";
        if (b.contains("MUNDO")) return "WORLD_CHANGE";
        if (b.contains("GAMEMODE")) return "GAMEMODE_CHANGE";
        if (b.contains("RESPAWN")) return "RESPAWN";
        if (b.contains("CONQUISTA")) return "ADVANCEMENT";
        if (b.contains("COMANDO")) return "PLAYER_COMMAND";
        if (b.contains("ADVANCEDBANZ") && b.contains("REVOGA")) return "PUNISHMENT_REVOKE";
        if (b.contains("ADVANCEDBANZ")) return "PUNISHMENT";
        return String.valueOf(category).replaceAll("[^a-zA-Z0-9_-]", "_").toUpperCase(Locale.ROOT);
    }

    private static String eventSeverity(String category, String body) {
        if ("errors".equalsIgnoreCase(category)) return "CRITICAL";
        if ("moderation".equalsIgnoreCase(category)) return "WARNING";
        String b = String.valueOf(body).toUpperCase(Locale.ROOT);
        if (b.contains("KICK") || b.contains("LOGIN RECUSADO")) return "WARNING";
        return "INFO";
    }

    private static String avatar(Object player) {
        if (!bool("discord.use-player-avatar", true) || player == null) return null;
        String tpl = string("discord.player-avatar-url", "https://mc-heads.net/avatar/{uuid}/128");
        return tpl.replace("{uuid}", firstText(player, "getUniqueId")).replace("{name}", playerName(player));
    }

    private static String redactCommand(String input) {
        if (input == null) return "";
        String s = input.trim();
        String root = commandRoot(s);
        if (SENSITIVE_COMMANDS.contains(root)) return (s.startsWith("/") ? "/" : "") + root + " [CONTEÚDO OCULTO]";
        if (PRIVATE_MESSAGE_COMMANDS.contains(root)) return (s.startsWith("/") ? "/" : "") + root + " [MENSAGEM PRIVADA OCULTA]";
        return redact(s);
    }

    private static String commandRoot(String s) {
        if (s == null) return "";
        s = stripSlash(s.trim());
        int i = s.indexOf(' ');
        return (i < 0 ? s : s.substring(0, i)).toLowerCase(Locale.ROOT);
    }

    private static String stripSlash(String s) {
        if (s == null) return "";
        s = s.trim();
        while (s.startsWith("/")) s = s.substring(1);
        return s;
    }

    private static String redact(String s) {
        if (s == null) return "";
        s = DISCORD_WEBHOOK.matcher(s).replaceAll("[WEBHOOK_OCULTO]");
        Matcher m = SECRET_KV.matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + "=[OCULTO]"));
        m.appendTail(sb);
        s = sb.toString();
        if (s.length() > 1600) s = s.substring(0, 1600) + "…";
        return s;
    }

    private static String esc(String s) {
        if (s == null) return "";
        return redact(s).replace("\\", "\\\\").replace("*", "\\*").replace("_", "\\_").replace("~", "\\~").replace("`", "\\`").replace("|", "\\|").replace("@everyone", "@ everyone").replace("@here", "@ here");
    }

    private static String location(Object loc) {
        if (loc == null) return "-";
        Object world = call(loc, "getWorld");
        String wn = world == null ? "world" : firstText(world, "getName");
        return wn + " " + intText(call(loc, "getBlockX", "getX")) + " " + intText(call(loc, "getBlockY", "getY")) + " " + intText(call(loc, "getBlockZ", "getZ"));
    }

    private static String intText(Object n) {
        if (n instanceof Number) return String.valueOf(((Number)n).intValue());
        return n == null ? "?" : String.valueOf(n);
    }

    private static String playerKey(Object p) {
        Object u = call(p, "getUniqueId");
        return u == null ? playerName(p).toLowerCase(Locale.ROOT) : String.valueOf(u);
    }

    private static String playerName(Object p) {
        if (p == null) return "desconhecido";
        Object n = call(p, "getName");
        return n == null ? String.valueOf(p) : String.valueOf(n);
    }

    private static int onlineCount() {
        try {
            Object server = call(plugin, "getServer");
            Object players = call(server, "getOnlinePlayers");
            if (players instanceof Collection<?>) return ((Collection<?>) players).size();
        } catch (Throwable ignored) {}
        return -1;
    }

    private static String duration(long ms) {
        long sec = Math.max(0, ms / 1000);
        long h = sec / 3600; sec %= 3600;
        long m = sec / 60; sec %= 60;
        if (h > 0) return h + "h " + m + "m";
        if (m > 0) return m + "m " + sec + "s";
        return sec + "s";
    }

    private static String now() {
        String zone = string("logging.timezone", "America/Sao_Paulo");
        String fmt = string("logging.datetime-format", "dd/MM/yyyy HH:mm:ss");
        try { return DateTimeFormatter.ofPattern(fmt).format(ZonedDateTime.now(ZoneId.of(zone))); }
        catch (Throwable t) { return DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss").format(ZonedDateTime.now()); }
    }

    private static String serverName() { return string("server-name", "Servidor"); }

    private static Object config() { return call(plugin, "getConfig"); }

    private static boolean bool(String path, boolean def) {
        try {
            Object cfg = config();
            Method m = cfg.getClass().getMethod("getBoolean", String.class, boolean.class);
            return Boolean.TRUE.equals(m.invoke(cfg, path, def));
        } catch (Throwable t) { return def; }
    }

    private static long longValue(String path, long def) {
        try {
            Object cfg = config();
            try {
                Method m = cfg.getClass().getMethod("getLong", String.class, long.class);
                Object v = m.invoke(cfg, path, def);
                if (v instanceof Number) return ((Number) v).longValue();
            } catch (NoSuchMethodException ignored) {}
            Method m = cfg.getClass().getMethod("getInt", String.class, int.class);
            Object v = m.invoke(cfg, path, (int)Math.min(Integer.MAX_VALUE, def));
            return v instanceof Number ? ((Number)v).longValue() : def;
        } catch (Throwable t) { return def; }
    }

    private static String string(String path, String def) {
        try {
            Object cfg = config();
            Method m = cfg.getClass().getMethod("getString", String.class, String.class);
            Object v = m.invoke(cfg, path, def);
            return v == null ? def : String.valueOf(v);
        } catch (Throwable t) { return def; }
    }

    @SuppressWarnings("unchecked")
    private static List<String> stringList(String path) {
        try {
            Object cfg = config();
            Method m = cfg.getClass().getMethod("getStringList", String.class);
            Object v = m.invoke(cfg, path);
            if (v instanceof List<?>) {
                List<String> out = new ArrayList<>();
                for (Object o : (List<?>)v) out.add(String.valueOf(o));
                return out;
            }
        } catch (Throwable ignored) {}
        return List.of();
    }

    private static Object call(Object target, String... methods) {
        if (target == null) return null;
        for (String name : methods) {
            try {
                Method m = target.getClass().getMethod(name);
                m.setAccessible(true);
                return m.invoke(target);
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private static String firstText(Object target, String... methods) {
        Object o = call(target, methods);
        if (o == null) return "-";
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? "-" : s;
    }

    private static boolean asBoolean(Object o, boolean def) { return o instanceof Boolean ? (Boolean)o : def; }

    private static void logInfo(String msg) { log("info", msg); }
    private static void logWarn(String msg) { log("warning", msg); }
    private static void debug(String msg) { if (bool("debug", false)) log("info", "[DEBUG] " + msg); }
    private static void log(String method, String msg) {
        try {
            Object logger = call(plugin, "getLogger");
            Method m = logger.getClass().getMethod(method, String.class);
            m.invoke(logger, msg);
        } catch (Throwable ignored) { System.out.println("[HezzChatDiscord] " + msg); }
    }

    private static final class NativeDispatcher implements AutoCloseable {
        private final Object plugin;
        private final ExecutorService executor;
        private final HttpClient http;
        private volatile long lastSend;

        NativeDispatcher(Object plugin) {
            this.plugin = plugin;
            this.executor = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "HezzLogger-Native");
                t.setDaemon(true);
                return t;
            });
            this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).executor(executor).build();
        }

        void emit(String target, String category, String avatar, String content) {
            final String safe = redact(content);
            executor.execute(() -> {
                try {
                    writeLocal(category, safe);
                    String url = resolveWebhook(target);
                    if (url.isBlank()) return;
                    long throttle = Math.max(0L, longValue("paper-events.discord-throttle-ms", 350L));
                    long wait = throttle - (System.currentTimeMillis() - lastSend);
                    if (wait > 0) Thread.sleep(wait);
                    post(url, avatar, safe);
                    lastSend = System.currentTimeMillis();
                } catch (Throwable t) {
                    logWarn("Falha no dispatcher nativo: " + t.getMessage());
                }
            });
        }

        private void post(String url, String avatar, String content) throws Exception {
            String username = string("paper-events.webhook-username", "HEZZUZ • " + serverName());
            StringBuilder json = new StringBuilder("{\"username\":\"").append(json(username)).append("\"");
            if (avatar != null && !avatar.isBlank()) json.append(",\"avatar_url\":\"").append(json(avatar)).append("\"");
            json.append(",\"content\":\"").append(json(limit(content, 1950))).append("\"}");
            int attempts = 0;
            while (attempts++ < 3) {
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofSeconds(Math.max(2L, longValue("discord.timeout-seconds", 8L))))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json.toString(), StandardCharsets.UTF_8)).build();
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (resp.statusCode() >= 200 && resp.statusCode() < 300) return;
                if (resp.statusCode() == 429) {
                    long sleep = retryMillis(resp);
                    Thread.sleep(Math.min(Math.max(sleep, 500L), 15_000L));
                    continue;
                }
                logWarn("Discord nativo retornou HTTP " + resp.statusCode());
                return;
            }
        }

        private long retryMillis(HttpResponse<String> resp) {
            try {
                String h = resp.headers().firstValue("Retry-After").orElse("");
                if (!h.isBlank()) {
                    double v = Double.parseDouble(h);
                    return v > 50 ? (long)v : (long)(v * 1000.0);
                }
            } catch (Throwable ignored) {}
            try {
                Matcher m = RETRY_AFTER.matcher(resp.body() == null ? "" : resp.body());
                if (m.find()) return (long)(Double.parseDouble(m.group(1)) * 1000.0);
            } catch (Throwable ignored) {}
            return 1500L;
        }

        private String resolveWebhook(String target) {
            if (!bool("discord.direct-enabled", false)) return "";
            String direct = cleanUrl(string("discord." + target + "-webhook-url", ""));
            if (!direct.isBlank()) return direct;
            String audit = cleanUrl(string("discord.audit-webhook-url", ""));
            if (!audit.isBlank()) return audit;
            return cleanUrl(string("discord.public-webhook-url", ""));
        }

        private String cleanUrl(String u) {
            if (u == null) return "";
            u = u.trim();
            if (u.isEmpty() || u.toUpperCase(Locale.ROOT).contains("COLE_AQUI")) return "";
            return u;
        }

        private void writeLocal(String category, String content) {
            if (!bool("paper-events.local-log.enabled", true)) return;
            try {
                File data = (File) call(plugin, "getDataFolder");
                if (data == null) return;
                Path dir = data.toPath().resolve("logs").resolve("native");
                Files.createDirectories(dir);
                String date = DateTimeFormatter.ofPattern("yyyy-MM-dd").format(ZonedDateTime.now(ZoneId.of(string("logging.timezone", "America/Sao_Paulo"))));
                Path file = dir.resolve(category + "-" + date + ".log");
                Files.writeString(file, content + System.lineSeparator(), StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (Throwable t) { debug("Log local: " + t.getMessage()); }
        }

        void cleanupOldLogs() {
            executor.execute(() -> {
                if (!bool("paper-events.local-log.enabled", true)) return;
                int days = (int)Math.max(1, longValue("paper-events.local-log.retention-days", 30L));
                try {
                    File data = (File) call(plugin, "getDataFolder");
                    if (data == null) return;
                    Path dir = data.toPath().resolve("logs").resolve("native");
                    if (!Files.isDirectory(dir)) return;
                    long cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(days);
                    try (var stream = Files.list(dir)) {
                        stream.filter(Files::isRegularFile).forEach(p -> {
                            try { if (Files.getLastModifiedTime(p).toMillis() < cutoff) Files.deleteIfExists(p); }
                            catch (IOException ignored) {}
                        });
                    }
                } catch (Throwable ignored) {}
            });
        }

        @Override public void close() {
            executor.shutdown();
            try { executor.awaitTermination(2, TimeUnit.SECONDS); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }

        private String json(String s) {
            if (s == null) return "";
            StringBuilder b = new StringBuilder(s.length() + 16);
            for (char c : s.toCharArray()) {
                switch (c) {
                    case '\\': b.append("\\\\"); break;
                    case '"': b.append("\\\""); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default: if (c < 32) b.append(' '); else b.append(c);
                }
            }
            return b.toString();
        }

        private String limit(String s, int max) { return s.length() <= max ? s : s.substring(0, max - 1) + "…"; }
    }
}
