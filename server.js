#!/usr/bin/env node
'use strict';
/*
 * Escritório de Agentes — servidor (Node.js, sem dependências).
 *
 * Rotas:
 *   GET  /            painel (exige login)
 *   GET  /app.js      script do painel (exige login)
 *   GET  /events      SSE em tempo real (exige login)
 *   GET  /state       estado atual em JSON (exige login)
 *   GET  /history     quem passou por cada sala nas últimas 36 h (exige login)
 *   POST /demo        simulação (exige login + cabeçalho X-Requested-With)
 *   POST /event       recebe eventos do hook (exige Authorization: Bearer <HOOK_TOKEN>)
 *   POST /usage       recebe tokens e limites da barra de status (mesmo token)
 *   GET  /login       tela de login; POST /login entra; GET /logout sai
 *   GET  /healthz     verificação de saúde (sem login, não revela nada)
 *
 * Variáveis de ambiente (nenhum segredo fica no código):
 *   PANEL_PASSWORD   senha do painel (obrigatória fora do 127.0.0.1)
 *   HOOK_TOKEN       token do hook (obrigatório fora do 127.0.0.1)
 *   PORT / AGENTS_OFFICE_PORT   porta (padrão 7777)
 *   HOST             endereço de escuta (padrão 127.0.0.1; use 0.0.0.0 atrás do proxy HTTPS)
 *   TRUST_PROXY=1    confia em X-Forwarded-For / X-Forwarded-Proto (use atrás do proxy)
 *   PANEL_DETAIL     "minimo" (padrão) descarta qualquer detalhe; "normal" mostra detalhes curtos
 *   ROOMS_FILE       caminho de um rooms.json opcional (padrão ./rooms.json)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------- config
const PORT = Number(process.env.PORT || process.env.AGENTS_OFFICE_PORT || 7777);
const HOST = process.env.HOST || '127.0.0.1';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const HOOK_TOKEN = process.env.HOOK_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PANEL_DETAIL = (process.env.PANEL_DETAIL || 'minimo').toLowerCase() === 'normal' ? 'normal' : 'minimo';
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(__dirname, 'rooms.json');
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);

const MAX_BODY = 32 * 1024;            // corpo máximo do POST /event
const MAX_SSE_CLIENTS = 50;
const MAX_LOG = 200;
const SESSION_DAYS = 30;

if (!LOOPBACK && (!PANEL_PASSWORD || !HOOK_TOKEN)) {
  console.error('[agentes-office] Recusando iniciar: com HOST=' + HOST +
    ' é obrigatório definir PANEL_PASSWORD e HOOK_TOKEN.');
  process.exit(1);
}
if (PANEL_PASSWORD && PANEL_PASSWORD.length < 12) {
  console.error('[agentes-office] PANEL_PASSWORD precisa ter pelo menos 12 caracteres.');
  process.exit(1);
}
if (HOOK_TOKEN && HOOK_TOKEN.length < 24) {
  console.error('[agentes-office] HOOK_TOKEN precisa ter pelo menos 24 caracteres.');
  process.exit(1);
}
const AUTH_PANEL = !!PANEL_PASSWORD;
const AUTH_HOOK = !!HOOK_TOKEN;

// O segredo dos cookies deriva da senha: trocar a senha derruba todas as sessões.
const COOKIE_KEY = crypto.createHash('sha256').update('agentes-office/cookie/v1\0' + PANEL_PASSWORD).digest();

// ---------------------------------------------------------------- utilidades
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function makeSession() {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5, n: b64u(crypto.randomBytes(9)) }));
  const sig = b64u(crypto.createHmac('sha256', COOKIE_KEY).update(payload).digest());
  return payload + '.' + sig;
}
function validSession(value) {
  if (!value || typeof value !== 'string') return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  const expected = b64u(crypto.createHmac('sha256', COOKIE_KEY).update(payload).digest());
  if (!safeEqual(sig, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '?';
}
function authed(req) {
  return !AUTH_PANEL || validSession(parseCookies(req).ao_sess);
}

// Limite simples por IP (janela fixa). hit() conta; blocked() só consulta.
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  const get = (key) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    return e;
  };
  const hit = (key) => { const e = get(key); e.n++; return e.n <= max; };
  hit.blocked = (key) => get(key).n >= max;
  return hit;
}
const limitEvent = limiter(600, 60e3);     // 600 eventos/min por IP
const limitLogin = limiter(10, 15 * 60e3); // 10 senhas erradas / 15 min por IP
const limitLoginGlobal = limiter(100, 15 * 60e3); // 100 senhas erradas / 15 min no total
const limitGeneral = limiter(300, 60e3);   // demais rotas

function baseHeaders(req, extra) {
  const h = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return Object.assign(h, extra || {});
}
function send(req, res, status, body, type, extra) {
  res.writeHead(status, baseHeaders(req, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8' }, extra)));
  res.end(body);
}
const json = (req, res, status, obj) => send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooBig = () => Object.assign(new Error('grande'), { code: 413 });
    if (Number(req.headers['content-length'] || 0) > limit) { req.resume(); reject(tooBig()); return; }
    let size = 0; const chunks = [];
    const onData = (c) => {
      size += c.length;
      if (size > limit) { req.off('data', onData); req.resume(); reject(tooBig()); return; }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- salas
const ROOMS = [
  'CEO IA', 'Operações', 'Tecnologia', 'Produto', 'Aquisição',
  'Vendas', 'Follow-up / CRM', 'Copy', 'Landing Pages', 'Tráfego',
  'Pós-venda', 'Curso IA Professores', 'Sala de Jogos', 'Sua mesa / Aprovações', 'Entrada',
];
const DEFAULT_RULES = {
  'CEO IA': ['estrategia', 'estratégia', 'planejamento', 'decisao', 'decisão', 'meta', 'okr'],
  'Operações': ['operacao', 'operação', 'processo', 'planilha', 'sheets', 'calendar', 'agenda', 'drive', 'docs'],
  'Tecnologia': ['bash', 'powershell', 'ctx_execute', 'edit', 'write', 'read', 'grep', 'glob', 'multiedit', 'notebookedit', 'codigo', 'código', 'deploy', 'servidor', 'github', 'git', 'hostinger', 'api', 'bug'],
  'Produto': ['produto', 'feature', 'roadmap', 'websearch', 'webfetch', 'pesquisa'],
  'Aquisição': ['aquisicao', 'aquisição', 'lead', 'leads', 'captacao', 'captação', 'funil'],
  'Vendas': ['venda', 'vendas', 'proposta', 'orcamento', 'orçamento', 'checkout', 'stripe', 'shopify'],
  'Follow-up / CRM': ['crm', 'follow', 'followup', 'gmail', 'email', 'e-mail', 'hubspot', 'gohighlevel', 'whatsapp'],
  'Copy': ['copy', 'texto', 'headline', 'roteiro', 'canva', 'legenda'],
  'Landing Pages': ['landing', 'pagina', 'página', 'html', 'css', 'site', 'wix', 'wordpress'],
  'Tráfego': ['trafego', 'tráfego', 'ads', 'anuncio', 'anúncio', 'meta ads', 'google ads', 'campanha', 'metricool', 'windsor'],
  'Pós-venda': ['pos-venda', 'pós-venda', 'suporte', 'cliente', 'reembolso', 'onboarding'],
  'Curso IA Professores': ['curso', 'professor', 'professores', 'aula', 'docencia', 'docência', 'educacao', 'educação'],
  'Sala de Jogos': ['jogo', 'game', 'teste', 'brincadeira'],
};
let RULES = DEFAULT_RULES;
try {
  if (fs.existsSync(ROOMS_FILE)) {
    const custom = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    if (custom && typeof custom === 'object') {
      RULES = {};
      for (const [room, words] of Object.entries(custom)) {
        if (ROOMS.includes(room) && Array.isArray(words)) RULES[room] = words.map((w) => String(w).toLowerCase()).slice(0, 200);
      }
    }
  }
} catch (e) { console.error('[agentes-office] rooms.json inválido, usando salas padrão.'); }

function pickRoom(text, fallback) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = null, score = 0;
  for (const [room, words] of Object.entries(RULES)) {
    let s = 0;
    for (const w of words) if (w && t.includes(w)) s += w.length;
    if (s > score) { score = s; best = room; }
  }
  return best || fallback;
}

// ---------------------------------------------------------------- estado
const agents = new Map(); // id -> agente
const log = [];
let seq = 0;

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : undefined);
const cleanId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : undefined);

const STATUS = ['trabalhando', 'ocioso', 'delegando', 'aguardando', 'concluido'];
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'PreCompact'];

// Função de cada agente conforme a sala onde está trabalhando.
const ROLE = {
  'CEO IA': 'CEO / Estrategista', 'Operações': 'Gerente de Operações', 'Tecnologia': 'Desenvolvedor',
  'Produto': 'Pesquisador de Produto', 'Aquisição': 'Captador de Leads', 'Vendas': 'Vendedor',
  'Follow-up / CRM': 'Atendente de CRM', 'Copy': 'Copywriter', 'Landing Pages': 'Designer de Páginas',
  'Tráfego': 'Gestor de Tráfego', 'Pós-venda': 'Suporte ao Cliente', 'Curso IA Professores': 'Professor de IA',
  'Sala de Jogos': 'Testador', 'Sua mesa / Aprovações': 'Aguardando você', 'Entrada': 'Em espera',
};
// Função dos subagentes conforme o tipo que o Claude Code informa.
const SUBROLE = {
  'explore': 'Explorador', 'plan': 'Planejador', 'general-purpose': 'Assistente geral',
  'statusline-setup': 'Configurador', 'claude-code-guide': 'Consultor do Claude Code', 'web-fetch': 'Leitor de sites',
};
function toolAction(tool) {
  if (!tool) return null;
  const t = tool.toLowerCase();
  if (t.startsWith('mcp__')) {
    const server = t.split('__')[1] || '';
    return 'usando ' + server.replace(/^plugin_/, '').split('_')[0].replace(/-/g, ' ');
  }
  const map = { read: 'lendo arquivo', edit: 'editando arquivo', multiedit: 'editando arquivo', write: 'escrevendo arquivo',
    notebookedit: 'editando notebook', bash: 'rodando comando', powershell: 'rodando comando', grep: 'procurando no código',
    glob: 'procurando arquivos', websearch: 'pesquisando na web', webfetch: 'lendo site', task: 'delegando tarefa',
    agent: 'delegando tarefa', todowrite: 'organizando tarefas', skill: 'usando habilidade' };
  return map[t] || 'usando ' + tool;
}
function roleOf(a) {
  if (a.kind === 'sub') {
    const t = String(a.agentType || '').toLowerCase();
    return SUBROLE[t] || (a.agentType ? a.agentType : 'Assistente') ;
  }
  return ROLE[a.room] || 'Agente';
}
function actionOf(a) {
  switch (a.status) {
    case 'aguardando': return 'esperando sua aprovação';
    case 'concluido': return 'tarefa concluída';
    case 'ocioso': return 'livre, esperando tarefa';
    case 'delegando': return 'coordenando subagentes';
    default: return toolAction(a.tool) || 'pensando';
  }
}
const labelOf = (a) => roleOf(a) + ' ' + a.tag;
function publicAgent(a) {
  return { id: a.id, name: labelOf(a), role: roleOf(a), tag: a.tag, action: actionOf(a), kind: a.kind,
    parent: a.parent || null, status: a.status, room: a.room, tool: a.tool || null, since: a.since, updated: a.updated };
}
// ---------------------------------------------------------------- uso de tokens e limites
// Vem da barra de status do Claude Code (statusline.js): só números, nunca conteúdo.
// Dia e semana contados em UTC-4 (semana começa na segunda-feira).
const TZ_OFFSET_MS = 4 * 3600e3;
const dayKey = (t) => new Date(t - TZ_OFFSET_MS).toISOString().slice(0, 10);
const weekKey = (t) => { const d = new Date(t - TZ_OFFSET_MS); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const usage = { sessions: new Map(), five_hour: null, seven_day: null, updated: 0, ctx: new Map() };
const num = (v, max) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max ? v : null);
function sanitizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sid = cleanId(raw.session_id); if (!sid) return null;
  const lim = (o) => {
    if (!o || typeof o !== 'object') return null;
    const pct = num(o.used_percentage, 100), at = num(o.resets_at, 4e9);
    return pct === null ? null : { used_percentage: pct, resets_at: at };
  };
  const scope = (o) => (o && typeof o === 'object' ? { produced: num(o.produced, 1e15) || 0, returned: num(o.returned, 1e15) || 0, calls: num(o.calls, 1e9) || 0 } : null);
  const cm = raw.context_mode && typeof raw.context_mode === 'object' ? raw.context_mode : null;
  const machine = typeof raw.machine === 'string' && /^[a-f0-9]{6,32}$/.test(raw.machine) ? raw.machine : null;
  const list = (arr, max, re) => (Array.isArray(arr) ? arr.slice(0, max).filter((x) => x && typeof x.name === 'string' && re.test(x.name))
    .map((x) => Object.assign({ name: x.name }, scope(x))) : []);
  return { session_id: sid, input: num(raw.input_tokens, 1e12), output: num(raw.output_tokens, 1e12),
    cost: num(raw.cost_usd, 1e7), five_hour: lim(raw.five_hour), seven_day: lim(raw.seven_day),
    ctx: cm && machine ? { machine, all: scope(cm.all), today: scope(cm.today), week: scope(cm.week), session: scope(cm.session),
      tools: list(cm.tools, 15, /^[A-Za-z0-9_.:\-]{1,80}$/), kinds: list(cm.kinds, 8, /^(prompt|edit|cmd|toolerr|index|decision|\?)$/) } : null };
}
function applyUsage(u) {
  const now = Date.now(), day = dayKey(now), week = weekKey(now);
  let r = usage.sessions.get(u.session_id);
  if (!r) { r = { input: 0, output: 0, cost: 0, day, week, dIn: 0, dOut: 0, wIn: 0, wOut: 0, dCost: 0, wCost: 0 }; usage.sessions.set(u.session_id, r); }
  if (r.day !== day) { r.day = day; r.dIn = r.input; r.dOut = r.output; r.dCost = r.cost; }
  if (r.week !== week) { r.week = week; r.wIn = r.input; r.wOut = r.output; r.wCost = r.cost; }
  // os totais da sessão só crescem; se diminuírem, a sessão foi reiniciada
  if (u.input !== null && u.output !== null) {
    if (u.input < r.input || u.output < r.output) { r.dIn = r.wIn = 0; r.dOut = r.wOut = 0; r.dCost = r.wCost = 0; }
    r.input = u.input; r.output = u.output;
  }
  if (u.cost !== null) r.cost = u.cost;
  r.t = now;
  if (u.five_hour) usage.five_hour = Object.assign({ t: now }, u.five_hour);
  if (u.seven_day) usage.seven_day = Object.assign({ t: now }, u.seven_day);
  if (u.ctx) usage.ctx.set(u.ctx.machine, Object.assign({}, u.ctx, { t: now, dayKey: day, weekKey: week }));
  usage.updated = now;
  for (const [id, x] of usage.ctx) if (now - x.t > 9 * 864e5) usage.ctx.delete(id);
  for (const [id, x] of usage.sessions) if (now - x.t > 9 * 864e5) usage.sessions.delete(id);
}
function usageSummary() {
  const now = Date.now(), day = dayKey(now), week = weekKey(now);
  const out = { today: { input: 0, output: 0, cost: 0 }, week: { input: 0, output: 0, cost: 0 }, sessions_today: 0 };
  for (const r of usage.sessions.values()) {
    if (r.day === day) { out.today.input += r.input - r.dIn; out.today.output += r.output - r.dOut; out.today.cost += (r.cost || 0) - (r.dCost || 0); out.sessions_today++; }
    if (r.week === week) { out.week.input += r.input - r.wIn; out.week.output += r.output - r.wOut; out.week.cost += (r.cost || 0) - (r.wCost || 0); }
  }
  const live = (l) => (l && (!l.resets_at || l.resets_at * 1000 > now) ? { used_percentage: l.used_percentage, resets_at: l.resets_at } : null);
  out.five_hour = live(usage.five_hour); out.seven_day = live(usage.seven_day);
  // economia do context-mode: soma das máquinas (cada uma manda os totais do próprio disco)
  if (usage.ctx.size) {
    const z = () => ({ produced: 0, returned: 0, calls: 0 });
    const c = { all: z(), today: z(), week: z(), machines: usage.ctx.size, updated: 0, tools: [], kinds: [] };
    const merge = (dst, arr) => { for (const x of arr || []) { const d = dst.find((y) => y.name === x.name); if (d) { d.produced += x.produced; d.returned += x.returned; d.calls += x.calls; } else dst.push(Object.assign({}, x)); } };
    for (const m of usage.ctx.values()) {
      merge(c.tools, m.tools); merge(c.kinds, m.kinds);
      const add = (k, src) => { if (src) { c[k].produced += src.produced; c[k].returned += src.returned; c[k].calls += src.calls; } };
      add('all', m.all);
      if (m.dayKey === day) add('today', m.today);
      if (m.weekKey === week) add('week', m.week);
      c.updated = Math.max(c.updated, m.t);
    }
    c.tools.sort((x, y) => y.produced - x.produced); c.tools = c.tools.slice(0, 15);
    c.kinds.sort((x, y) => y.produced - x.produced);
    out.context_mode = c;
  }
  out.updated = usage.updated || null;
  return out;
}

function snapshot() {
  return { rooms: ROOMS, detail: PANEL_DETAIL, agents: [...agents.values()].map(publicAgent), log: log.slice(-60), usage: usageSummary() };
}

function ensureMain(sid) {
  let a = agents.get(sid);
  if (!a) {
    const n = [...agents.values()].filter((x) => x.kind === 'main').length + 1;
    a = { id: sid, tag: '#' + sid.replace(/[^A-Za-z0-9]/g, '').slice(0, 4), kind: 'main', status: 'ocioso',
      room: 'Entrada', since: Date.now(), updated: Date.now(), ts: 0, subs: new Set(), n };
    agents.set(sid, a);
  }
  return a;
}
// Histórico de passagens pelas salas (últimas 36 h, só função + código curto + horário).
const visits = [];
function recordVisit(a) {
  if (!a.room || a.room === 'Entrada') return;
  const last = visits.length && visits[visits.length - 1];
  if (last && last.id === a.id && last.room === a.room) return;
  visits.push({ id: a.id, room: a.room, role: roleOf(a), tag: a.tag, kind: a.kind, t: Date.now() });
  const cut = Date.now() - 36 * 3600e3;
  while (visits.length && (visits[0].t < cut || visits.length > 2000)) visits.shift();
}
function setStatus(a, status, room) {
  if (a.status !== status) { a.status = status; a.since = Date.now(); }
  if (room && room !== a.room) { a.room = room; recordVisit(a); }
  else if (room) a.room = room;
  a.updated = Date.now();
}
function pushLog(entry) {
  entry.id = ++seq; entry.t = Date.now();
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  broadcast('log', entry);
}

const timers = new Map();
function later(key, ms, fn) {
  clearTimeout(timers.get(key));
  const t = setTimeout(() => { timers.delete(key); fn(); scheduleAgents(); }, ms);
  t.unref(); timers.set(key, t);
}

/** Aplica um evento (já validado e reduzido) ao estado. */
function applyEvent(ev) {
  const sid = ev.session_id;
  const main = ensureMain(sid);
  const subId = ev.agent_id ? sid + ':' + ev.agent_id : null;
  const roomHint = [ev.tool_name, ev.agent_type, ev.detail].filter(Boolean).join(' ');
  const stale = ev.ts && ev.ts < main.ts; // eventos fora de ordem não mudam status
  if (ev.ts && !stale) main.ts = ev.ts;

  let target = main;
  if (subId && ev.event !== 'SubagentStart' && ev.event !== 'SubagentStop' && agents.has(subId)) target = agents.get(subId);

  switch (ev.event) {
    case 'SessionStart':
      setStatus(main, 'ocioso', 'Entrada');
      break;
    case 'SessionEnd':
      setStatus(main, 'concluido');
      later('end:' + sid, 5000, () => {
        for (const s of main.subs) agents.delete(s);
        agents.delete(sid);
      });
      break;
    case 'UserPromptSubmit':
      clearTimeout(timers.get('idle:' + sid));
      if (!stale) setStatus(main, 'trabalhando', pickRoom(roomHint, main.room === 'Entrada' || main.room === 'Sua mesa / Aprovações' ? 'Operações' : main.room));
      break;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      clearTimeout(timers.get('idle:' + sid));
      if (stale && target === main) break;
      const isTask = ev.tool_name === 'Task' || ev.tool_name === 'Agent';
      target.tool = ev.tool_name || target.tool;
      const st = target === main && (isTask || main.subs.size) ? 'delegando' : 'trabalhando';
      const room = isTask ? target.room : pickRoom(roomHint, target.room === 'Entrada' || target.room === 'Sua mesa / Aprovações' ? 'Tecnologia' : target.room);
      setStatus(target, st, room);
      break;
    }
    case 'SubagentStart': {
      if (!subId) break;
      let s = agents.get(subId);
      if (!s) {
        s = { id: subId, tag: '#' + ev.agent_id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4), agentType: ev.agent_type || '', kind: 'sub', parent: sid,
          status: 'trabalhando', room: 'Entrada', since: Date.now(), updated: Date.now(), ts: 0 };
        agents.set(subId, s);
      }
      main.subs.add(subId);
      setStatus(s, 'trabalhando', pickRoom(roomHint, 'Produto'));
      setStatus(main, 'delegando');
      break;
    }
    case 'SubagentStop': {
      const s = subId && agents.get(subId);
      if (s) {
        setStatus(s, 'concluido');
        main.subs.delete(subId);
        later('sub:' + subId, 6000, () => agents.delete(subId));
      } else if (!subId) {
        // versões antigas do Claude Code não mandam agent_id: encerra o subagente mais antigo
        const first = [...main.subs][0];
        if (first && agents.get(first)) { setStatus(agents.get(first), 'concluido'); main.subs.delete(first); later('sub:' + first, 6000, () => agents.delete(first)); }
      }
      if (!main.subs.size && main.status === 'delegando') setStatus(main, 'trabalhando');
      break;
    }
    case 'Notification': {
      const nt = String(ev.notification_type || '').toLowerCase();
      if (nt.includes('permission') || nt.includes('elicitation') || ev.needs_approval) {
        setStatus(main, 'aguardando', 'Sua mesa / Aprovações');
      }
      break;
    }
    case 'Stop':
      if (stale) break;
      setStatus(main, main.subs.size ? 'delegando' : 'concluido');
      later('idle:' + sid, 90e3, () => { if (agents.get(sid) && main.status === 'concluido') setStatus(main, 'ocioso', 'Entrada'); });
      break;
    default:
      break;
  }

  pushLog({ agent: labelOf(target), agentId: target.id, event: ev.event, tool: ev.tool_name || ev.agent_type || null,
    detail: PANEL_DETAIL === 'normal' ? (ev.detail || null) : null, ok: ev.event !== 'PostToolUseFailure' });
  scheduleAgents();
}

// limpeza de agentes esquecidos (sessão fechada sem SessionEnd)
setInterval(() => {
  const now = Date.now();
  for (const [id, a] of agents) if (now - a.updated > 45 * 60e3) { agents.delete(id); }
  scheduleAgents();
}, 60e3).unref();

/** Reduz o JSON recebido ao mínimo necessário. Nada além destes campos é guardado. */
function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = clip(raw.event || raw.hook_event_name, 40);
  if (!EVENTS.includes(event)) return null;
  const session_id = cleanId(raw.session_id) || 'sessao';
  const out = { event, session_id };
  const agent_id = cleanId(raw.agent_id); if (agent_id) out.agent_id = agent_id;
  const agent_type = clip(raw.agent_type, 60); if (agent_type) out.agent_type = agent_type;
  const tool = clip(raw.tool_name, 80); if (tool) out.tool_name = tool;
  const nt = clip(raw.notification_type, 40); if (nt) out.notification_type = nt;
  if (raw.needs_approval === true) out.needs_approval = true;
  if (typeof raw.ts === 'number' && isFinite(raw.ts)) out.ts = raw.ts;
  if (PANEL_DETAIL === 'normal') { const d = clip(raw.detail, 120); if (d) out.detail = d; }
  return out;
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(type, data) {
  const msg = 'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const c of clients) c.write(msg);
}
let agentsTimer = null;
function scheduleAgents() {
  if (agentsTimer) return;
  agentsTimer = setTimeout(() => { agentsTimer = null; broadcast('agents', [...agents.values()].map(publicAgent)); }, 80);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15e3).unref();

// ---------------------------------------------------------------- demo
let demoRunning = false;
function runDemo() {
  if (demoRunning) return false;
  demoRunning = true;
  const sid = 'demo-' + b64u(crypto.randomBytes(3));
  const steps = [
    [0, { event: 'SessionStart' }],
    [1200, { event: 'UserPromptSubmit' }],
    [2500, { event: 'PreToolUse', tool_name: 'Read' }],
    [3500, { event: 'PostToolUse', tool_name: 'Read' }],
    [4500, { event: 'PreToolUse', tool_name: 'Edit' }],
    [5500, { event: 'PostToolUse', tool_name: 'Edit' }],
    [6500, { event: 'PreToolUse', tool_name: 'Task' }],
    [7000, { event: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [8000, { event: 'SubagentStart', agent_id: 'a2', agent_type: 'general-purpose' }],
    [9500, { event: 'PreToolUse', tool_name: 'WebSearch', agent_id: 'a1' }],
    [11000, { event: 'Notification', notification_type: 'permission_prompt' }],
    [15000, { event: 'PostToolUse', tool_name: 'Bash' }],
    [16500, { event: 'SubagentStop', agent_id: 'a1' }],
    [18000, { event: 'SubagentStop', agent_id: 'a2' }],
    [19000, { event: 'PreToolUse', tool_name: 'Write' }],
    [20500, { event: 'Stop' }],
    [26000, { event: 'SessionEnd' }],
  ];
  for (const [ms, e] of steps) {
    setTimeout(() => applyEvent(Object.assign({ session_id: sid, ts: Date.now() }, e)), ms).unref();
  }
  setTimeout(() => { demoRunning = false; }, 27000).unref();
  return true;
}

// ---------------------------------------------------------------- páginas
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const APPJS = fs.readFileSync(path.join(__dirname, 'public', 'app.js'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function loginPage(msg) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Escritório de Agentes · Entrar</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
form{background:#161b22;border:1px solid #2a313c;border-radius:14px;padding:30px;width:100%;max-width:380px}
h1{font-size:20px;margin:0 0 4px}p{color:#8b949e;font-size:14px;margin:0 0 20px}
input{width:100%;height:44px;border-radius:8px;border:1px solid #2a313c;background:#0d1117;color:#e6edf3;padding:0 12px;font-size:16px;margin-bottom:14px}
button{width:100%;height:44px;border:0;border-radius:8px;background:#4f8cff;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.err{color:#ff7b72;font-size:14px;margin:-6px 0 12px}</style></head><body>
<form method="post" action="/login"><h1>Escritório de Agentes</h1><p>Acesso restrito</p>
${msg ? `<div class="err">${esc(msg)}</div>` : ''}
<input type="password" name="senha" placeholder="Senha" autocomplete="current-password" autofocus required>
<button type="submit">Entrar</button></form></body></html>`;
}

// ---------------------------------------------------------------- servidor
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);
  try {
    if (p === '/healthz') return send(req, res, 200, 'ok');

    // ---- hook
    if (p === '/usage') {
      if (req.method !== 'POST') return send(req, res, 405, 'método não permitido', null, { Allow: 'POST' });
      if (!limitEvent(ip)) return send(req, res, 429, 'muitas requisições', null, { 'Retry-After': '60' });
      if (AUTH_HOOK) {
        const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
        if (!m || !safeEqual(m[1].trim(), HOOK_TOKEN)) { req.resume(); return send(req, res, 401, 'não autorizado', null, { 'WWW-Authenticate': 'Bearer' }); }
      }
      let body;
      try { body = await readBody(req, 4096); } catch (e) { return send(req, res, 413, 'corpo grande demais', null, { Connection: 'close' }); }
      let raw; try { raw = JSON.parse(body); } catch { return send(req, res, 400, 'json inválido'); }
      const u = sanitizeUsage(raw);
      if (!u) return send(req, res, 400, 'uso inválido');
      applyUsage(u);
      broadcast('usage', usageSummary());
      return json(req, res, 200, { ok: true });
    }

    if (p === '/event') {
      if (req.method !== 'POST') return send(req, res, 405, 'método não permitido', null, { Allow: 'POST' });
      if (!limitEvent(ip)) return send(req, res, 429, 'muitas requisições', null, { 'Retry-After': '60' });
      if (AUTH_HOOK) {
        const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
        if (!m || !safeEqual(m[1].trim(), HOOK_TOKEN)) { req.resume(); return send(req, res, 401, 'não autorizado', null, { 'WWW-Authenticate': 'Bearer' }); }
      }
      let body;
      try { body = await readBody(req, MAX_BODY); } catch (e) { return send(req, res, e.code === 413 ? 413 : 400, e.code === 413 ? 'corpo grande demais' : 'erro', null, { Connection: 'close' }); }
      let raw; try { raw = JSON.parse(body); } catch { return send(req, res, 400, 'json inválido'); }
      const ev = sanitize(raw);
      if (!ev) return send(req, res, 400, 'evento inválido');
      applyEvent(ev);
      return json(req, res, 200, { ok: true });
    }

    if (!limitGeneral(ip)) return send(req, res, 429, 'muitas requisições', null, { 'Retry-After': '60' });

    // ---- login
    if (p === '/login') {
      if (!AUTH_PANEL) return send(req, res, 302, '', null, { Location: '/' });
      if (req.method === 'GET') return send(req, res, 200, loginPage(), 'text/html; charset=utf-8');
      if (req.method !== 'POST') return send(req, res, 405, 'método não permitido');
      if (limitLogin.blocked(ip) || limitLoginGlobal.blocked('all')) return send(req, res, 429, loginPage('Muitas tentativas. Aguarde 15 minutos.'), 'text/html; charset=utf-8', { 'Retry-After': '900' });
      let body; try { body = await readBody(req, 4096); } catch { return send(req, res, 413, 'corpo grande demais', null, { Connection: 'close' }); }
      const senha = new URLSearchParams(body).get('senha') || '';
      if (!safeEqual(senha, PANEL_PASSWORD)) {
        limitLogin(ip); limitLoginGlobal('all');
        await new Promise((r) => setTimeout(r, 400));
        return send(req, res, 401, loginPage('Senha incorreta.'), 'text/html; charset=utf-8');
      }
      const cookie = 'ao_sess=' + makeSession() + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_DAYS * 86400 + (isHttps(req) ? '; Secure' : '');
      return send(req, res, 303, '', null, { Location: '/', 'Set-Cookie': cookie });
    }
    if (p === '/logout') {
      return send(req, res, 303, '', null, { Location: '/login', 'Set-Cookie': 'ao_sess=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (isHttps(req) ? '; Secure' : '') });
    }

    // ---- daqui para baixo, tudo exige login
    if (!authed(req)) {
      if (p === '/' && req.method === 'GET') return send(req, res, 302, '', null, { Location: '/login' });
      return send(req, res, 401, 'não autorizado');
    }

    if (p === '/' && req.method === 'GET') return send(req, res, 200, INDEX, 'text/html; charset=utf-8');
    if (p === '/app.js' && req.method === 'GET') return send(req, res, 200, APPJS, 'text/javascript; charset=utf-8');
    if (p === '/state' && req.method === 'GET') return json(req, res, 200, snapshot());
    if (p === '/history' && req.method === 'GET') {
      const since = Math.max(Number(url.searchParams.get('since')) || 0, Date.now() - 36 * 3600e3);
      return json(req, res, 200, visits.filter((v) => v.t >= since).map(({ room, role, tag, kind, t }) => ({ room, role, tag, kind, t })));
    }

    if (p === '/events' && req.method === 'GET') {
      if (clients.size >= MAX_SSE_CLIENTS) return send(req, res, 503, 'muitas conexões');
      res.writeHead(200, baseHeaders(req, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }));
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true, 30e3);
      res.write('retry: 3000\n');
      res.write('event: state\ndata: ' + JSON.stringify(snapshot()) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/demo') {
      if (req.method !== 'POST') return send(req, res, 405, 'método não permitido');
      // proteção contra CSRF: cabeçalho customizado + mesma origem
      if (req.headers['x-requested-with'] !== 'agentes-office') return send(req, res, 403, 'proibido');
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(req, res, 403, 'proibido');
      req.resume();
      return json(req, res, 200, { ok: runDemo() });
    }

    return send(req, res, 404, 'não encontrado');
  } catch (e) {
    console.error('[agentes-office] erro:', e && e.message);
    if (!res.headersSent) send(req, res, 500, 'erro interno');
    else res.end();
  }
});
server.requestTimeout = 0;          // SSE é longo
server.headersTimeout = 15e3;
server.keepAliveTimeout = 65e3;

server.listen(PORT, HOST, () => {
  console.log(`[agentes-office] ouvindo em http://${HOST}:${server.address().port}` +
    ` | senha do painel: ${AUTH_PANEL ? 'ativa' : 'DESATIVADA (só local)'}` +
    ` | token do hook: ${AUTH_HOOK ? 'ativo' : 'DESATIVADO (só local)'}` +
    ` | detalhe: ${PANEL_DETAIL}`);
});

function shutdown() { for (const c of clients) c.end(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { server, sanitize, pickRoom };
