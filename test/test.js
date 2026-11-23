'use strict';
// Testes ponta a ponta locais: node --test test/
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'senha-de-teste-123456';
const TOKEN = 'token-de-teste-abcdefghijklmnopqrstuvwxyz';
let srv, PORT;

function req(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
let cached;
async function login() {
  if (cached) return cached;
  const r = await req('POST', '/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'senha=' + encodeURIComponent(PASSWORD) });
  assert.strictEqual(r.status, 303);
  return (cached = r.headers['set-cookie'][0].split(';')[0]);
}
const ev = (o) => JSON.stringify(Object.assign({ session_id: 'sess-1', ts: Date.now() }, o));
const auth = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

before(async () => {
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1', PANEL_PASSWORD: PASSWORD, HOOK_TOKEN: TOKEN }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  PORT = await new Promise((resolve, reject) => {
    srv.stdout.on('data', (d) => { const m = /:(\d+) \|/.exec(String(d)); if (m) resolve(Number(m[1])); });
    srv.on('exit', (c) => reject(new Error('servidor saiu ' + c)));
  });
});
after(() => srv && srv.kill());

test('sem login, o painel redireciona para /login e as rotas dão 401', async () => {
  assert.strictEqual((await req('GET', '/')).status, 302);
  assert.strictEqual((await req('GET', '/')).headers.location, '/login');
  for (const p of ['/state', '/events', '/app.js']) assert.strictEqual((await req('GET', p)).status, 401, p);
  assert.strictEqual((await req('POST', '/demo', { headers: { 'X-Requested-With': 'agentes-office' } })).status, 401);
  assert.strictEqual((await req('GET', '/login')).status, 200);
});

test('senha errada é recusada; certa gera cookie HttpOnly/SameSite', async () => {
  const bad = await req('POST', '/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'senha=errada' });
  assert.strictEqual(bad.status, 401);
  const r = await req('POST', '/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'senha=' + PASSWORD });
  const c = r.headers['set-cookie'][0];
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
  const forged = await req('GET', '/state', { headers: { Cookie: 'ao_sess=eyJleHAiOjk5OTk5OTk5OTk5OTl9.assinatura' } });
  assert.strictEqual(forged.status, 401);
});

test('Secure no cookie quando atrás de proxy HTTPS (sem TRUST_PROXY não confia)', async () => {
  const r = await req('POST', '/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' }, body: 'senha=' + PASSWORD });
  assert.doesNotMatch(r.headers['set-cookie'][0], /Secure/); // TRUST_PROXY desligado neste teste
});

test('POST /event: sem token 401, token errado 401, token certo 200', async () => {
  assert.strictEqual((await req('POST', '/event', { headers: { 'Content-Type': 'application/json' }, body: ev({ event: 'SessionStart' }) })).status, 401);
  assert.strictEqual((await req('POST', '/event', { headers: { Authorization: 'Bearer x' + TOKEN }, body: ev({ event: 'SessionStart' }) })).status, 401);
  assert.strictEqual((await req('POST', '/event', { headers: auth, body: ev({ event: 'SessionStart' }) })).status, 200);
  assert.strictEqual((await req('POST', '/event', { headers: auth, body: ev({ event: 'Inventado' }) })).status, 400);
  assert.strictEqual((await req('POST', '/event', { headers: auth, body: 'x'.repeat(40 * 1024) })).status, 413);
});

test('estado e cabeçalhos com login', async () => {
  const cookie = await login();
  const r = await req('GET', '/state', { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  const s = JSON.parse(r.body);
  assert.ok(s.agents.find((a) => a.id === 'sess-1'));
  assert.strictEqual(s.detail, 'minimo');
});

test('modo mínimo no servidor descarta detalhes mesmo se o hook mandar', async () => {
  await req('POST', '/event', { headers: auth, body: ev({ event: 'PreToolUse', tool_name: 'Bash', detail: 'rm -rf segredo', tool_input: { command: 'cat .env' }, prompt: 'meu prompt' }) });
  const cookie = await login();
  const s = await req('GET', '/state', { headers: { Cookie: cookie } });
  assert.doesNotMatch(s.body, /segredo|\.env|meu prompt/);
});

test('SSE: cabeçalhos certos e recebe eventos em tempo real', async () => {
  const cookie = await login();
  const got = await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/events', headers: { Cookie: cookie } }, (res) => {
      assert.strictEqual(res.headers['content-type'], 'text/event-stream; charset=utf-8');
      assert.strictEqual(res.headers['x-accel-buffering'], 'no');
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: state') && !buf.includes('sent')) {
          buf += 'sent';
          req('POST', '/event', { headers: auth, body: ev({ session_id: 'sse-1', event: 'UserPromptSubmit' }) });
        }
        if (buf.includes('event: log') && buf.includes('sse-1')) { r.destroy(); resolve(buf); }
      });
    });
    r.on('error', reject);
    setTimeout(() => reject(new Error('SSE não recebeu')), 4000);
  });
  assert.match(got, /UserPromptSubmit/);
});

test('fluxo de status: delegando, aguardando, concluído', async () => {
  const send = (o) => req('POST', '/event', { headers: auth, body: ev(Object.assign({ session_id: 'flow' }, o)) });
  const cookie = await login();
  const st = async () => JSON.parse((await req('GET', '/state', { headers: { Cookie: cookie } })).body).agents;
  await send({ event: 'UserPromptSubmit' });
  await send({ event: 'SubagentStart', agent_id: 'x1', agent_type: 'Explore' });
  let a = await st();
  assert.strictEqual(a.find((x) => x.id === 'flow').status, 'delegando');
  assert.strictEqual(a.find((x) => x.id === 'flow:x1').status, 'trabalhando');
  await send({ event: 'Notification', notification_type: 'permission_prompt' });
  a = await st();
  assert.strictEqual(a.find((x) => x.id === 'flow').status, 'aguardando');
  assert.strictEqual(a.find((x) => x.id === 'flow').room, 'Sua mesa / Aprovações');
  await send({ event: 'SubagentStop', agent_id: 'x1' });
  await send({ event: 'Stop' });
  a = await st();
  assert.strictEqual(a.find((x) => x.id === 'flow').status, 'concluido');
});

test('agentes ganham nome pela função e frase do que estão fazendo', async () => {
  const send = (o) => req('POST', '/event', { headers: auth, body: ev(Object.assign({ session_id: 'role-abcd' }, o)) });
  const cookie = await login();
  const st = async () => JSON.parse((await req('GET', '/state', { headers: { Cookie: cookie } })).body).agents;
  await send({ event: 'PreToolUse', tool_name: 'Edit' });
  let a = (await st()).find((x) => x.id === 'role-abcd');
  assert.strictEqual(a.role, 'Desenvolvedor'); assert.strictEqual(a.action, 'editando arquivo'); assert.strictEqual(a.tag, '#role');
  await send({ event: 'PreToolUse', tool_name: 'mcp__canva__generate-design' });
  a = (await st()).find((x) => x.id === 'role-abcd');
  assert.strictEqual(a.role, 'Copywriter'); assert.strictEqual(a.action, 'usando canva');
  await send({ event: 'SubagentStart', agent_id: 'zz9', agent_type: 'Explore' });
  const sub = (await st()).find((x) => x.id === 'role-abcd:zz9');
  assert.strictEqual(sub.role, 'Explorador');
  await send({ event: 'Notification', notification_type: 'permission_prompt' });
  a = (await st()).find((x) => x.id === 'role-abcd');
  assert.strictEqual(a.role, 'Aguardando você'); assert.strictEqual(a.action, 'esperando sua aprovação');
});

test('/history exige login e registra passagens pelas salas', async () => {
  assert.strictEqual((await req('GET', '/history')).status, 401);
  await req('POST', '/event', { headers: auth, body: ev({ session_id: 'hist-1234', event: 'PreToolUse', tool_name: 'Edit' }) });
  const cookie = await login();
  const h = JSON.parse((await req('GET', '/history', { headers: { Cookie: cookie } })).body);
  const v = h.find((x) => x.tag === '#hist');
  assert.ok(v); assert.strictEqual(v.room, 'Tecnologia'); assert.strictEqual(v.role, 'Desenvolvedor');
  assert.ok(!('id' in v));
});

test('/usage: exige token, soma tokens do dia e guarda limites de 5 h e semanal', async () => {
  const body = (o) => JSON.stringify(Object.assign({ session_id: 'uso-1' }, o));
  assert.strictEqual((await req('POST', '/usage', { headers: { 'Content-Type': 'application/json' }, body: body({ input_tokens: 10 }) })).status, 401);
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.strictEqual((await req('POST', '/usage', { headers: auth, body: body({ input_tokens: 1000, output_tokens: 200, cost_usd: 0.5, five_hour: { used_percentage: 23.5, resets_at: future }, seven_day: { used_percentage: 41.2, resets_at: future + 86400 } }) })).status, 200);
  await req('POST', '/usage', { headers: auth, body: body({ input_tokens: 1500, output_tokens: 300 }) });
  await req('POST', '/usage', { headers: auth, body: JSON.stringify({ session_id: 'uso-2', input_tokens: 100, output_tokens: 50 }) });
  assert.strictEqual((await req('POST', '/usage', { headers: auth, body: body({ input_tokens: 'x', five_hour: { used_percentage: 999 } }) })).status, 200);
  const cookie = await login();
  const u = JSON.parse((await req('GET', '/state', { headers: { Cookie: cookie } })).body).usage;
  assert.ok(u.today.input >= 1600 && u.today.output >= 350, JSON.stringify(u));
  assert.strictEqual(u.five_hour.used_percentage, 23.5);
  assert.strictEqual(u.seven_day.used_percentage, 41.2);
});

test('/demo exige cabeçalho anti-CSRF', async () => {
  const cookie = await login();
  assert.strictEqual((await req('POST', '/demo', { headers: { Cookie: cookie } })).status, 403);
  assert.strictEqual((await req('POST', '/demo', { headers: { Cookie: cookie, 'X-Requested-With': 'agentes-office', Origin: 'https://malicioso.com' } })).status, 403);
  assert.strictEqual((await req('POST', '/demo', { headers: { Cookie: cookie, 'X-Requested-With': 'agentes-office' } })).status, 200);
});

test('rate limit de login', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await req('POST', '/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'senha=x' });
  assert.strictEqual(last.status, 429);
});

test('servidor público recusa iniciar sem senha/token', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { HOST: '0.0.0.0', PORT: '0', PANEL_PASSWORD: '', HOOK_TOKEN: '' }), timeout: 5000 });
  assert.strictEqual(r.status, 1);
});

// ------------------------------------------------------------------ hook
function runHook(input, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hook.js')], { input, env: Object.assign({}, process.env, env), timeout: 5000 });
  return { ms: Date.now() - t0, status: r.status, out: String(r.stdout) + String(r.stderr) };
}

test('hook: entrega o evento com token, em modo mínimo, sem conteúdo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ url: 'http://127.0.0.1:' + PORT, token: TOKEN, detalhe: 'minimo' }));
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'hook-1', tool_name: 'Bash', tool_input: { command: 'echo SEGREDO' }, cwd: '/home/x/projeto-secreto' });
  const r = runHook(input, { AGENTES_OFFICE_CONFIG: cfg });
  assert.strictEqual(r.status, 0); assert.strictEqual(r.out, '');
  await new Promise((res) => setTimeout(res, 1200));
  const cookie = await login();
  const s = (await req('GET', '/state', { headers: { Cookie: cookie } })).body;
  assert.match(s, /hook-1/); assert.match(s, /Bash/);
  assert.doesNotMatch(s, /SEGREDO|projeto-secreto/);
});

test('hook: payload mínimo não leva prompt, comando nem caminho', () => {
  const { buildPayload } = require(path.join(ROOT, 'hook.js'));
  const p = buildPayload({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'texto privado', cwd: '/c/proj', tool_input: { file_path: '/a/b.txt' } }, 'minimo');
  assert.deepStrictEqual(Object.keys(p).sort(), ['event', 'session_id', 'ts']);
  const n = buildPayload({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/a/b/arquivo.js' } }, 'normal');
  assert.strictEqual(n.detail, 'arquivo.js');
});

test('hook: servidor fora do ar não atrasa nem quebra (sai rápido, código 0, sem saída)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ url: 'https://10.255.255.1', token: TOKEN })); // IP que não responde
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'x' });
  const r = runHook(input, { AGENTES_OFFICE_CONFIG: cfg });
  assert.strictEqual(r.status, 0); assert.strictEqual(r.out, '');
  assert.ok(r.ms < 1800, 'demorou ' + r.ms + ' ms'); // trava de 1,5 s
  const lixo = runHook('isto não é json', { AGENTES_OFFICE_CONFIG: cfg });
  assert.strictEqual(lixo.status, 0); assert.strictEqual(lixo.out, '');
  const vazio = runHook('', { AGENTES_OFFICE_CONFIG: path.join(dir, 'nao-existe.json') });
  assert.strictEqual(vazio.status, 0);
});

// ------------------------------------------------------------------ instalador
test('install: grava config, é idempotente, preserva outros hooks e desinstala só os dele', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const settings = path.join(dir, 'settings.json');
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(settings, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo outro' }] }] } }));
  const env = Object.assign({}, process.env, { CLAUDE_SETTINGS_FILE: settings, AGENTES_OFFICE_CONFIG: cfg, AGENTES_OFFICE_TOKEN: TOKEN });
  const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'install.js'), '--sim', ...a], { env, encoding: 'utf8' });

  let r = run('--url=https://agentes.exemplo.com.br', '--detalhe=minimo');
  assert.strictEqual(r.status, 0, r.stderr);
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.deepStrictEqual(c, { url: 'https://agentes.exemplo.com.br', token: TOKEN, detalhe: 'minimo' });
  assert.doesNotMatch(r.stdout, new RegExp(TOKEN)); // token nunca aparece na tela
  let s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.strictEqual(s.model, 'x');
  assert.strictEqual(s.hooks.Stop.length, 2);
  assert.strictEqual(s.hooks.PreToolUse[0].matcher, '*');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.bak-')));

  r = run('--url=https://agentes.exemplo.com.br', '--detalhe=minimo');
  assert.match(r.stdout, /já estavam instalados/);
  s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.strictEqual(s.hooks.Stop.length, 2);

  assert.strictEqual(run('--url=http://agentes.exemplo.com.br').status, 1); // http remoto recusado

  r = spawnSync(process.execPath, [path.join(ROOT, 'install.js'), '--uninstall'], { env, encoding: 'utf8' });
  s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepStrictEqual(s, { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo outro' }] }] } });
  assert.ok(fs.existsSync(cfg));
});

test('statusline: mostra a barra, envia só números e preserva a barra original', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ url: 'http://127.0.0.1:' + PORT, token: TOKEN }));
  const input = JSON.stringify({ session_id: 'sl-1', cwd: '/c/segredo', transcript_path: '/c/segredo/t.jsonl',
    context_window: { total_input_tokens: 4321, total_output_tokens: 765, used_percentage: 12 },
    cost: { total_cost_usd: 0.42 }, rate_limits: { five_hour: { used_percentage: 33, resets_at: Math.floor(Date.now() / 1000) + 999 } } });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'statusline.js')], { input, encoding: 'utf8', timeout: 5000,
    env: Object.assign({}, process.env, { AGENTES_OFFICE_CONFIG: cfg, TMPDIR: dir, TEMP: dir, TMP: dir }) });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /5h 33%/);
  await new Promise((res) => setTimeout(res, 300));
  const cookie = await login();
  const u = JSON.parse((await req('GET', '/state', { headers: { Cookie: cookie } })).body).usage;
  assert.ok(u.today.input >= 4321);
  assert.strictEqual(u.five_hour.used_percentage, 33);
  assert.doesNotMatch(JSON.stringify(u), /segredo/);

  // barra original continua sendo exibida
  fs.writeFileSync(cfg, JSON.stringify({ url: 'http://127.0.0.1:' + PORT, token: TOKEN, statusline_original: 'echo MINHA-BARRA' }));
  const r2 = spawnSync(process.execPath, [path.join(ROOT, 'statusline.js')], { input, encoding: 'utf8', timeout: 5000,
    env: Object.assign({}, process.env, { AGENTES_OFFICE_CONFIG: cfg, TMPDIR: dir, TEMP: dir, TMP: dir }) });
  assert.match(r2.stdout, /MINHA-BARRA/);
});

test('install: instala a barra de status guardando a original e devolve ao desinstalar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-'));
  const settings = path.join(dir, 'settings.json');
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo antiga', padding: 1 } }));
  const env = Object.assign({}, process.env, { CLAUDE_SETTINGS_FILE: settings, AGENTES_OFFICE_CONFIG: cfg, AGENTES_OFFICE_TOKEN: TOKEN });
  const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'install.js'), ...a], { env, encoding: 'utf8' });
  assert.strictEqual(run('--sim', '--url=https://agentes.exemplo.com.br').status, 0);
  let s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.match(s.statusLine.command, /statusline\.js/); assert.strictEqual(s.statusLine.padding, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).statusline_original, 'echo antiga');
  run('--sim', '--url=https://agentes.exemplo.com.br');                     // de novo: não perde a original
  assert.strictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).statusline_original, 'echo antiga');
  run('--uninstall');
  s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepStrictEqual(s.statusLine, { type: 'command', command: 'echo antiga', padding: 1 });
});

test('context-mode: lê a economia do context.db e mostra no painel', async () => {
  let sqlite; try { sqlite = require('node:sqlite'); } catch { return; }   // Node sem sqlite: pula
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cm-'));
  const proj = path.join(dir, 'projects', 'abcdef0123456789'); fs.mkdirSync(proj, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(proj, 'context.db'));
  db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, worktree TEXT NOT NULL, agent TEXT NOT NULL,
    kind TEXT NOT NULL, tool TEXT, key TEXT, path TEXT, ok INTEGER, exit_code INTEGER, bytes INTEGER, body TEXT, turn INTEGER NOT NULL,
    sandbox_bytes INTEGER NOT NULL DEFAULT 0, returned_bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL)`);
  const ins = db.prepare('INSERT INTO events (session_id, worktree, agent, kind, tool, body, turn, sandbox_bytes, returned_bytes, created_at, accessed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const now = Date.now();
  ins.run('cm-1', '/w', 'claude-code', 'cmd', 'ctx_execute', 'SEGREDO', 1, 40000, 1000, now, now);
  ins.run('cm-1', '/w', 'claude-code', 'index', 'ctx_index', '', 2, 11577, 64, now, now);
  ins.run('cm-1', '/w', 'claude-code', 'cmd', 'ctx_stats', '', 3, 9999, 9999, now, now);       // ctx_stats não conta
  ins.run('cm-1', '/w', 'claude-code', 'cost', 'x', '', 4, 9999, 0, now, now);                // custo não conta
  ins.run('old', '/w', 'claude-code', 'cmd', 'ctx_execute', '', 1, 5000, 500, now - 30 * 864e5, now);
  db.close();
  const { ctxStats } = require(path.join(ROOT, 'statusline.js'));
  process.env.CONTEXT_MODE_DIR = dir;
  const c = ctxStats('cm-1');
  delete process.env.CONTEXT_MODE_DIR;
  assert.deepStrictEqual(c.today, { produced: 51577, returned: 1064, calls: 2 });
  assert.deepStrictEqual(c.all, { produced: 56577, returned: 1564, calls: 3 });
  assert.strictEqual(c.session.calls, 2);

  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ url: 'http://127.0.0.1:' + PORT, token: TOKEN }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'statusline.js')], { input: JSON.stringify({ session_id: 'cm-1' }), encoding: 'utf8', timeout: 5000,
    env: Object.assign({}, process.env, { AGENTES_OFFICE_CONFIG: cfg, CONTEXT_MODE_DIR: dir, TMPDIR: dir, TEMP: dir, TMP: dir }) });
  assert.strictEqual(r.status, 0);
  await new Promise((res) => setTimeout(res, 300));
  const cookie = await login();
  const body = (await req('GET', '/state', { headers: { Cookie: cookie } })).body;
  const u = JSON.parse(body).usage;
  assert.strictEqual(u.context_mode.today.produced, 51577);
  assert.strictEqual(u.context_mode.today.returned, 1064);
  assert.strictEqual(u.context_mode.week.produced, 51577);
  const ex = u.context_mode.tools.find((t) => t.name === 'ctx_execute');
  assert.deepStrictEqual([ex.produced, ex.returned, ex.calls], [45000, 1500, 2]);
  assert.ok(!u.context_mode.tools.find((t) => t.name === 'ctx_stats'));
  assert.ok(u.context_mode.kinds.find((k) => k.name === 'index'));
  assert.doesNotMatch(body, /SEGREDO/);
});
