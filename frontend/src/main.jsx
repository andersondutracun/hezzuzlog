import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, logout } from './api.js';
import './styles.css';

const fmt = v => v ? new Date(v).toLocaleString('pt-BR') : '-';
const severityClass = s => ['ERROR','CRITICAL','SEVERE'].includes(s) ? 'bad' : s === 'WARNING' ? 'warn' : 'ok';
const icon = c => ({activity:'●',death:'☠',moderation:'⚒',commands:'⌘',errors:'!',console:'▣',trades:'⇄',economy:'

function Login(){
  const nav=useNavigate(); const [username,setU]=useState('admin'); const [password,setP]=useState(''); const [error,setE]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setE('');setBusy(true);try{await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username,password})});nav('/');}catch(x){setE(x.message)}finally{setBusy(false)}}
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand large"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><h1>Central de auditoria</h1><p>Entre para acompanhar toda a rede em tempo real.</p><label>Usuário<input autoComplete="username" value={username} onChange={e=>setU(e.target.value)}/></label><label>Senha<input autoComplete="current-password" type="password" value={password} onChange={e=>setP(e.target.value)}/></label>{error&&<div className="errorbox">{error}</div>}<button disabled={busy}>{busy?'Entrando...':'Entrar'}</button></form></div>
}

function useLiveSocket(){
  const [live,setLive]=useState([]); const [connected,setConnected]=useState(false); const stopped=useRef(false);
  useEffect(()=>{
    stopped.current=false;
    let ws; let timer; let attempt=0;
    const connect=()=>{
      if(stopped.current)return;
      const proto=location.protocol==='https:'?'wss':'ws';
      ws=new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen=()=>{attempt=0;setConnected(true)};
      ws.onclose=()=>{setConnected(false);if(!stopped.current){const ms=Math.min(15000,1000*Math.pow(2,attempt++));timer=setTimeout(connect,ms)}};
      ws.onerror=()=>{try{ws.close()}catch{}};
      ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='events')setLive(x=>[...m.events,...x].slice(0,120));}catch{}};
    };
    connect();
    return()=>{stopped.current=true;clearTimeout(timer);try{ws?.close()}catch{}};
  },[]);
  return {live,connected};
}

function Shell(){
  const {live,connected}=useLiveSocket();
  return <div className="app"><aside><div className="brand"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><nav>{[['/','Dashboard'],['/eventos','Eventos'],['/jogadores','Jogadores'],['/moderacao','Moderação'],['/erros','Erros'],['/servidores','Servidores']].map(([to,n])=><NavLink key={to} to={to} end={to==='/' }>{n}</NavLink>)}</nav><div className="side-bottom"><div className={`dot ${connected?'online':'offline'}`}></div>{connected?'Tempo real ativo':'Reconectando...'}<button className="ghost" onClick={logout}>Sair</button></div></aside><main><Routes><Route index element={<Dashboard live={live}/>}/><Route path="eventos" element={<Events live={live}/>}/><Route path="jogadores" element={<Players/>}/><Route path="jogadores/:uuid" element={<Player/>}/><Route path="moderacao" element={<SimpleFeed endpoint="/api/v1/moderation" title="Moderação"/>}/><Route path="erros" element={<SimpleFeed endpoint="/api/v1/errors" title="Erros e alertas"/>}/><Route path="servidores" element={<Servers/>}/></Routes></main></div>
}

function Card({label,value,sub,onClick,active}){
  const cls=`card metric${onClick?' clickable':''}${active?' selected':''}`;
  return <div className={cls} onClick={onClick} role={onClick?'button':undefined} tabIndex={onClick?0:undefined}>
    <span>{label}</span><strong>{value??'—'}</strong>{sub&&<small>{sub}</small>}
  </div>
}
function EventRow({e}){
  const [open,setOpen]=useState(false);
  const hasData=e?.data && typeof e.data==='object' && Object.keys(e.data).length>0;
  const copy=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(e,null,2))}catch{}};
  return <div className={`event-row forensic ${open?'expanded':''}`}>
    <div className={`event-icon ${severityClass(e.severity)}`}>{icon(e.category)}</div>
    <div className="event-body">
      <div className="event-headline">
        <b className="event-title">{eventLabel(e)}</b>
        <span className="event-actor">{e.player_name||'Sistema'}</span>
        <span className="pill">{e.server_id}</span>
        <span className="pill subtle">{catLabel(e.category)}</span>
        {e.severity&&e.severity!=='INFO'&&<span className={`pill severity ${severityClass(e.severity)}`}>{e.severity}</span>}
      </div>
      <p className="event-message">{cleanMessage(e.message)}</p>
      <div className="event-tools">
        <button type="button" className="mini-btn" onClick={()=>setOpen(x=>!x)}>{open?'Ocultar detalhes':'Detalhes'}</button>
        <button type="button" className="mini-btn" onClick={copy}>Copiar</button>
      </div>
      {open&&<div className="event-details">
        <div className="detail-grid">
          <div><span>Tipo</span><code>{e.type}</code></div>
          <div><span>Categoria</span><code>{e.category}</code></div>
          <div><span>Servidor</span><code>{e.server_id}</code></div>
          <div><span>Evento ID</span><code>{e.id}</code></div>
          {e.player_uuid&&<div className="wide"><span>UUID</span><code>{e.player_uuid}</code></div>}
          <div className="wide"><span>Horário exato</span><code>{fmt(e.occurred_at)}</code></div>
        </div>
        {hasData&&<><span className="details-label">Dados estruturados</span><pre>{JSON.stringify(e.data,null,2)}</pre></>}
      </div>}
    </div>
    <time title={fmt(e.occurred_at)}>{new Date(e.occurred_at).toLocaleTimeString('pt-BR')}</time>
  </div>
}

function Dashboard({live}){
  const [d,setD]=useState(null);
  useEffect(()=>{let alive=true;const load=()=>api('/api/v1/dashboard/summary').then(x=>alive&&setD(x)).catch(()=>{});load();const t=setInterval(load,15000);return()=>{alive=false;clearInterval(t)}},[]);
  const s=d?.summary||{};
  return <><header><div><h1>Visão geral</h1><p>Auditoria central da rede HEZZUZ.</p></div><span className="status-chip">● AO VIVO</span></header><section className="metrics"><Card label="Jogadores online" value={d?.servers?.reduce((a,x)=>a+Number(x.players_online||0),0)}/><Card label="Eventos 24h" value={s.total}/><Card label="Entradas" value={s.joins}/><Card label="Mortes" value={s.deaths}/><Card label="Punições" value={s.moderation}/><Card label="Erros" value={s.errors}/></section><section className="grid2"><div className="card"><h2>Atividade em tempo real</h2><div className="feed">{live.length?live.slice(0,18).map(e=><EventRow key={e.id} e={e}/>):<Empty text="Aguardando novos eventos..."/>}</div></div><div className="card"><h2>Servidores</h2><div className="server-list">{d?.servers?.map(x=><div className="server" key={x.server_id}><div><b>{x.display_name||x.server_id}</b><small>{x.version||'Paper'}</small></div><div><strong>{x.players_online||0}</strong><span className={`pill ${x.status==='online'?'green':'red'}`}>{x.status}</span></div></div>)}</div><h2 className="mt">Categorias 24h</h2>{d?.categories?.map(c=><div className="barrow" key={c.category}><span>{c.category}</span><div><i style={{width:`${Math.max(4,Math.min(100,c.count/Math.max(1,s.total)*100))}%`}}></i></div><b>{c.count}</b></div>)}</div></section></>
}

function Events({live}){
  const [items,setItems]=useState([]),[server,setServer]=useState(''),[category,setCat]=useState(''),[player,setPlayer]=useState(''),[q,setQ]=useState('');
  async function load(){const sp=new URLSearchParams({limit:'100'});if(server)sp.set('server',server);if(category)sp.set('category',category);if(player)sp.set('player',player);if(q)sp.set('q',q);const r=await api('/api/v1/events?'+sp);setItems(r.events)}
  useEffect(()=>{load().catch(()=>{})},[]);
  const merged=useMemo(()=>{const map=new Map();[...live,...items].forEach(e=>map.set(e.id,e));return [...map.values()].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,200)},[live,items]);
  return <><header><div><h1>Explorador de eventos</h1><p>Pesquise qualquer ação registrada na rede.</p></div></header><div className="card filters"><input placeholder="Servidor" value={server} onChange={e=>setServer(e.target.value)}/><input placeholder="Categoria" value={category} onChange={e=>setCat(e.target.value)}/><input placeholder="Jogador / UUID" value={player} onChange={e=>setPlayer(e.target.value)}/><input placeholder="Texto" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={()=>load().catch(()=>{})}>Filtrar</button></div><div className="card feed">{merged.length?merged.map(e=><EventRow key={e.id} e={e}/>):<Empty text="Nenhum evento encontrado."/>}</div></>
}

function Players(){
  const nav=useNavigate(); const [q,setQ]=useState(''),[players,setPlayers]=useState([]);
  async function load(v=''){const r=await api('/api/v1/players?q='+encodeURIComponent(v));setPlayers(r.players)}
  useEffect(()=>{load().catch(()=>{})},[]);
  return <><header><div><h1>Jogadores</h1><p>Histórico individual consolidado.</p></div></header><div className="card filters"><input placeholder="Nome ou UUID" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={()=>load(q).catch(()=>{})}>Pesquisar</button></div><div className="card table-wrap"><table><thead><tr><th>Jogador</th><th>Eventos</th><th>Mortes</th><th>Moderação</th><th>Última atividade</th></tr></thead><tbody>{players.map(p=><tr key={p.player_uuid} onClick={()=>nav('/jogadores/'+encodeURIComponent(p.player_uuid))}><td><b>{p.player_name||'Desconhecido'}</b><small>{p.player_uuid}</small></td><td>{p.events}</td><td>{p.deaths}</td><td>{p.moderation}</td><td>{fmt(p.last_seen)}</td></tr>)}</tbody></table></div></>
}

function Player(){
  const {uuid}=useParams();
  const [d,setD]=useState(null);
  const [servers,setServers]=useState([]);
  const [events,setEvents]=useState([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(false);
  const [filters,setFilters]=useState({q:'',server:'',category:'',severity:'',hours:'720'});

  useEffect(()=>{
    Promise.all([
      api('/api/v1/players/'+encodeURIComponent(uuid)),
      api('/api/v1/servers')
    ]).then(([profile,sv])=>{setD(profile);setServers(sv.servers||[])}).catch(()=>{});
    search(filters,1).catch(()=>{});
  },[uuid]);

  async function search(next=filters,nextPage=1){
    setLoading(true);
    try{
      const sp=new URLSearchParams({limit:'100',page:String(nextPage)});
      if(next.q)sp.set('q',next.q);
      if(next.server)sp.set('server',next.server);
      if(next.category)sp.set('category',next.category);
      if(next.severity)sp.set('severity',next.severity);
      if(next.hours&&next.hours!=='all')sp.set('hours',next.hours);
      const r=await api('/api/v1/players/'+encodeURIComponent(uuid)+'/events?'+sp);
      setEvents(r.events||[]);setTotal(r.total||0);setPage(r.page||nextPage);
    }finally{setLoading(false)}
  }

  function setFilter(key,value){setFilters(f=>({...f,[key]:value}))}
  function applyCategory(category){
    const next={...filters,category};
    setFilters(next);search(next,1).catch(()=>{});
  }
  function clearFilters(){
    const next={q:'',server:'',category:'',severity:'',hours:'720'};
    setFilters(next);search(next,1).catch(()=>{});
  }
  const grouped=useMemo(()=>{
    const out=[];
    for(const e of events){
      const label=dayLabel(e.occurred_at);
      let g=out[out.length-1];
      if(!g||g.label!==label){g={label,items:[]};out.push(g)}
      g.items.push(e);
    }
    return out;
  },[events]);

  if(!d)return <Empty text="Carregando jogador..."/>;
  const p=d.player;
  const pages=Math.max(1,Math.ceil(total/100));
  const copyUuid=async()=>{try{await navigator.clipboard.writeText(p.player_uuid)}catch{}};

  return <>
    <header className="player-header">
      <div>
        <div className="eyebrow">Investigação de jogador</div>
        <h1>{p.player_name||'Jogador'}</h1>
        <div className="player-ident">
          <code>{p.player_uuid}</code>
          <button className="mini-btn" onClick={copyUuid}>Copiar UUID</button>
        </div>
        <div className="player-dates">
          <span>Primeiro registro: <b>{fmt(p.first_seen)}</b></span>
          <span>Última atividade: <b>{fmt(p.last_seen)}</b></span>
        </div>
      </div>
      <span className="status-chip">● HISTÓRICO CENTRALIZADO</span>
    </header>

    <section className="metrics">
      <Card label="Eventos" value={p.events} onClick={()=>applyCategory('')} active={!filters.category}/>
      <Card label="Entradas" value={p.joins} onClick={()=>applyCategory('activity')} active={filters.category==='activity'}/>
      <Card label="Mortes" value={p.deaths} onClick={()=>applyCategory('death')} active={filters.category==='death'}/>
      <Card label="Punições" value={p.moderation} onClick={()=>applyCategory('moderation')} active={filters.category==='moderation'}/>
      <Card label="Comandos" value={p.commands} onClick={()=>applyCategory('commands')} active={filters.category==='commands'}/>
      <Card label="Trocas" value={p.trades} onClick={()=>applyCategory('trades')} active={filters.category==='trades'}/>
    </section>

    <section className="card investigation-panel">
      <div className="investigation-title">
        <div><h2>Pesquisa no histórico</h2><p>Combine filtros para localizar rapidamente uma ação específica.</p></div>
        <button className="ghost-inline" onClick={clearFilters}>Limpar filtros</button>
      </div>

      <div className="investigation-grid">
        <label className="search-wide"><span>Pesquisar texto</span><input placeholder="Ex.: /ban, gamemode, world, zombie..." value={filters.q} onChange={e=>setFilter('q',e.target.value)} onKeyDown={e=>e.key==='Enter'&&search(filters,1).catch(()=>{})}/></label>
        <label><span>Servidor</span><select value={filters.server} onChange={e=>setFilter('server',e.target.value)}><option value="">Todos</option>{servers.map(s=><option key={s.server_id} value={s.server_id}>{s.display_name||s.server_id}</option>)}</select></label>
        <label><span>Categoria</span><select value={filters.category} onChange={e=>setFilter('category',e.target.value)}><option value="">Todas</option>{Object.entries(CATEGORY_LABELS).map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label>
        <label><span>Severidade</span><select value={filters.severity} onChange={e=>setFilter('severity',e.target.value)}><option value="">Todas</option><option>INFO</option><option>WARNING</option><option>ERROR</option><option>SEVERE</option><option>CRITICAL</option></select></label>
        <label><span>Período</span><select value={filters.hours} onChange={e=>setFilter('hours',e.target.value)}><option value="1">Última hora</option><option value="24">24 horas</option><option value="168">7 dias</option><option value="720">30 dias</option><option value="2160">90 dias</option><option value="all">Todo o histórico</option></select></label>
        <button className="search-btn" onClick={()=>search(filters,1).catch(()=>{})}>{loading?'Pesquisando...':'Pesquisar'}</button>
      </div>

      <div className="quick-filters">
        <span>Atalhos:</span>
        {[['','Tudo'],['activity','Entradas/Saídas'],['commands','Comandos'],['staff','Staff'],['world','Mundo'],['death','Mortes'],['moderation','Moderação'],['trades','Trocas']].map(([v,n])=><button key={n} className={filters.category===v?'active':''} onClick={()=>applyCategory(v)}>{n}</button>)}
      </div>
    </section>

    <section className="timeline-toolbar">
      <div><b>{total.toLocaleString('pt-BR')}</b> eventos encontrados <span>• página {page} de {pages}</span></div>
      <div className="pagination">
        <button disabled={page<=1||loading} onClick={()=>search(filters,page-1).catch(()=>{})}>← Anterior</button>
        <button disabled={page>=pages||loading} onClick={()=>search(filters,page+1).catch(()=>{})}>Próxima →</button>
      </div>
    </section>

    <div className="timeline-investigation">
      {grouped.length?grouped.map(g=><section className="day-group" key={g.label}>
        <div className="day-heading"><span>{g.label}</span><small>{g.items.length} evento{g.items.length===1?'':'s'}</small></div>
        <div className="card feed forensic-feed">{g.items.map(e=><EventRow key={e.id} e={e}/>)}</div>
      </section>):<div className="card"><Empty text={loading?'Pesquisando...':'Nenhum evento encontrado com esses filtros.'}/></div>}
    </div>
  </>;
}

function SimpleFeed({endpoint,title}){const [items,setItems]=useState([]);useEffect(()=>{api(endpoint).then(r=>setItems(r.events||[])).catch(()=>{})},[endpoint]);return <><header><div><h1>{title}</h1><p>Registros centralizados do HEZZUZ Logs.</p></div></header><div className="card feed">{items.length?items.map(e=><EventRow key={e.id} e={e}/>):<Empty text="Nenhum registro encontrado."/>}</div></>}
function Servers(){const [items,setItems]=useState([]);useEffect(()=>{const load=()=>api('/api/v1/servers').then(r=>setItems(r.servers)).catch(()=>{});load();const t=setInterval(load,15000);return()=>clearInterval(t)},[]);return <><header><div><h1>Servidores</h1><p>Status da rede enviado pelos plugins.</p></div></header><div className="cards-list">{items.map(s=><div className="card server-card" key={s.server_id}><div><h2>{s.display_name||s.server_id}</h2><p>{s.version||'Versão não informada'}</p></div><span className={`pill ${s.status==='online'?'green':'red'}`}>{s.status}</span><div className="server-meta"><b>{s.players_online||0}</b><span>jogadores</span><small>Heartbeat: {fmt(s.last_heartbeat_at)}</small></div></div>)}</div></>}
function Empty({text}){return <div className="empty">{text}</div>}

function SessionGuard(){
  const [state,setState]=useState('loading');
  useEffect(()=>{api('/api/v1/auth/me').then(()=>setState('ok')).catch(()=>setState('no'))},[]);
  if(state==='loading') return <div className="login-shell"><div className="login-card"><div className="brand large"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><p>Validando sessão...</p></div></div>;
  return state==='ok'?<Shell/>:<Navigate to="/login" replace/>;
}

function App(){return <BrowserRouter><Routes><Route path="/login" element={<Login/>}/><Route path="/*" element={<SessionGuard/>}/></Routes></BrowserRouter>}
createRoot(document.getElementById('root')).render(<App/>);
,permissions:'◆',protection:'⬡',gameplay:'✦',world:'◎',server:'◉',public:'◌',private:'◍',clan:'♜',ally:'♞',staff:'♛',crates:'⬢'}[c] || '•');

const CATEGORY_LABELS = {
  activity:'Atividade', death:'Mortes', moderation:'Moderação', commands:'Comandos',
  errors:'Erros', console:'Console', trades:'Trocas', economy:'Economia',
  permissions:'Permissões', protection:'Proteção', gameplay:'Gameplay', world:'Mundo',
  server:'Servidor', public:'Chat público', private:'Privado', clan:'Clã', ally:'Aliados',
  staff:'Staff', crates:'Crates', integration:'Integrações', auth:'Autenticação',
  skyblock:'SkyBlock'
};
const TYPE_LABELS = {
  JOIN:'Entrada', FIRST_JOIN:'Primeira entrada', QUIT:'Saída', KICK:'Kick',
  DEATH:'Morte', WORLD_CHANGE:'Troca de mundo', GAMEMODE:'Gamemode',
  COMMAND:'Comando', CONSOLE_COMMAND:'Comando do console', RESPAWN:'Respawn',
  ADVANCEMENT:'Conquista', LOGIN_DENIED:'Login recusado', SERVER_START:'Servidor iniciou',
  SERVER_STOP:'Servidor desligou', PLUGIN_INVENTORY:'Inventário de plugins',
  MARRIED:'Casamento', DIVORCED:'Divórcio', ISLAND_CREATED:'Ilha criada',
  ISLAND_DELETED:'Ilha removida', ISLAND_RESET:'Ilha resetada',
  ISLAND_LEVEL_CALCULATED:'Nível da ilha', CHALLENGE_COMPLETED:'Desafio concluído',
  LEVEL_COMPLETED:'Nível de desafios concluído'
};
const cleanMessage = value => String(value || '')
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .replace(/\\n/g, '\n')
  .trim();
const eventLabel = e => TYPE_LABELS[e?.type] || String(e?.type || 'EVENTO').replaceAll('_',' ');
const catLabel = c => CATEGORY_LABELS[c] || String(c || 'outros');
const dayLabel = value => {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate()-1);
  const same = x => x.toDateString() === d.toDateString();
  if (same(today)) return 'Hoje';
  if (same(yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
};

function Login(){
  const nav=useNavigate(); const [username,setU]=useState('admin'); const [password,setP]=useState(''); const [error,setE]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e){e.preventDefault();setE('');setBusy(true);try{await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username,password})});nav('/');}catch(x){setE(x.message)}finally{setBusy(false)}}
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand large"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><h1>Central de auditoria</h1><p>Entre para acompanhar toda a rede em tempo real.</p><label>Usuário<input autoComplete="username" value={username} onChange={e=>setU(e.target.value)}/></label><label>Senha<input autoComplete="current-password" type="password" value={password} onChange={e=>setP(e.target.value)}/></label>{error&&<div className="errorbox">{error}</div>}<button disabled={busy}>{busy?'Entrando...':'Entrar'}</button></form></div>
}

function useLiveSocket(){
  const [live,setLive]=useState([]); const [connected,setConnected]=useState(false); const stopped=useRef(false);
  useEffect(()=>{
    stopped.current=false;
    let ws; let timer; let attempt=0;
    const connect=()=>{
      if(stopped.current)return;
      const proto=location.protocol==='https:'?'wss':'ws';
      ws=new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen=()=>{attempt=0;setConnected(true)};
      ws.onclose=()=>{setConnected(false);if(!stopped.current){const ms=Math.min(15000,1000*Math.pow(2,attempt++));timer=setTimeout(connect,ms)}};
      ws.onerror=()=>{try{ws.close()}catch{}};
      ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='events')setLive(x=>[...m.events,...x].slice(0,120));}catch{}};
    };
    connect();
    return()=>{stopped.current=true;clearTimeout(timer);try{ws?.close()}catch{}};
  },[]);
  return {live,connected};
}

function Shell(){
  const {live,connected}=useLiveSocket();
  return <div className="app"><aside><div className="brand"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><nav>{[['/','Dashboard'],['/eventos','Eventos'],['/jogadores','Jogadores'],['/moderacao','Moderação'],['/erros','Erros'],['/servidores','Servidores']].map(([to,n])=><NavLink key={to} to={to} end={to==='/' }>{n}</NavLink>)}</nav><div className="side-bottom"><div className={`dot ${connected?'online':'offline'}`}></div>{connected?'Tempo real ativo':'Reconectando...'}<button className="ghost" onClick={logout}>Sair</button></div></aside><main><Routes><Route index element={<Dashboard live={live}/>}/><Route path="eventos" element={<Events live={live}/>}/><Route path="jogadores" element={<Players/>}/><Route path="jogadores/:uuid" element={<Player/>}/><Route path="moderacao" element={<SimpleFeed endpoint="/api/v1/moderation" title="Moderação"/>}/><Route path="erros" element={<SimpleFeed endpoint="/api/v1/errors" title="Erros e alertas"/>}/><Route path="servidores" element={<Servers/>}/></Routes></main></div>
}

function Card({label,value,sub}){return <div className="card metric"><span>{label}</span><strong>{value??'—'}</strong>{sub&&<small>{sub}</small>}</div>}
function EventRow({e}){return <div className="event-row"><div className={`event-icon ${severityClass(e.severity)}`}>{icon(e.category)}</div><div className="event-body"><div><b>{e.player_name||e.type}</b><span className="pill">{e.server_id}</span><span className="pill subtle">{e.category}</span></div><p>{e.message}</p></div><time>{fmt(e.occurred_at)}</time></div>}

function Dashboard({live}){
  const [d,setD]=useState(null);
  useEffect(()=>{let alive=true;const load=()=>api('/api/v1/dashboard/summary').then(x=>alive&&setD(x)).catch(()=>{});load();const t=setInterval(load,15000);return()=>{alive=false;clearInterval(t)}},[]);
  const s=d?.summary||{};
  return <><header><div><h1>Visão geral</h1><p>Auditoria central da rede HEZZUZ.</p></div><span className="status-chip">● AO VIVO</span></header><section className="metrics"><Card label="Jogadores online" value={d?.servers?.reduce((a,x)=>a+Number(x.players_online||0),0)}/><Card label="Eventos 24h" value={s.total}/><Card label="Entradas" value={s.joins}/><Card label="Mortes" value={s.deaths}/><Card label="Punições" value={s.moderation}/><Card label="Erros" value={s.errors}/></section><section className="grid2"><div className="card"><h2>Atividade em tempo real</h2><div className="feed">{live.length?live.slice(0,18).map(e=><EventRow key={e.id} e={e}/>):<Empty text="Aguardando novos eventos..."/>}</div></div><div className="card"><h2>Servidores</h2><div className="server-list">{d?.servers?.map(x=><div className="server" key={x.server_id}><div><b>{x.display_name||x.server_id}</b><small>{x.version||'Paper'}</small></div><div><strong>{x.players_online||0}</strong><span className={`pill ${x.status==='online'?'green':'red'}`}>{x.status}</span></div></div>)}</div><h2 className="mt">Categorias 24h</h2>{d?.categories?.map(c=><div className="barrow" key={c.category}><span>{c.category}</span><div><i style={{width:`${Math.max(4,Math.min(100,c.count/Math.max(1,s.total)*100))}%`}}></i></div><b>{c.count}</b></div>)}</div></section></>
}

function Events({live}){
  const [items,setItems]=useState([]),[server,setServer]=useState(''),[category,setCat]=useState(''),[player,setPlayer]=useState(''),[q,setQ]=useState('');
  async function load(){const sp=new URLSearchParams({limit:'100'});if(server)sp.set('server',server);if(category)sp.set('category',category);if(player)sp.set('player',player);if(q)sp.set('q',q);const r=await api('/api/v1/events?'+sp);setItems(r.events)}
  useEffect(()=>{load().catch(()=>{})},[]);
  const merged=useMemo(()=>{const map=new Map();[...live,...items].forEach(e=>map.set(e.id,e));return [...map.values()].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,200)},[live,items]);
  return <><header><div><h1>Explorador de eventos</h1><p>Pesquise qualquer ação registrada na rede.</p></div></header><div className="card filters"><input placeholder="Servidor" value={server} onChange={e=>setServer(e.target.value)}/><input placeholder="Categoria" value={category} onChange={e=>setCat(e.target.value)}/><input placeholder="Jogador / UUID" value={player} onChange={e=>setPlayer(e.target.value)}/><input placeholder="Texto" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={()=>load().catch(()=>{})}>Filtrar</button></div><div className="card feed">{merged.length?merged.map(e=><EventRow key={e.id} e={e}/>):<Empty text="Nenhum evento encontrado."/>}</div></>
}

function Players(){
  const nav=useNavigate(); const [q,setQ]=useState(''),[players,setPlayers]=useState([]);
  async function load(v=''){const r=await api('/api/v1/players?q='+encodeURIComponent(v));setPlayers(r.players)}
  useEffect(()=>{load().catch(()=>{})},[]);
  return <><header><div><h1>Jogadores</h1><p>Histórico individual consolidado.</p></div></header><div className="card filters"><input placeholder="Nome ou UUID" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={()=>load(q).catch(()=>{})}>Pesquisar</button></div><div className="card table-wrap"><table><thead><tr><th>Jogador</th><th>Eventos</th><th>Mortes</th><th>Moderação</th><th>Última atividade</th></tr></thead><tbody>{players.map(p=><tr key={p.player_uuid} onClick={()=>nav('/jogadores/'+encodeURIComponent(p.player_uuid))}><td><b>{p.player_name||'Desconhecido'}</b><small>{p.player_uuid}</small></td><td>{p.events}</td><td>{p.deaths}</td><td>{p.moderation}</td><td>{fmt(p.last_seen)}</td></tr>)}</tbody></table></div></>
}

function Player(){
  const {uuid}=useParams();const [d,setD]=useState(null);
  useEffect(()=>{api('/api/v1/players/'+encodeURIComponent(uuid)).then(setD).catch(()=>{})},[uuid]);
  if(!d)return <Empty text="Carregando jogador..."/>;
  const p=d.player;
  return <><header><div><h1>{p.player_name||'Jogador'}</h1><p>{p.player_uuid}</p></div></header><section className="metrics"><Card label="Eventos" value={p.events}/><Card label="Entradas" value={p.joins}/><Card label="Mortes" value={p.deaths}/><Card label="Punições" value={p.moderation}/><Card label="Comandos" value={p.commands}/><Card label="Trocas" value={p.trades}/></section><div className="card"><h2>Timeline</h2><div className="feed">{d.events.map(e=><EventRow key={e.id} e={e}/>)}</div></div></>
}

function SimpleFeed({endpoint,title}){const [items,setItems]=useState([]);useEffect(()=>{api(endpoint).then(r=>setItems(r.events||[])).catch(()=>{})},[endpoint]);return <><header><div><h1>{title}</h1><p>Registros centralizados do HEZZUZ Logs.</p></div></header><div className="card feed">{items.length?items.map(e=><EventRow key={e.id} e={e}/>):<Empty text="Nenhum registro encontrado."/>}</div></>}
function Servers(){const [items,setItems]=useState([]);useEffect(()=>{const load=()=>api('/api/v1/servers').then(r=>setItems(r.servers)).catch(()=>{});load();const t=setInterval(load,15000);return()=>clearInterval(t)},[]);return <><header><div><h1>Servidores</h1><p>Status da rede enviado pelos plugins.</p></div></header><div className="cards-list">{items.map(s=><div className="card server-card" key={s.server_id}><div><h2>{s.display_name||s.server_id}</h2><p>{s.version||'Versão não informada'}</p></div><span className={`pill ${s.status==='online'?'green':'red'}`}>{s.status}</span><div className="server-meta"><b>{s.players_online||0}</b><span>jogadores</span><small>Heartbeat: {fmt(s.last_heartbeat_at)}</small></div></div>)}</div></>}
function Empty({text}){return <div className="empty">{text}</div>}

function SessionGuard(){
  const [state,setState]=useState('loading');
  useEffect(()=>{api('/api/v1/auth/me').then(()=>setState('ok')).catch(()=>setState('no'))},[]);
  if(state==='loading') return <div className="login-shell"><div className="login-card"><div className="brand large"><span>H</span><div><b>HEZZUZ</b><small>NETWORK LOGS</small></div></div><p>Validando sessão...</p></div></div>;
  return state==='ok'?<Shell/>:<Navigate to="/login" replace/>;
}

function App(){return <BrowserRouter><Routes><Route path="/login" element={<Login/>}/><Route path="/*" element={<SessionGuard/>}/></Routes></BrowserRouter>}
createRoot(document.getElementById('root')).render(<App/>);
