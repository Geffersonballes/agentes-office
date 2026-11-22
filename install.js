#!/usr/bin/env node
'use strict';
/*
 * Instalador do hook do Escritório de Agentes.
 *
 *   node install.js                 pergunta URL, token e nível de detalhe e instala
 *   node install.js --url=https://agentes.exemplo.com.br --detalhe=minimo
 *                                   (o token é perguntado sem aparecer na tela, ou lido de AGENTES_OFFICE_TOKEN)
 *   node install.js --testar        envia um evento de teste para o servidor configurado
 *   node install.js --uninstall     remove só os hooks deste projeto (mantém ~/.agentes-office.json)
 *   node install.js --uninstall --purge   remove também ~/.agentes-office.json
 *
 * Sempre faz backup de ~/.claude/settings.json e de ~/.agentes-office.json antes de alterar.
 * É idempotente: rodar de novo não duplica nada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const HOME = os.homedir();
const SETTINGS = process.env.CLAUDE_SETTINGS_FILE || path.join(HOME, '.claude', 'settings.json');
const CONFIG = process.env.AGENTES_OFFICE_CONFIG || path.join(HOME, '.agentes-office.json');
const HOOK = path.join(__dirname, 'hook.js');
const COMMAND = `node "${HOOK}"`;
const OURS = /agentes-office.*hook\.js|hook\.js.*agentes-office/i;

const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'];
const OTHER_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop'];

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
function backup(file) {
  if (!fs.existsSync(file)) return null;
  const dest = file + '.bak-' + stamp();
  fs.copyFileSync(file, dest);
  return dest;
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const txt = fs.readFileSync(file, 'utf8');
  if (!txt.trim()) return fallback;
  try { return JSON.parse(txt); } catch (e) {
    console.error(`\nNão consegui ler ${file} (JSON inválido). Nada foi alterado.\nDetalhe: ${e.message}`);
    process.exit(1);
  }
}
function writeJson(file, obj, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: mode || 0o644 });
  fs.renameSync(tmp, file);
  if (mode) { try { fs.chmodSync(file, mode); } catch { /* Windows */ } }
}

/** Remove nossas entradas de um bloco de hooks, preservando as dos outros. */
function stripOurs(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const hs = g.hooks.filter((h) => !(h && typeof h.command === 'string' && OURS.test(h.command)));
      if (hs.length) kept.push(Object.assign({}, g, { hooks: hs }));
    }
    if (kept.length) out[event] = kept;
  }
  return out;
}

function applySettings(install) {
  const settings = readJson(SETTINGS, {});
  if (typeof settings !== 'object' || Array.isArray(settings)) { console.error('settings.json inesperado. Nada foi alterado.'); process.exit(1); }
  const before = JSON.stringify(settings);
  let hooks = stripOurs(settings.hooks);
  if (install) {
    const entry = { type: 'command', command: COMMAND, timeout: 5 };
    for (const ev of TOOL_EVENTS) (hooks[ev] = hooks[ev] || []).push({ matcher: '*', hooks: [entry] });
    for (const ev of OTHER_EVENTS) (hooks[ev] = hooks[ev] || []).push({ hooks: [entry] });
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
  if (JSON.stringify(settings) === before) return { changed: false };
  const bak = backup(SETTINGS);
  writeJson(SETTINGS, settings);
  return { changed: true, backup: bak };
}

function ask(rl, q, def) {
  return new Promise((r) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => r(a.trim() || def || '')));
}
function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  });
}

function testar() {
  const cfg = readJson(CONFIG, null);
  if (!cfg || !cfg.url) { console.log('Sem configuração em ' + CONFIG + '. Rode "node install.js" primeiro.'); process.exit(1); }
  const u = new URL(cfg.url.replace(/\/+$/, '') + '/event');
  const lib = u.protocol === 'https:' ? require('https') : require('http');
  const sid = 'teste-' + Date.now().toString(36);
  const post = (body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    const req = lib.request(u, { method: 'POST', headers, timeout: 90e3 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => { req.destroy(); resolve('tempo esgotado'); });
    req.on('error', (e) => resolve(e.code || e.message));
    req.end(data);
  });
  console.log(`Enviando evento de teste para ${u.origin} (se o servidor estiver dormindo, pode levar ~1 min)…`);
  const t0 = Date.now();
  post({ event: 'SessionStart', session_id: sid, ts: Date.now() }).then(async (st) => {
    console.log(`Resposta: ${st} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (st === 200) {
      await post({ event: 'UserPromptSubmit', session_id: sid, ts: Date.now() });
      await new Promise((r) => setTimeout(r, 3000));
      await post({ event: 'SessionEnd', session_id: sid, ts: Date.now() });
      console.log('OK! Um agente de teste deve ter aparecido no painel por alguns segundos.');
    } else if (st === 401) console.log('Token recusado (401). Confira o token com "node install.js".');
    else console.log('Não funcionou. Confira a URL e se o servidor está no ar.');
  });
}

async function main() {
  if (args.testar) return testar();

  if (args.uninstall) {
    const r = applySettings(false);
    console.log(r.changed ? `Hooks do Escritório de Agentes removidos de ${SETTINGS}.\nBackup: ${r.backup}` : 'Nenhum hook do Escritório de Agentes estava instalado.');
    if (args.purge && fs.existsSync(CONFIG)) { const b = backup(CONFIG); fs.unlinkSync(CONFIG); console.log(`Configuração ${CONFIG} removida (backup: ${b}).`); }
    else if (fs.existsSync(CONFIG)) console.log(`A configuração ${CONFIG} foi mantida (use --purge para apagar).`);
    return;
  }

  const current = readJson(CONFIG, {});
  let url = typeof args.url === 'string' ? args.url : null;
  let detalhe = typeof args.detalhe === 'string' ? args.detalhe : null;
  let token = process.env.AGENTES_OFFICE_TOKEN || null;
  const interactive = !args.sim && process.stdin.isTTY;

  if (interactive) {
    console.log('Instalação do hook do Escritório de Agentes\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!url) url = await ask(rl, 'URL do servidor', current.url || 'http://127.0.0.1:7777');
    if (!detalhe) detalhe = await ask(rl, 'Nível de detalhe (minimo/normal)', current.detalhe || 'minimo');
    rl.close();
    if (!token) {
      const t = await askHidden(current.token ? 'Token do hook (Enter mantém o atual): ' : 'Token do hook (Enter se for só local, sem token): ');
      token = t || current.token || '';
    }
  }
  url = (url || current.url || 'http://127.0.0.1:7777').replace(/\/+$/, '');
  detalhe = String(detalhe || current.detalhe || 'minimo').toLowerCase() === 'normal' ? 'normal' : 'minimo';
  if (token == null) token = current.token || '';

  let parsed; try { parsed = new URL(url); } catch { console.error('URL inválida: ' + url); process.exit(1); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!local && parsed.protocol !== 'https:') { console.error('Para servidor remoto use https://. Nada foi alterado.'); process.exit(1); }
  if (!local && !token) { console.error('Servidor remoto exige token. Nada foi alterado.'); process.exit(1); }

  const cfg = { url, token, detalhe };
  if (JSON.stringify(cfg) !== JSON.stringify(current)) {
    const b = backup(CONFIG);
    writeJson(CONFIG, cfg, 0o600);
    console.log(`Configuração gravada em ${CONFIG}${b ? ` (backup: ${b})` : ''}.`);
  } else console.log(`Configuração em ${CONFIG} já estava atualizada.`);

  const r = applySettings(true);
  console.log(r.changed ? `Hooks instalados em ${SETTINGS}${r.backup ? `\nBackup: ${r.backup}` : ''}` : 'Hooks já estavam instalados (nada mudou).');
  console.log(`\nServidor: ${url}\nDetalhe: ${detalhe}${detalhe === 'minimo' ? ' (só nome da ferramenta e tipo do evento)' : ''}`);
  console.log('Teste com:  node install.js --testar');
  console.log('Para remover:  node install.js --uninstall');
  console.log('Os hooks valem para as próximas sessões do Claude Code (reinicie as abertas).');
}

main();
