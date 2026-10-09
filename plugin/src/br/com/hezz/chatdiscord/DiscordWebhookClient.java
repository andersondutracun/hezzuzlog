package br.com.hezz.chatdiscord;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** HEZZUZ 3.0: all events go to HEZZUZ Logs API; direct Discord is optional. */
public final class DiscordWebhookClient implements AutoCloseable {
    private final HezzChatDiscord plugin;
    private final ExecutorService executor;
    private final HttpClient httpClient;
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final Map<String,String> urls = new ConcurrentHashMap<>();
    private volatile int timeoutSeconds;
    private volatile boolean directEnabled;
    private volatile long lastSend;
    private final HezzLogsApiClient api;

    public DiscordWebhookClient(HezzChatDiscord plugin) {
        this.plugin = plugin;
        this.executor = Executors.newSingleThreadExecutor(r -> { Thread t=new Thread(r,"HezzLogger-Discord");t.setDaemon(true);return t; });
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        this.api = HezzLogsApiClient.init(plugin);
        reload();
    }

    public void reload() {
        urls.clear();
        put("public","discord.public-webhook-url"); put("private","discord.private-webhook-url"); put("clan","discord.clan-webhook-url");
        put("ally","discord.ally-webhook-url"); put("staff","discord.staff-webhook-url"); put("moderation","discord.moderation-webhook-url");
        put("permissions","discord.permissions-webhook-url"); put("economy","discord.economy-webhook-url"); put("trades","discord.trades-webhook-url");
        put("crates","discord.crates-webhook-url"); put("protection","discord.protection-webhook-url"); put("gameplay","discord.gameplay-webhook-url"); put("server","discord.server-webhook-url");
        timeoutSeconds=Math.max(2,plugin.getConfig().getInt("discord.timeout-seconds",8));
        directEnabled=plugin.getConfig().getBoolean("discord.direct-enabled",false);
        api.reload();
    }
    private void put(String k,String path){urls.put(k,cleanUrl(plugin.getConfig().getString(path,"")));}
    public boolean sendPublic(String u,String a,String c){return send("public",u,a,c);} public boolean sendPrivate(String u,String a,String c){return send("private",u,a,c);}
    public boolean sendClan(String u,String a,String c){return send("clan",u,a,c);} public boolean sendAlly(String u,String a,String c){return send("ally",u,a,c);}
    public boolean sendStaff(String u,String a,String c){return send("staff",u,a,c);}
    public boolean send(String target,String username,String avatar,String content){
        api.emitLegacy(target,username,avatar,content);
        if(!directEnabled) return api.isEnabled();
        String url=resolve(target); boolean discord=enqueue(url,username,avatar,content); return discord||api.isEnabled();
    }
    public boolean hasPublicWebhook(){return api.isEnabled()||(directEnabled&&!resolve("public").isBlank());}
    public boolean hasClanWebhook(){return api.isEnabled()||(directEnabled&&!resolve("clan").isBlank());}
    public boolean hasAllyWebhook(){return api.isEnabled()||(directEnabled&&!resolve("ally").isBlank());}
    public boolean hasStaffWebhook(){return api.isEnabled()||(directEnabled&&!resolve("staff").isBlank());}
    public boolean has(String k){return api.isEnabled()||(directEnabled&&!resolve(k).isBlank());}
    private String resolve(String k){String d=urls.getOrDefault(k,"");if(!d.isBlank())return d;if("ally".equals(k)){String c=urls.getOrDefault("clan","");if(!c.isBlank())return c;}if("private".equals(k)||"clan".equals(k)||"staff".equals(k)){String p=urls.getOrDefault("public","");if(!p.isBlank())return p;}String audit=cleanUrl(plugin.getConfig().getString("discord.audit-webhook-url",""));if(!audit.isBlank())return audit;return urls.getOrDefault("public","");}
    private boolean enqueue(String url,String username,String avatar,String content){if(closed.get()||url==null||url.isBlank())return false;executor.execute(()->post(url,username,avatar,content));return true;}
    private void post(String url,String username,String avatar,String content){try{long throttle=Math.max(0,plugin.getConfig().getLong("discord.throttle-ms",450));long w=throttle-(System.currentTimeMillis()-lastSend);if(w>0)Thread.sleep(w);String body="{\"username\":\""+json(username==null?"HezzLogger":username)+"\""+(avatar==null||avatar.isBlank()?"":",\"avatar_url\":\""+json(avatar)+"\"")+",\"content\":\""+json(limit(content,1950))+"\"}";for(int i=0;i<3;i++){HttpRequest req=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(timeoutSeconds)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body,StandardCharsets.UTF_8)).build();HttpResponse<String> r=httpClient.send(req,HttpResponse.BodyHandlers.ofString());if(r.statusCode()>=200&&r.statusCode()<300){lastSend=System.currentTimeMillis();return;}if(r.statusCode()==429){Thread.sleep(1500L);continue;}plugin.getLogger().warning("Discord retornou HTTP "+r.statusCode());return;}}catch(Throwable t){plugin.getLogger().warning("Falha no webhook Discord: "+t.getMessage());}}
    private String cleanUrl(String s){if(s==null)return "";s=s.trim();return s.isEmpty()||s.toUpperCase(Locale.ROOT).contains("COLE_AQUI")?"":s;}
    private String limit(String s,int n){if(s==null)return "";return s.length()<=n?s:s.substring(0,n-1)+"…";}
    private String json(String s){if(s==null)return "";StringBuilder b=new StringBuilder();for(char c:s.toCharArray()){switch(c){case '\\'->b.append("\\\\");case '"'->b.append("\\\"");case '\n'->b.append("\\n");case '\r'->b.append("\\r");case '\t'->b.append("\\t");default->{if(c<32)b.append(' ');else b.append(c);}}}return b.toString();}
    @Override public void close(){if(!closed.compareAndSet(false,true))return;try{api.close();}catch(Throwable ignored){}executor.shutdown();try{executor.awaitTermination(2,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
}
