import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, logout } from './api.js';
import './styles.css';

const fmt = v => v ? new Date(v).toLocaleString('pt-BR') : '-';
const severityClass = s => ['ERROR','CRITICAL','SEVERE'].includes(s) ? 'bad' : s === 'WARNING' ? 'warn' : 'ok';
const icon = c => ({activity:'●',death:'☠',moderation:'⚒',commands:'⌘',errors:'!',console:'▣',trades:'⇄',economy:'$',permissions:'◆',protection:'⬡',gameplay:'✦',world:'◎',server:'◉',public:'◌',private:'◍',clan:'♜',ally:'♞',staff:'♛',crates:'⬢'}[c] || '•');

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
