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

function send(payloadJson, cfg, timeoutMs, done) {
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
    return send(payload, loadConfig(), CHILD_TIMEOUT_MS, quit);
  }

  if (process.stdin.isTTY) return quit();
  const chunks = []; let size = 0;
  process.stdin.on('data', (c) => { size += c.length; if (size <= 2 * 1024 * 1024) chunks.push(c); });
  process.stdin.on('error', quit);
  process.stdin.on('end', () => {
    let input, cfg, payload;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || !input.hook_event_name) return quit();
      cfg = loadConfig();
      payload = JSON.stringify(buildPayload(input, cfg.detalhe));
    } catch { return quit(); }

    if (cfg.envio === 'direto') return send(payload, cfg, DIRECT_TIMEOUT_MS, quit);

    try {
      const c = require('child_process').spawn(process.execPath, [__filename, '--enviar'], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: Object.assign({}, process.env, { AO_PAYLOAD: Buffer.from(payload).toString('base64') }),
      });
      c.on('error', quit);
      c.unref();
    } catch { /* sem envio desta vez */ }
    quit();
  });
}

if (require.main === module) main();
module.exports = { buildPayload, loadConfig };
