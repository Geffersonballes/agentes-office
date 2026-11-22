'use strict';
(() => {
  // ------------------------------------------------------------ desenho
  const W = 960, H = 560;               // coordenadas lógicas
  const TW = 44, TH = 22, S = 3.5, OX = 372, OY = 92, WALL = 30;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  let scale = 1, offX = 0, offY = 0;

  let ROOMS = ['CEO IA', 'Operações', 'Tecnologia', 'Produto', 'Aquisição', 'Vendas', 'Follow-up / CRM', 'Copy',
    'Landing Pages', 'Tráfego', 'Pós-venda', 'Curso IA Professores', 'Sala de Jogos', 'Sua mesa / Aprovações', 'Entrada'];
  const TINT = ['#3b2f5c', '#24384f', '#1f3d5a', '#2c3f35', '#3d3524', '#3a2a2a', '#2a3a3a', '#3a2f40', '#2f3446',
    '#3a3324', '#283a2e', '#33304a', '#2c3a24', '#4a3320', '#2a2f38'];
  const STAT = {
    trabalhando: ['#4f8cff', 'trabalhando'], delegando: ['#a371f7', 'delegando'],
    aguardando: ['#f0883e', 'aguardando aprovação'], concluido: ['#3fb950', 'concluído'], ocioso: ['#6e7681', 'ocioso'],
  };
  const PALETTE = ['#4f8cff', '#e3b341', '#a371f7', '#3fb950', '#ff7b72', '#39c5cf', '#f778ba', '#d29922'];

  const roomIdx = (name) => { const i = ROOMS.indexOf(name); return i < 0 ? ROOMS.length - 1 : i; };
  const roomOrigin = (i) => ({ gx: (i % 5) * 5, gy: Math.floor(i / 5) * 5 });
  const iso = (x, y, z = 0) => [(x - y) * TW / 2 + OX, (x + y) * TH / 2 + OY - z];

  function resize() {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    scale = Math.min(r.width / W, r.height / H) * dpr;
    offX = (cv.width - W * scale) / 2; offY = (cv.height - H * scale) / 2;
  }
  window.addEventListener('resize', resize);

  function poly(pts, fill, stroke) {
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.min(255, (v * f) | 0);
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function box(x, y, w, d, h, col) {
    const a = iso(x, y, h), b = iso(x + w, y, h), c = iso(x + w, y + d, h), e = iso(x, y + d, h);
    poly([e, c, iso(x + w, y + d), iso(x, y + d)], shade(col, 0.7));
    poly([b, c, iso(x + w, y + d), iso(x + w, y)], shade(col, 0.85));
    poly([a, b, c, e], col);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawRoom(i, t, hot) {
    const { gx, gy } = roomOrigin(i);
    const tint = TINT[i % TINT.length];
    poly([iso(gx, gy), iso(gx + S, gy), iso(gx + S, gy + S), iso(gx, gy + S)], hot ? shade(tint, 1.5 + 0.3 * Math.sin(t * 6)) : tint, '#3a4250');
    poly([iso(gx, gy), iso(gx + S, gy), iso(gx + S, gy, WALL), iso(gx, gy, WALL)], shade(tint, 1.25));
    poly([iso(gx, gy), iso(gx, gy + S), iso(gx, gy + S, WALL), iso(gx, gy, WALL)], shade(tint, 1.05));
    if (i !== ROOMS.length - 1) { box(gx + 1.3, gy + 0.8, 1.1, 0.6, 9, '#8a6d4f'); box(gx + 1.55, gy + 0.85, 0.6, 0.12, 16, '#20262e'); }
    if (ROOMS[i] === 'Sala de Jogos') box(gx + 0.4, gy + 2.2, 0.9, 0.6, 7, '#2f6f4f');
    if (ROOMS[i] === 'Sua mesa / Aprovações') box(gx + 2.6, gy + 0.6, 0.45, 0.45, 12, '#c08a3e');
  }
  function drawLabel(i, hot) {
    const { gx, gy } = roomOrigin(i);
    const p = iso(gx + S, gy + S);
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    const w = ctx.measureText(ROOMS[i]).width + 14;
    ctx.fillStyle = hot ? 'rgba(240,136,62,.9)' : 'rgba(13,17,23,.85)';
    roundRect(p[0] - w / 2, p[1] + 5, w, 19, 9); ctx.fill();
    ctx.fillStyle = hot ? '#fff' : '#c9d1d9'; ctx.fillText(ROOMS[i], p[0], p[1] + 19);
  }

  // ------------------------------------------------------------ estado
  const sprites = new Map(); // id -> sprite animado
  let agentList = [];
  let colorN = 0;

  function slotFor(a, list) {
    const same = list.filter((x) => x.room === a.room);
    const k = same.findIndex((x) => x.id === a.id);
    const SLOTS = [[2.1, 2.3], [2.9, 1.6], [1.0, 2.6], [2.8, 2.9], [0.8, 1.5], [1.7, 3.1]];
    const s = SLOTS[k % SLOTS.length];
    const o = roomOrigin(roomIdx(a.room));
    return { x: o.gx + s[0], y: o.gy + s[1] };
  }

  function setAgents(list) {
    agentList = list;
    const ids = new Set(list.map((a) => a.id));
    const entrada = roomOrigin(ROOMS.length - 1);
    for (const a of list) {
      let s = sprites.get(a.id);
      if (!s) {
        const parent = a.parent && sprites.get(a.parent);
        s = { x: parent ? parent.x : entrada.gx + 1.7, y: parent ? parent.y : entrada.gy + 1.7, alpha: 0,
          color: a.kind === 'main' ? PALETTE[colorN++ % PALETTE.length] : PALETTE[(colorN++ + 2) % PALETTE.length] };
        sprites.set(a.id, s);
      }
      Object.assign(s, { data: a, leaving: false });
      const tgt = slotFor(a, list); s.tx = tgt.x; s.ty = tgt.y;
    }
    for (const [id, s] of sprites) if (!ids.has(id)) s.leaving = true;
    renderAgents();
  }

  function shortName(a) {
    if (a.kind === 'main') return a.name.replace('Claude ', '');
    return (a.name.split(': ')[1] || 'sub').slice(0, 14);
  }

  function drawAgent(s, t) {
    if (s.alpha <= 0.01) return;
    const a = s.data;
    const [sx, sy] = iso(s.x, s.y);
    const moving = Math.hypot(s.tx - s.x, s.ty - s.y) > 0.05;
    const bob = moving ? Math.abs(Math.sin(t * 12)) * 3 : Math.sin(t * 2) * 0.6;
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, sy, 9, 4.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = s.color; roundRect(sx - 7, sy - 22 - bob, 14, 18, 5); ctx.fill();
    ctx.fillStyle = '#f1d3b3'; ctx.beginPath(); ctx.arc(sx, sy - 29 - bob, 7, 0, 7); ctx.fill();
    const col = (STAT[a.status] || STAT.ocioso)[0];
    const by = sy - 52 - bob;
    if (a.status === 'aguardando') {
      const k = 1 + 0.15 * Math.sin(t * 8);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, by, 11 * k, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', sx, by + 5);
    } else if (a.status === 'concluido') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, by, 10, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(sx - 5, by); ctx.lineTo(sx - 1, by + 4); ctx.lineTo(sx + 5, by - 4); ctx.stroke();
    } else if (a.status === 'ocioso') {
      ctx.fillStyle = col; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('z', sx + 6, by + 6 - ((t * 8) % 6)); ctx.fillText('Z', sx + 12, by - 2 - ((t * 8 + 3) % 6));
    } else {
      ctx.fillStyle = col; roundRect(sx - 17, by - 9, 34, 18, 9); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = s.alpha * ((Math.floor(t * 4) % 3) === k ? 1 : 0.45);
        ctx.beginPath(); ctx.arc(sx - 8 + k * 8, by, 2.6, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = s.alpha;
    }
    const label = shortName(a);
    ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = '#fff';
    ctx.strokeText(label, sx, sy + 15); ctx.fillText(label, sx, sy + 15);
    ctx.globalAlpha = 1;
  }

  function drawLinks(t) {
    for (const s of sprites.values()) {
      const a = s.data; if (!a.parent || s.alpha < 0.1) continue;
      const p = sprites.get(a.parent); if (!p || p.data.status !== 'delegando') continue;
      const [x1, y1] = iso(p.x, p.y), [x2, y2] = iso(s.x, s.y);
      ctx.save(); ctx.strokeStyle = 'rgba(163,113,247,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.moveTo(x1, y1 - 20); ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 70, x2, y2 - 20); ctx.stroke(); ctx.restore();
    }
  }

  let last = performance.now() / 1000;
  function frame() {
    const t = performance.now() / 1000, dt = Math.min(0.05, t - last); last = t;
    for (const [id, s] of sprites) {
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), sp = 4.2 * dt;
      if (d > sp) { s.x += (dx / d) * sp; s.y += (dy / d) * sp; } else { s.x = s.tx; s.y = s.ty; }
      if (s.leaving) { s.alpha -= dt * 1.2; if (s.alpha <= 0) sprites.delete(id); } else s.alpha = Math.min(1, s.alpha + dt * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    const waiting = agentList.some((a) => a.status === 'aguardando');
    const hotIdx = waiting ? roomIdx('Sua mesa / Aprovações') : -1;
    for (let i = 0; i < ROOMS.length; i++) drawRoom(i, t, i === hotIdx);
    for (let i = 0; i < ROOMS.length; i++) drawLabel(i, i === hotIdx);
    drawLinks(t);
    [...sprites.values()].sort((a, b) => a.x + a.y - (b.x + b.y)).forEach((s) => drawAgent(s, t));
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ painel lateral (sem innerHTML com dados)
  const elAgents = document.getElementById('agents');
  const elLog = document.getElementById('log');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function renderAgents() {
    elAgents.replaceChildren();
    if (!agentList.length) { elAgents.append(el('div', 'empty', 'Nenhum agente ativo.')); return; }
    for (const a of agentList) {
      const [c, label] = STAT[a.status] || STAT.ocioso;
      const row = el('div', 'ag' + (a.status === 'aguardando' ? ' wait' : ''));
      const dot = el('div', 'dot'); dot.style.background = (sprites.get(a.id) || {}).color || c;
      const nm = el('div', 'nm'); nm.append(el('div', null, a.name), el('div', 'room', a.room + (a.tool ? ' · ' + a.tool : '')));
      const chip = el('div', 'chip', label); chip.style.background = c + '22'; chip.style.color = c;
      row.append(dot, nm, chip); elAgents.append(row);
    }
  }
  const COLORS = { UserPromptSubmit: '#4f8cff', PreToolUse: '#4f8cff', PostToolUse: '#3fb950', PostToolUseFailure: '#ff7b72',
    SubagentStart: '#a371f7', SubagentStop: '#3fb950', Notification: '#f0883e', Stop: '#3fb950', SessionStart: '#8b949e', SessionEnd: '#8b949e' };
  function addLog(e) {
    const row = el('div');
    const d = new Date(e.t);
    row.append(el('span', 't', d.toLocaleTimeString('pt-BR') + ' '));
    const ev = el('b', null, e.event); ev.style.color = COLORS[e.event] || '#c9d1d9'; row.append(ev);
    if (e.tool) row.append(document.createTextNode(' · ' + e.tool));
    row.append(el('span', 'd', ' — ' + e.agent));
    if (e.detail) row.append(el('div', 'd', e.detail));
    elLog.prepend(row);
    while (elLog.children.length > 150) elLog.lastChild.remove();
  }

  // ------------------------------------------------------------ tempo real
  const live = document.getElementById('live');
  function setLive(state, text) { live.className = state; live.querySelector('span').textContent = text; }

  function connect() {
    const es = new EventSource('/events');
    es.addEventListener('open', () => setLive('on', 'AO VIVO'));
    es.addEventListener('error', () => {
      setLive('off', 'reconectando…');
      // se a sessão expirou, o /events responde 401: volta para o login
      fetch('/state', { credentials: 'same-origin' }).then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
    });
    es.addEventListener('state', (m) => {
      const s = JSON.parse(m.data);
      if (Array.isArray(s.rooms) && s.rooms.length) ROOMS = s.rooms;
      document.getElementById('foot').textContent = 'Modo de detalhe: ' + (s.detail === 'normal' ? 'normal (mostra detalhes curtos)' : 'mínimo (só ferramenta e tipo de evento)');
      elLog.replaceChildren(); s.log.forEach(addLog);
      setAgents(s.agents);
    });
    es.addEventListener('agents', (m) => setAgents(JSON.parse(m.data)));
    es.addEventListener('log', (m) => addLog(JSON.parse(m.data)));
  }

  document.getElementById('demo').addEventListener('click', () => {
    fetch('/demo', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'agentes-office' } }).catch(() => {});
  });

  resize();
  connect();
  requestAnimationFrame(frame);
})();
