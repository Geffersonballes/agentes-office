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
  assert.ok(r.ms < 1000, 'demorou ' + r.ms + ' ms');
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
