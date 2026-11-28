#!/usr/bin/env node
'use strict';
/*
 * Hook do Claude Code para o Escritório de Agentes.
 *
 * Regras de ouro: nunca imprime nada, nunca falha, sempre sai com código 0,
 * e nunca segura o Claude Code por mais de ~1,5 s (trava de segurança).
 *
 * Configuração (opcional) em ~/.agentes-office.json:
 *   { "url": "https://agentes.exemplo.com.br", "token": "...", "detalhe": "minimo" | "normal",
 *     "envio": "direto" (padrão) | "segundo_plano", "log": false }
 * Variáveis que sobrescrevem: AGENTES_OFFICE_URL, AGENTES_OFFICE_TOKEN, AGENTES_OFFICE_DETALHE,
 * AGENTES_OFFICE_CONFIG (caminho de outro arquivo de configuração).
 * Sem configuração, envia para http://127.0.0.1:7777 (modo local, como antes).
 */

const quit = () => { try { process.exit(0); } catch { /* nada */ } };

// "direto" (padrão): envia e espera no máximo ~1,3 s. "segundo_plano": um processo filho envia.
const DIRECT_TIMEOUT_MS = 1300;
const CHILD_TIMEOUT_MS = 4000;

function loadConfig() {
  const fs = require('fs'), path = require('path'), os = require('os');
  let cfg = {};
  try {
    const file = process.env.AGENTES_OFFICE_CONFIG || path.join(os.homedir(), '.agentes-office.json');
    cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch { cfg = {}; }
  return {
    url: String(process.env.AGENTES_OFFICE_URL || cfg.url || 'http://127.0.0.1:7777').replace(/\/+$/, ''),
    token: String(process.env.AGENTES_OFFICE_TOKEN || cfg.token || ''),
    detalhe: String(process.env.AGENTES_OFFICE_DETALHE || cfg.detalhe || 'minimo').toLowerCase() === 'normal' ? 'normal' : 'minimo',
    envio: String(process.env.AGENTES_OFFICE_ENVIO || cfg.envio || 'direto') === 'segundo_plano' ? 'segundo_plano' : 'direto',
    log: process.env.AGENTES_OFFICE_LOG === '1' || cfg.log === true,
  };
}

/** Diário opcional (~/.agentes-office.log): só horário, evento, ferramenta e resultado. Nunca conteúdo. */
function writeLog(cfg, ev, result, ms) {
  if (!cfg.log) return;
  try {
    const fs = require('fs'), path = require('path'), os = require('os');
    const file = path.join(os.homedir(), '.agentes-office.log');
    try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old'); } catch { /* novo */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${ev.event || '?'} ${ev.tool_name || ''} -> ${result} (${ms} ms)\n`);
  } catch { /* nada */ }
}

// Assunto do pedido, decidido AQUI no seu computador: só o nome da sala sai daqui (nunca o texto).
const TOPICS = {
  'CEO IA': ['estrategia', 'estratégia', 'planejamento', 'decisao', 'decisão', 'meta ', 'metas', 'okr', 'visao', 'visão', 'negocio', 'negócio', 'plano de'],
  'Operações': ['operacao', 'operação', 'processo', 'planilha', 'sheets', 'calendar', 'agenda', 'drive', 'organiz', 'automatiz', 'relatorio', 'relatório'],
  'Tecnologia': ['codigo', 'código', 'programa', 'deploy', 'servidor', 'github', 'repositorio', 'repositório', 'commit', 'bug', 'erro', 'api', 'script', 'instal', 'hook', 'banco de dados', 'node', 'python', 'render', 'dns', 'painel', 'escritório de agentes', 'token', 'terminal', 'powershell'],
  'Produto': ['produto', 'feature', 'funcionalidade', 'roadmap', 'pesquisa', 'pesquis', 'concorrent', 'mercado', 'ideia'],
  'Aquisição': ['aquisicao', 'aquisição', 'lead', 'captacao', 'captação', 'funil', 'isca', 'lista de e'],
  'Vendas': ['venda', 'proposta', 'orcamento', 'orçamento', 'checkout', 'stripe', 'shopify', 'preço', 'preco', 'oferta', 'cliente novo'],
  'Follow-up / CRM': ['crm', 'follow', 'gmail', 'email', 'e-mail', 'hubspot', 'gohighlevel', 'whatsapp', 'mensagem', 'contato'],
  'Copy': ['copy', 'texto', 'headline', 'roteiro', 'legenda', 'post', 'artigo', 'carrossel', 'escrev', 'reescrev', 'video', 'vídeo'],
  'Landing Pages': ['landing', 'pagina', 'página', 'html', 'css', 'site', 'wix', 'wordpress', 'layout', 'design', '3d'],
  'Tráfego': ['trafego', 'tráfego', 'ads', 'anuncio', 'anúncio', 'campanha', 'metricool', 'windsor', 'instagram', 'tiktok', 'facebook', 'youtube'],
  'Pós-venda': ['pos-venda', 'pós-venda', 'suporte', 'reembolso', 'onboarding', 'atendimento'],
  'Curso IA Professores': ['curso', 'professor', 'aula', 'docencia', 'docência', 'educacao', 'educação', 'aluno', 'escola'],
};
function topicOf(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = 'geral', score = 0;
  for (const room of Object.keys(TOPICS)) {
    let sc = 0;
    for (const w of TOPICS[room]) if (t.includes(w)) sc += w.length;
    if (sc > score) { score = sc; best = room; }
  }
  return best;
}

/**
 * Soma, a partir do histórico da sessão (arquivo local), os tokens gastos. Só números saem daqui.
 * Lê só o pedaço novo do arquivo a cada vez (guarda onde parou), no máximo 16 MB por chamada,
 * para nunca atrasar o Claude Code mesmo em sessões com históricos enormes.
 */
function usageFromTranscript(file) {
  try {
    const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const stFile = path.join(os.tmpdir(), 'agentes-office-uso-' + crypto.createHash('sha1').update(file).digest('hex').slice(0, 16) + '.json');
    const fresh = () => ({ off: 0, input: 0, output: 0, read: 0, lastId: '', days: {} });
    let S = fresh();
    try { S = Object.assign(S, JSON.parse(fs.readFileSync(stFile, 'utf8'))); } catch { /* primeira vez */ }
    if (st.size < S.off) S = fresh();   // arquivo novo/recomeçado
    // dia (UTC-4) de cada mensagem, para o quadro separar "hoje" e "semana"
    const OFF4 = 4 * 3600e3, dayOf = (ms) => new Date(ms - OFF4).toISOString().slice(0, 10);
    const MAX = 16 * 1024 * 1024, len = Math.min(MAX, st.size - S.off);
    if (len > 0) {
      const buf = Buffer.alloc(len), fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buf, 0, len, S.off); } finally { fs.closeSync(fd); }
      const end = buf.lastIndexOf(10);                 // só linhas completas
      if (end >= 0) {
        const text = buf.toString('utf8', 0, end + 1);
        const num = (seg, k) => { const m = new RegExp('"' + k + '":(\\d+)').exec(seg); return m ? Number(m[1]) : 0; };
        let pos = 0;
        while (pos < text.length) {
          let nl = text.indexOf('\n', pos); if (nl < 0) nl = text.length;
          const u = text.indexOf('"usage":{', pos);
          if (u >= 0 && u < nl) {
            const ty = text.indexOf('"type":"assistant"', pos);   // a ordem dos campos varia: procura na linha toda
            if (ty >= pos && ty < nl) {
              const idm = /"id":"(msg_[A-Za-z0-9]+)"/.exec(text.slice(pos, u));
              const id = idm ? idm[1] : '';
              if (!id || id !== S.lastId) {
                const seg = text.slice(u, Math.min(nl, u + 900));
                const iT = num(seg, 'input_tokens') + num(seg, 'cache_creation_input_tokens'), oT = num(seg, 'output_tokens');
                S.input += iT; S.output += oT;
                S.read += num(seg, 'cache_read_input_tokens');
                const tsm = /"timestamp":"([0-9T:.\-]+Z)"/.exec(text.slice(pos, nl));
                const d = dayOf(tsm ? Date.parse(tsm[1]) || Date.now() : Date.now());
                const b = S.days[d] || (S.days[d] = [0, 0]); b[0] += iT; b[1] += oT;
              }
              if (id) S.lastId = id;
            }
          }
          pos = nl + 1;
        }
        S.off += Buffer.byteLength(text, 'utf8');
      }
      const keep = Object.keys(S.days).sort().slice(-15); const nd = {}; keep.forEach((k) => { nd[k] = S.days[k]; }); S.days = nd;
      try { fs.writeFileSync(stFile, JSON.stringify(S)); } catch { /* sem cache */ }
    }
    // hoje e semana (desde segunda), em UTC-4
    const now = Date.now(), today = dayOf(now), dow = (new Date(now - OFF4).getUTCDay() + 6) % 7, monday = dayOf(now - dow * 864e5);
    const sum = (f) => Object.keys(S.days).filter(f).reduce((a, k) => [a[0] + S.days[k][0], a[1] + S.days[k][1]], [0, 0]);
    const td = sum((k) => k === today), wk = sum((k) => k >= monday);
    return { input_tokens: S.input, output_tokens: S.output, cache_read_tokens: S.read,
      today: { input: td[0], output: td[1] }, week: { input: wk[0], output: wk[1] } };
  } catch { return null; }
}

const short = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);
const base = (p) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() : undefined);

/** Reduz o JSON do Claude Code ao necessário. Em "minimo" não sai nenhum conteúdo. */
function buildPayload(input, detalhe) {
  const ev = input.hook_event_name;
  const out = { event: ev, session_id: input.session_id, ts: Date.now() };
  if (input.agent_id) out.agent_id = input.agent_id;
  if (input.agent_type) out.agent_type = input.agent_type;
  if (input.tool_name) out.tool_name = input.tool_name;
  if (input.notification_type) out.notification_type = input.notification_type;
  if (ev === 'Notification' && /permiss/i.test(String(input.message || ''))) out.needs_approval = true;
  if (ev === 'UserPromptSubmit') out.topic = topicOf(input.prompt);

  if (detalhe === 'normal') {
    const ti = input.tool_input || {};
    let d;
    if (ev === 'UserPromptSubmit') d = short(input.prompt, 100);
    else if (ti.file_path || ti.notebook_path) d = base(ti.file_path || ti.notebook_path);
    else if (ti.description) d = short(ti.description, 100);
    else if (ti.command) d = short(ti.command, 80);
    else if (ti.pattern) d = short(ti.pattern, 60);
    else if (ti.url) d = short(ti.url, 80);
    else if (ti.query) d = short(ti.query, 80);
    else if (ev === 'Notification') d = short(input.message, 100);
    if (d) out.detail = d;
  }
  return out;
}

function post(pathname, body, cfg, timeoutMs, cb) {
  try {
    const u = new URL(cfg.url + pathname);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    const req = lib.request(u, { method: 'POST', headers, timeout: timeoutMs }, (res) => { res.resume(); res.on('end', () => cb(String(res.statusCode))); });
    req.on('timeout', () => { req.destroy(); cb('tempo esgotado'); });
    req.on('error', (e) => cb('erro ' + (e.code || e.message)));
    req.end(body);
  } catch (e) { cb('erro ' + e.message); }
}

function send(payloadJson, cfg, timeoutMs, done, usageJson) {
  if (usageJson) {
    // dois envios em paralelo: o evento e os números de uso
    let n = 2; const both = () => { if (--n === 0) done(); };
    post('/usage', usageJson, cfg, timeoutMs, both);
    return sendEvent(payloadJson, cfg, timeoutMs, both);
  }
  return sendEvent(payloadJson, cfg, timeoutMs, done);
}
function sendEvent(payloadJson, cfg, timeoutMs, done) {
  const t0 = Date.now();
  let ev = {}; try { ev = JSON.parse(payloadJson); } catch { /* nada */ }
  let finished = false;
  const finish = (result) => { if (finished) return; finished = true; writeLog(cfg, ev, result, Date.now() - t0); done(); };
  try {
    const u = new URL(cfg.url + '/event');
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payloadJson) };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    const req = lib.request(u, { method: 'POST', headers, timeout: timeoutMs }, (res) => {
      res.resume(); res.on('end', () => finish(String(res.statusCode)));
    });
    req.on('timeout', () => { req.destroy(); finish('tempo esgotado'); });
    req.on('error', (e) => finish('erro ' + (e.code || e.message)));
    req.end(payloadJson);
  } catch (e) { finish('erro ' + e.message); }
}

function main() {
  process.on('uncaughtException', quit);
  process.on('unhandledRejection', quit);
  const child = process.argv.includes('--enviar');
  // trava de segurança: nunca passa disso, aconteça o que acontecer
  setTimeout(quit, child ? 6000 : 1500).unref();

  // Processo filho (modo "segundo_plano"): envia e sai.
  if (child) {
    const payload = Buffer.from(process.env.AO_PAYLOAD || '', 'base64').toString('utf8');
    if (!payload) return quit();
    return send(payload, loadConfig(), CHILD_TIMEOUT_MS, quit, process.env.AO_USAGE ? Buffer.from(process.env.AO_USAGE, 'base64').toString('utf8') : null);
  }

  if (process.stdin.isTTY) return quit();
  const chunks = []; let size = 0;
  process.stdin.on('data', (c) => { size += c.length; if (size <= 2 * 1024 * 1024) chunks.push(c); });
  process.stdin.on('error', quit);
  process.stdin.on('end', () => {
    let input, cfg, payload, usage = null;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || !input.hook_event_name) return quit();
      cfg = loadConfig();
      payload = JSON.stringify(buildPayload(input, cfg.detalhe));
      if (input.hook_event_name === 'Stop' && input.transcript_path && input.session_id) {
        const u = usageFromTranscript(input.transcript_path);
        if (u) usage = JSON.stringify(Object.assign({ session_id: input.session_id, source: 'hook' }, u));
      }
    } catch { return quit(); }

    if (cfg.envio === 'direto') return send(payload, cfg, DIRECT_TIMEOUT_MS, quit, usage);

    try {
      const c = require('child_process').spawn(process.execPath, [__filename, '--enviar'], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: Object.assign({}, process.env, { AO_PAYLOAD: Buffer.from(payload).toString('base64') }, usage ? { AO_USAGE: Buffer.from(usage).toString('base64') } : {}),
      });
      c.on('error', quit);
      c.unref();
    } catch { /* sem envio desta vez */ }
    quit();
  });
}

if (require.main === module) main();
module.exports = { buildPayload, loadConfig, topicOf, usageFromTranscript, TOPICS };
