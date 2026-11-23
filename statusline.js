#!/usr/bin/env node
'use strict';
/*
 * Barra de status do Claude Code para o Escritório de Agentes.
 *
 * O Claude Code entrega aqui (e só aqui) os dados de uso: tokens da sessão,
 * custo estimado e os limites de 5 horas e semanal (planos Pro/Max).
 * Este script:
 *   1. mostra a barra de status (a sua barra antiga, se havia uma, continua igual);
 *   2. envia SÓ NÚMEROS para o painel (POST /usage), no máximo a cada 20 s, incluindo a economia
 *      do context-mode (bytes produzidos x bytes que voltaram à conversa), se ele estiver instalado.
 * Nunca envia prompts, nomes de arquivos ou pastas. Nunca trava: teto de 2 s.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const quit = () => { try { process.exit(0); } catch { /* nada */ } };
const THROTTLE_MS = 20e3;

function loadConfig() {
  try { return require(path.join(__dirname, 'hook.js')).loadConfig(); } catch { return { url: 'http://127.0.0.1:7777', token: '' }; }
}
function readRawConfig() {
  try { return JSON.parse(fs.readFileSync(process.env.AGENTES_OFFICE_CONFIG || path.join(os.homedir(), '.agentes-office.json'), 'utf8')) || {}; } catch { return {}; }
}

function ownLine(d) {
  const parts = ['Escritório'];
  const rl = d.rate_limits || {};
  if (rl.five_hour && typeof rl.five_hour.used_percentage === 'number') parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
  if (rl.seven_day && typeof rl.seven_day.used_percentage === 'number') parts.push(`semana ${Math.round(rl.seven_day.used_percentage)}%`);
  const cw = d.context_window || {};
  if (typeof cw.used_percentage === 'number') parts.push(`contexto ${Math.round(cw.used_percentage)}%`);
  return parts.join(' · ');
}

function payloadFrom(d) {
  const cw = d.context_window || {}, rl = d.rate_limits || {}, cost = d.cost || {};
  const lim = (o) => (o && typeof o.used_percentage === 'number' ? { used_percentage: o.used_percentage, resets_at: o.resets_at } : undefined);
  return {
    session_id: d.session_id,
    input_tokens: cw.total_input_tokens,
    output_tokens: cw.total_output_tokens,
    cost_usd: cost.total_cost_usd,
    five_hour: lim(rl.five_hour),
    seven_day: lim(rl.seven_day),
  };
}

// ---------------------------------------------------------------- context-mode
// Lê, só para leitura, os bancos do context-mode (~/.context-mode/projects/*/context.db) e soma, como o ctx_stats,
// os bytes que as ferramentas produziram e os que voltaram para a conversa. Só totais saem daqui.
const DAY_MS = 864e5, TZ_OFFSET_MS = 4 * 3600e3;   // dia e semana em UTC-4
function ctxStats(sessionId) {
  let sqlite;
  const ew = process.emitWarning;
  try { process.emitWarning = () => {}; sqlite = require('node:sqlite'); } catch { return undefined; } // Node antigo: sem dados
  finally { process.emitWarning = ew; }
  const root = process.env.CONTEXT_MODE_DIR || path.join(os.homedir(), '.context-mode');
  const dbs = [];
  try {
    for (const d of fs.readdirSync(path.join(root, 'projects'))) {
      const f = path.join(root, 'projects', d, 'context.db');
      if (fs.existsSync(f)) dbs.push(f);
    }
  } catch { return undefined; }
  if (!dbs.length) return undefined;
  const now = Date.now();
  const dayStart = Math.floor((now - TZ_OFFSET_MS) / DAY_MS) * DAY_MS + TZ_OFFSET_MS;
  const dow = (new Date(now - TZ_OFFSET_MS).getUTCDay() + 6) % 7;      // 0 = segunda
  const weekStart = dayStart - dow * DAY_MS;
  const CALLS = "tool IS NOT NULL AND kind <> 'cost' AND tool <> 'ctx_stats'";
  const z = () => ({ produced: 0, returned: 0, calls: 0 });
  const out = { all: z(), today: z(), week: z(), session: z() };
  for (const f of dbs) {
    let db;
    try {
      db = new sqlite.DatabaseSync(f, { readOnly: true });
      const q = (where, ...args) => db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(sandbox_bytes),0) AS produced, COALESCE(SUM(returned_bytes),0) AS returned FROM events WHERE ${CALLS}${where}`).get(...args);
      const add = (k, r) => { if (r) { out[k].produced += Number(r.produced) || 0; out[k].returned += Number(r.returned) || 0; out[k].calls += Number(r.calls) || 0; } };
      add('all', q(''));
      add('today', q(' AND created_at >= ?', dayStart));
      add('week', q(' AND created_at >= ?', weekStart));
      if (sessionId) add('session', q(' AND session_id = ?', String(sessionId)));
    } catch { /* banco em uso, outra versão ou corrompido: pula */ }
    finally { try { if (db) db.close(); } catch { /* nada */ } }
  }
  return out.all.calls ? out : undefined;
}

function shouldSend(p) {
  const file = path.join(os.tmpdir(), 'agentes-office-statusline.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* primeira vez */ }
  const sig = JSON.stringify([p.session_id, p.five_hour && Math.round(p.five_hour.used_percentage), p.seven_day && Math.round(p.seven_day.used_percentage)]);
  const now = Date.now();
  const due = !st.t || now - st.t > THROTTLE_MS || (st.sig !== sig && now - st.t > 3000);
  if (due) { try { fs.writeFileSync(file, JSON.stringify({ t: now, sig })); } catch { /* sem cache */ } }
  return due;
}

function send(p, cfg) {
  const u = new URL(cfg.url.replace(/\/+$/, '') + '/usage');
  const lib = u.protocol === 'https:' ? require('https') : require('http');
  const body = JSON.stringify(p);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
  const req = lib.request(u, { method: 'POST', headers, timeout: 1200 }, (res) => { res.resume(); res.on('end', quit); });
  req.on('timeout', () => { req.destroy(); quit(); });
  req.on('error', quit);
  req.end(body);
}

function main() {
  process.on('uncaughtException', quit);
  process.on('unhandledRejection', quit);
  setTimeout(quit, 2000).unref();
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('error', quit);
  process.stdin.on('end', () => {
    const input = Buffer.concat(chunks);
    let d = {};
    try { d = JSON.parse(input.toString('utf8')) || {}; } catch { d = {}; }

    // 1) a barra de status: a original, se existia; senão a nossa
    const raw = readRawConfig();
    let line = '';
    if (raw.statusline_original) {
      try {
        const r = require('child_process').spawnSync(raw.statusline_original, { shell: true, input, encoding: 'utf8', timeout: 1500, windowsHide: true });
        line = (r.stdout || '').replace(/\s+$/, '');
      } catch { line = ''; }
    }
    if (!line) line = ownLine(d);
    process.stdout.write(line + '\n');

    // 2) os números para o painel
    const p = payloadFrom(d);
    if (!p.session_id || !shouldSend(p)) return quit();
    try {
      const c = ctxStats(p.session_id);
      if (c) {
        p.context_mode = c;
        p.machine = require('crypto').createHash('sha256').update('agentes-office:' + os.hostname()).digest('hex').slice(0, 12);
      }
    } catch { /* sem economia desta vez */ }
    send(p, loadConfig());
  });
}

if (require.main === module) main();
module.exports = { payloadFrom, ownLine, ctxStats };
