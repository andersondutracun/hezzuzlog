package br.com.hezz.chatdiscord;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.File;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/** Durable HEZZUZ Logs API client. Uses reflection to remain ABI-safe across Paper builds. */
public final class HezzLogsApiClient implements AutoCloseable {
    private static volatile HezzLogsApiClient INSTANCE;
    private final Object plugin;
    private final ScheduledExecutorService worker;
    private final HttpClient http;
    private final SecureRandom random = new SecureRandom();
    private volatile boolean enabled;
    private volatile String endpoint;
    private volatile String heartbeatUrl;
    private volatile String serverId;
    private volatile String apiKey;
    private volatile int batchSize;
    private volatile int timeoutSeconds;
    private volatile Path queueDir;
    private volatile long backoffUntil;
    private volatile boolean closed;

    private HezzLogsApiClient(Object plugin) {
        this.plugin = plugin;
        this.worker = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "HezzLogs-API");
            t.setDaemon(true);
            return t;
        });
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        reload();
        long flush = Math.max(250L, longValue("hezzuz-api.flush-interval-ms", 1000L));
        worker.scheduleWithFixedDelay(this::flushSafe, 2_000L, flush, TimeUnit.MILLISECONDS);
        worker.scheduleWithFixedDelay(this::heartbeatSafe, 5_000L, 30_000L, TimeUnit.MILLISECONDS);
        if (enabled) info("HEZZUZ Logs API ativa: server-id=" + serverId + ", lote=" + batchSize + ", fila=" + queueDir);
    }

    public static synchronized HezzLogsApiClient init(Object plugin) {
        if (INSTANCE == null) INSTANCE = new HezzLogsApiClient(plugin);
        else INSTANCE.reload();
        return INSTANCE;
    }

    public static HezzLogsApiClient get() { return INSTANCE; }
    public boolean isEnabled() { return enabled && !closed; }

    public void reload() {
        this.enabled = bool("hezzuz-api.enabled", false);
        this.endpoint = string("hezzuz-api.endpoint", "").trim();
        this.heartbeatUrl = string("hezzuz-api.heartbeat-url", "").trim();
        this.serverId = string("hezzuz-api.server-id", "survival").trim().toLowerCase(Locale.ROOT);
        this.apiKey = string("hezzuz-api.api-key", "").trim();
        this.batchSize = Math.max(1, Math.min(100, intValue("hezzuz-api.batch-size", 50)));
        this.timeoutSeconds = Math.max(2, intValue("hezzuz-api.timeout-seconds", 8));
        if (heartbeatUrl.isBlank() && endpoint.endsWith("/events/batch")) heartbeatUrl = endpoint.substring(0, endpoint.length()-"/events/batch".length()) + "/heartbeat";
        File data = (File) call(plugin, "getDataFolder");
        this.queueDir = data == null ? Path.of("plugins/HezzChatDiscord/api-queue") : data.toPath().resolve("api-queue");
        if (enabled && (endpoint.isBlank() || apiKey.isBlank() || serverId.isBlank())) {
            warn("hezzuz-api.enabled=true, mas endpoint/server-id/api-key nao estao completos. API desativada ate corrigir o config.");
            this.enabled = false;
        }
        try { Files.createDirectories(queueDir); } catch (Exception e) { warn("Nao foi possivel criar fila API: " + e.getMessage()); }
    }

    public void emitLegacy(String target, String username, String avatar, String content) {
        String category = safeCategory(target);
        String type = "PLUGIN_" + category.toUpperCase(Locale.ROOT);
        String severity = category.equals("moderation") ? "WARNING" : "INFO";
        String data = "{\"webhook_target\":\"" + json(target) + "\",\"webhook_username\":\"" + json(username) + "\",\"avatar\":\"" + json(avatar) + "\"}";
        enqueue(eventJson(type, category, severity, "hezzchatdiscord-legacy", null, null, content, data));
    }

    public void emitNative(String type, String category, String severity, String playerUuid, String playerName, String message, String dataJson) {
        enqueue(eventJson(type, safeCategory(category), normalizeSeverity(severity), "paper-native", playerUuid, playerName, message, dataJson == null || dataJson.isBlank() ? "{}" : dataJson));
    }

    public void emitConsole(String level, String logger, String message) {
        String sev = switch (String.valueOf(level).toUpperCase(Locale.ROOT)) {
            case "SEVERE" -> "CRITICAL";
            case "WARNING", "WARN" -> "WARNING";
            default -> "INFO";
        };
        String data = "{\"logger\":\"" + json(logger) + "\",\"level\":\"" + json(level) + "\"}";
        emitNative("CONSOLE_" + String.valueOf(level).toUpperCase(Locale.ROOT), "console", sev, null, null, message, data);
    }

    private String eventJson(String type, String category, String severity, String source, String playerUuid, String playerName, String message, String data) {
        return "{" +
            "\"id\":\"" + UUID.randomUUID() + "\"," +
            "\"server_id\":\"" + json(serverId) + "\"," +
            "\"type\":\"" + json(type) + "\"," +
            "\"category\":\"" + json(category) + "\"," +
            "\"severity\":\"" + json(severity) + "\"," +
            "\"source\":\"" + json(source) + "\"," +
            "\"player_uuid\":" + nullable(playerUuid) + "," +
            "\"player_name\":" + nullable(playerName) + "," +
            "\"message\":\"" + json(limit(redact(message), 12000)) + "\"," +
            "\"data\":" + (data == null ? "{}" : data) + "," +
            "\"occurred_at\":\"" + Instant.now().toString() + "\"}";
    }

    private void enqueue(String event) {
        if (!isEnabled() || event == null) return;
        worker.execute(() -> {
            try {
                Files.createDirectories(queueDir);
                String name = System.currentTimeMillis() + "-" + UUID.randomUUID() + ".json";
                Files.writeString(queueDir.resolve(name), event, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
                enforceQueueLimit();
            } catch (Throwable t) { warn("Falha ao persistir evento na fila: " + t.getMessage()); }
        });
    }

    private void enforceQueueLimit() {
        int max = Math.max(1000, intValue("hezzuz-api.max-queue-files", 100000));
        try (var s = Files.list(queueDir)) {
            List<Path> all = s.filter(Files::isRegularFile).sorted(Comparator.comparing(Path::getFileName)).toList();
            int excess = all.size() - max;
            for (int i=0;i<excess;i++) Files.deleteIfExists(all.get(i));
            if (excess > 0) warn("Fila API excedeu limite; " + excess + " evento(s) mais antigos removidos.");
        } catch (Throwable ignored) {}
    }

    private void flushSafe() { try { flush(); } catch (Throwable t) { debug("API flush: " + t.getMessage()); } }

    private void flush() throws Exception {
        if (!isEnabled() || System.currentTimeMillis() < backoffUntil) return;
        List<Path> files;
        try (var s = Files.list(queueDir)) {
            files = s.filter(Files::isRegularFile).filter(p -> p.getFileName().toString().endsWith(".json"))
                    .sorted(Comparator.comparing(Path::getFileName)).limit(batchSize).toList();
        }
        if (files.isEmpty()) return;
        List<String> events = new ArrayList<>(files.size());
        for (Path p : files) {
            try { events.add(Files.readString(p, StandardCharsets.UTF_8)); }
            catch (Throwable t) { warn("Evento de fila ilegivel, mantendo arquivo " + p.getFileName()); }
        }
        if (events.isEmpty()) return;
        String body = "{\"events\":[" + String.join(",", events) + "]}";
        HttpResponse<String> resp = signedPost(endpoint, body);
        int code = resp.statusCode();
        if (code >= 200 && code < 300) {
            for (Path p : files) try { Files.deleteIfExists(p); } catch (Throwable ignored) {}
            backoffUntil = 0L;
            return;
        }
        if (code == 429 || code >= 500) {
            long retry = retryAfter(resp, code == 429 ? 1500L : 3000L);
            backoffUntil = System.currentTimeMillis() + retry;
            return;
        }
        backoffUntil = System.currentTimeMillis() + 10_000L;
        warn("HEZZUZ Logs API retornou HTTP " + code + ". Eventos mantidos na fila.");
    }

    private void heartbeatSafe() {
        try {
            if (!isEnabled() || heartbeatUrl.isBlank()) return;
            Object server = call(plugin, "getServer");
            Object online = call(server, "getOnlinePlayers");
            int players = online instanceof java.util.Collection<?> c ? c.size() : 0;
            String version = text(call(server, "getVersion"));
            String display = text(call(plugin, "getServerName"));
            String body = "{\"players_online\":" + players + ",\"display_name\":\"" + json(display) + "\",\"version\":\"" + json(version) + "\",\"metadata\":{}}";
            HttpResponse<String> r = signedPost(heartbeatUrl, body);
            if (r.statusCode() == 429 || r.statusCode() >= 500) backoffUntil = System.currentTimeMillis() + retryAfter(r, 3000L);
        } catch (Throwable t) { debug("Heartbeat API: " + t.getMessage()); }
    }

    private HttpResponse<String> signedPost(String url, String body) throws Exception {
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        String nonce = randomHex(16);
        String material = timestamp + "\n" + nonce + "\n" + body;
        String sig = hmacHex(apiKey, material);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .header("Content-Type", "application/json")
                .header("X-Hezz-Server", serverId)
                .header("X-Hezz-Timestamp", timestamp)
                .header("X-Hezz-Nonce", nonce)
                .header("X-Hezz-Signature", sig)
                .header("User-Agent", "HezzChatDiscord/3.0")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        return http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private long retryAfter(HttpResponse<String> resp, long fallback) {
        try {
            String h = resp.headers().firstValue("Retry-After").orElse("");
            if (!h.isBlank()) { double d = Double.parseDouble(h); return (long)(d > 100 ? d : d * 1000D); }
        } catch (Throwable ignored) {}
        return fallback;
    }

    private String hmacHex(String secret, String input) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] out = mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder b = new StringBuilder(out.length*2);
        for (byte x : out) b.append(String.format("%02x", x));
        return b.toString();
    }

    private String randomHex(int bytes) {
        byte[] b = new byte[bytes]; random.nextBytes(b); StringBuilder s=new StringBuilder(bytes*2);
        for(byte x:b)s.append(String.format("%02x",x)); return s.toString();
    }

    @Override public void close() {
        closed = true;
        try { flushSafe(); } catch (Throwable ignored) {}
        worker.shutdown();
        try { worker.awaitTermination(3, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        synchronized (HezzLogsApiClient.class) { if (INSTANCE == this) INSTANCE = null; }
    }

    private String safeCategory(String s) { return String.valueOf(s == null ? "other" : s).replaceAll("[^a-zA-Z0-9_-]", "_").toLowerCase(Locale.ROOT); }
    private String normalizeSeverity(String s) { String v=String.valueOf(s==null?"INFO":s).toUpperCase(Locale.ROOT); return switch(v){case "WARN","WARNING"->"WARNING";case "ERROR"->"ERROR";case "SEVERE","CRITICAL"->"CRITICAL";default->"INFO";}; }
    private String nullable(String s) { return s == null || s.isBlank() ? "null" : "\"" + json(s) + "\""; }
    private String limit(String s, int n) { if (s == null) return ""; return s.length() <= n ? s : s.substring(0,n-1)+"…"; }
    private String redact(String s) {
        if (s == null) return "";
        String out = s.replaceAll("(?i)https?://(?:canary\\.|ptb\\.)?discord(?:app)?\\.com/api/webhooks/\\S+", "[WEBHOOK OCULTO]");
        out = out.replaceAll("(?i)(password|passwd|senha|token|secret|api[-_]?key|authorization)\\s*[:=]\\s*([^\\s,;]+)", "$1=[OCULTO]");
        return out;
    }
    private String json(String s) { if(s==null)return "";StringBuilder b=new StringBuilder();for(char c:s.toCharArray()){switch(c){case '\\'->b.append("\\\\");case '"'->b.append("\\\"");case '\n'->b.append("\\n");case '\r'->b.append("\\r");case '\t'->b.append("\\t");default->{if(c<32)b.append(' ');else b.append(c);}}}return b.toString(); }
    private String string(String path, String def) { Object cfg=call(plugin,"getConfig"); Object v=call(cfg,"getString",new Class[]{String.class,String.class},new Object[]{path,def}); return v==null?def:String.valueOf(v); }
    private boolean bool(String path, boolean def) { Object cfg=call(plugin,"getConfig"); Object v=call(cfg,"getBoolean",new Class[]{String.class,boolean.class},new Object[]{path,def}); return v instanceof Boolean b?b:def; }
    private int intValue(String path, int def) { Object cfg=call(plugin,"getConfig"); Object v=call(cfg,"getInt",new Class[]{String.class,int.class},new Object[]{path,def}); return v instanceof Number n?n.intValue():def; }
    private long longValue(String path, long def) { Object cfg=call(plugin,"getConfig"); Object v=call(cfg,"getLong",new Class[]{String.class,long.class},new Object[]{path,def}); return v instanceof Number n?n.longValue():def; }
    private Object call(Object o,String name){return call(o,name,new Class[0],new Object[0]);}
    private Object call(Object o,String name,Class<?>[] types,Object[] args){if(o==null)return null;try{Method m=o.getClass().getMethod(name,types);m.setAccessible(true);return m.invoke(o,args);}catch(Throwable ignored){return null;}}
    private String text(Object o){return o==null?"":String.valueOf(o);}
    private Logger logger(){Object l=call(plugin,"getLogger");return l instanceof Logger x?x:Logger.getLogger("HezzChatDiscord");}
    private void info(String s){logger().info("[API] "+s);} private void warn(String s){logger().warning("[API] "+s);} private void debug(String s){if(bool("debug",false))logger().info("[API-DEBUG] "+s);}
}
