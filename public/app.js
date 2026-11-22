'use strict';
(() => {
  // ================================================================ base do desenho
  const W = 960, H = 560;                // coordenadas lógicas
  const TW = 44, TH = 22, S = 3.5, OX = 372, OY = 92, WALL = 40;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  let scale = 1, offX = 0, offY = 0;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let ROOMS = ['CEO IA', 'Operações', 'Tecnologia', 'Produto', 'Aquisição', 'Vendas', 'Follow-up / CRM', 'Copy',
    'Landing Pages', 'Tráfego', 'Pós-venda', 'Curso IA Professores', 'Sala de Jogos', 'Sua mesa / Aprovações', 'Entrada'];
  const TINT = ['#3b2f5c', '#24384f', '#1f3d5a', '#2c3f35', '#3d3524', '#3a2a2a', '#2a3a3a', '#3a2f40', '#2f3446',
    '#3a3324', '#283a2e', '#33304a', '#2c3a24', '#4a3320', '#2a2f38'];
  const STAT = {
    trabalhando: ['#4f8cff', 'trabalhando'], delegando: ['#a371f7', 'delegando'],
    aguardando: ['#f0883e', 'aguardando aprovação'], concluido: ['#3fb950', 'concluído'], ocioso: ['#6e7681', 'ocioso'],
  };
  // Cor da camiseta e acessório de cada função
  const STYLE = {
    'Desenvolvedor': ['#4f8cff', 'fone'], 'Copywriter': ['#f778ba', 'caderno'], 'Gestor de Tráfego': ['#3fb950', 'tablet'],
    'Vendedor': ['#d29922', 'gravata'], 'CEO / Estrategista': ['#8957e5', 'gravata'], 'Gerente de Operações': ['#39c5cf', 'prancheta'],
    'Pesquisador de Produto': ['#56d364', 'oculos'], 'Captador de Leads': ['#ff7b72', 'tablet'], 'Atendente de CRM': ['#e3b341', 'headset'],
    'Designer de Páginas': ['#db61a2', 'caderno'], 'Suporte ao Cliente': ['#79c0ff', 'headset'], 'Professor de IA': ['#a371f7', 'oculos'],
    'Testador': ['#2ea043', 'nenhum'], 'Explorador': ['#56d364', 'oculos'], 'Planejador': ['#a371f7', 'prancheta'],
    'Assistente geral': ['#e3b341', 'nenhum'],
  };
  const SKIN = ['#f1d3b3', '#e0b48f', '#c68c5f', '#a06a42', '#7a4f2e'];
  const HAIR = ['#2b1d14', '#4a3222', '#1b1b1b', '#8a5a2b', '#d6b370', '#5b2b2b'];
  const ID_COLORS = ['#4f8cff', '#e3b341', '#a371f7', '#3fb950', '#ff7b72', '#39c5cf', '#f778ba', '#d29922'];

  const DISPLAY = { 'Entrada': 'Sala de Espera' };
  const dispName = (n) => DISPLAY[n] || n;
  const LEISURE = new Set(['play', 'coffee', 'chess', 'cards', 'phone', 'magazine', 'videogame', 'darts']);
  const SITTING = new Set(['sit', 'chess', 'cards', 'phone', 'magazine', 'videogame']);
  const roomIdx = (name) => { const i = ROOMS.indexOf(name); return i < 0 ? ROOMS.length - 1 : i; };
  const roomOrigin = (i) => ({ gx: (i % 5) * 5, gy: Math.floor(i / 5) * 5 });
  const iso = (x, y, z = 0) => [(x - y) * TW / 2 + OX, (x + y) * TH / 2 + OY - z];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const lerp = (a, b, k) => a + (b - a) * k;

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
    const c = (v) => Math.max(0, Math.min(255, (v * f) | 0));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function box(x, y, w, d, h, col, z0 = 0, f = 1) {
    const a = iso(x, y, z0 + h), b = iso(x + w, y, z0 + h), c = iso(x + w, y + d, z0 + h), e = iso(x, y + d, z0 + h);
    poly([e, c, iso(x + w, y + d, z0), iso(x, y + d, z0)], shade(col, 0.7 * f));
    poly([b, c, iso(x + w, y + d, z0), iso(x + w, y, z0)], shade(col, 0.85 * f));
    poly([a, b, c, e], shade(col, f));
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // painéis nas paredes do fundo: parede "X" (y = gy) e parede "Y" (x = gx)
  const wallX = (gx, gy, a, b, z1, z2, col) => poly([iso(gx + a, gy, z2), iso(gx + b, gy, z2), iso(gx + b, gy, z1), iso(gx + a, gy, z1)], col);
  const wallY = (gx, gy, a, b, z1, z2, col) => poly([iso(gx, gy + a, z2), iso(gx, gy + b, z2), iso(gx, gy + b, z1), iso(gx, gy + a, z1)], col);
  const onWallX = (gx, gy, u, z) => iso(gx + u, gy, z);

  // ================================================================ salas
  const light = new Array(15).fill(0.78);  // 0.78 = penumbra, 1 = acesa

  function drawRoom(i, t, st) {
    const { gx, gy } = roomOrigin(i);
    const name = ROOMS[i];
    const L = light[i];
    const tint = TINT[i % TINT.length];
    const floor = st.hot ? shade(tint, 1.5 + 0.3 * Math.sin(t * 6)) : shade(tint, L);
    poly([iso(gx, gy), iso(gx + S, gy), iso(gx + S, gy + S), iso(gx, gy + S)], floor, '#3a4250');
    poly([iso(gx, gy), iso(gx + S, gy), iso(gx + S, gy, WALL), iso(gx, gy, WALL)], shade(tint, 1.25 * L));
    poly([iso(gx, gy), iso(gx, gy + S), iso(gx, gy + S, WALL), iso(gx, gy, WALL)], shade(tint, 1.05 * L));
    drawSign(gx, gy, dispName(name), st.hot, L);
    // porta (no lado direito da sala, para o corredor)
    poly([iso(gx + S - 0.05, gy + 1.35), iso(gx + S + 0.35, gy + 1.35), iso(gx + S + 0.35, gy + 2.15), iso(gx + S - 0.05, gy + 2.15)], shade('#6e4b2a', Math.max(L, 0.85)));
    themed(i, name, gx, gy, t, st, L);
    if (name !== 'Entrada' && name !== 'Sala de Jogos') {
      // estações de trabalho: mesa, computador e cadeira (o agente senta na cadeira de frente para o monitor)
      WORKSTATIONS.forEach((w, k) => {
        box(gx + w.desk[0], gy + w.desk[1], w.desk[2], 0.6, 9, '#8a6d4f', 0, L);
        box(gx + w.desk[0] + 0.22, gy + w.desk[1] + 0.05, 0.6, 0.12, 7, '#20262e', 9, L);
        screen(gx + w.desk[0] + 0.22, gy + w.desk[1] + 0.17, 0.6, 10, 15, st.lit && (st.busySeats || 0) > k, t, i * 3 + k);
        box(gx + w.desk[0] + 0.12, gy + w.desk[1] + 0.12, 0.25, 0.15, 3, '#30363d', 9, L);        // teclado
        box(gx + w.seat[0] - 0.22, gy + w.seat[1] - 0.25, 0.45, 0.4, 5, '#3d444d', 0, L);      // assento
        box(gx + w.seat[0] - 0.22, gy + w.seat[1] + 0.1, 0.45, 0.1, 13, '#3d444d', 0, L);      // encosto
      });
    }
  }

  // luminária acesa (desenhada depois da sombra da noite, para brilhar)
  function drawGlow(i, night) {
    const L = light[i];
    if (L <= 0.9) return;
    const { gx, gy } = roomOrigin(i);
    const c = iso(gx + S / 2, gy + S / 2, 0);
    const a = (0.16 + 0.22 * night) * Math.min(1, (L - 0.78) / 0.3);
    const g = ctx.createRadialGradient(c[0], c[1], 2, c[0], c[1], 80);
    g.addColorStop(0, `rgba(255,232,170,${a})`); g.addColorStop(1, 'rgba(255,232,170,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c[0], c[1], 82, 42, 0, 0, 7); ctx.fill();
  }

  // ================================================================ céu, chão e corredores
  const TZ = 'Etc/GMT+4';   // UTC-4 fixo (no Intl o sinal é invertido)
  function brasilia() {
    if (QS.has('hora')) { const h = Math.min(23.99, Math.max(0, Number(QS.get('hora')) || 0)); return { h, txt: String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0') + ' (prévia)' }; }
    try {
      const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const h = Number(parts.find((x) => x.type === 'hour').value) % 24, m = Number(parts.find((x) => x.type === 'minute').value);
      return { h: h + m / 60, txt: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') };
    } catch { const d = new Date(); return { h: d.getHours() + d.getMinutes() / 60, txt: d.toTimeString().slice(0, 5) }; }
  }
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function sky() {
    const { h, txt } = brasilia();
    const day = smooth(5.5, 7.5, h) * (1 - smooth(17.5, 19.5, h));   // 0 = noite, 1 = dia
    const dusk = Math.max(0, 1 - Math.abs(h - 18.3) / 1.4) + Math.max(0, 1 - Math.abs(h - 6.2) / 1.2) * 0.7;
    const label = day > 0.85 ? 'dia' : day < 0.15 ? 'noite' : h < 12 ? 'amanhecer' : 'entardecer';
    return { h, txt, day, dusk: Math.min(1, dusk), label };
  }
  const STARS = Array.from({ length: 70 }, (_, k) => [(k * 137.5) % W, ((k * 71.3) % 1) * 0 + ((k * 53) % 260), 0.6 + ((k * 7) % 10) / 12]);
  function drawSky(t, sk) {
    const top = [lerp(5, 30, sk.day) + 40 * sk.dusk, lerp(7, 44, sk.day) + 14 * sk.dusk, lerp(14, 62, sk.day)];
    const bot = [lerp(10, 22, sk.day) + 30 * sk.dusk, lerp(13, 28, sk.day) + 8 * sk.dusk, lerp(20, 36, sk.day)];
    const g = ctx.createLinearGradient(0, -200, 0, H + 200);
    g.addColorStop(0, `rgb(${top.map((v) => v | 0).join(',')})`); g.addColorStop(1, `rgb(${bot.map((v) => v | 0).join(',')})`);
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    if (sk.day < 0.4) {
      for (const [x, y, r] of STARS) {
        const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * 1.7 + x);
        ctx.fillStyle = `rgba(255,255,255,${(0.4 - sk.day) * 2 * tw})`; ctx.beginPath(); ctx.arc(x, y - 40, r, 0, 7); ctx.fill();
      }
    }
    // sol ou lua num arco no alto
    const isSun = sk.h >= 6 && sk.h < 18.5;
    const u = isSun ? (sk.h - 6) / 12.5 : ((sk.h + 24 - 18.5) % 24) / 11.5;
    const x = 60 + u * (W - 120), y = 70 - Math.sin(u * Math.PI) * 55;
    if (isSun) {
      const sg = ctx.createRadialGradient(x, y, 2, x, y, 40); sg.addColorStop(0, 'rgba(255,214,120,.55)'); sg.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, 40, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd37a'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = '#e6edf3'; ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill();
      ctx.fillStyle = `rgb(${top.map((v) => v | 0).join(',')})`; ctx.beginPath(); ctx.arc(x + 4, y - 3, 9, 0, 7); ctx.fill();
    }
  }
  // ================================================================ quadro de uso (tokens e limites), perto do sol
  let USAGE = null;
  const BOARD = { x: 728, y: 74, w: 222, h: 150 };
  const fmtTok = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' bi' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' mil' : String(Math.round(n))).replace('.', ',');
  function fmtReset(sec) {
    if (!sec) return '';
    const d = new Date(sec * 1000);
    const now = new Date();
    const sameDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
    const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
    if (sameDay.format(d) === sameDay.format(now)) return 'renova às ' + hm;
    const wd = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d).replace('.', '');
    return 'renova ' + wd + ' ' + hm;
  }
  const barColor = (p) => (p >= 85 ? '#ff7b72' : p >= 60 ? '#e3b341' : '#3fb950');
  function drawUsageBoard() {
    const { x, y, w, h } = BOARD;
    // hastes penduradas
    ctx.strokeStyle = 'rgba(201,209,217,.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + 30, y - 40); ctx.lineTo(x + 30, y); ctx.moveTo(x + w - 30, y - 40); ctx.lineTo(x + w - 30, y); ctx.stroke();
    ctx.fillStyle = 'rgba(13,17,23,.92)'; roundRect(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#8a6d4f'; ctx.lineWidth = 3; roundRect(x, y, w, h, 10); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e6edf3'; ctx.font = '700 12px system-ui'; ctx.fillText('Uso do Claude', x + 12, y + 19);
    const u = USAGE;
    ctx.font = '500 9px system-ui'; ctx.fillStyle = '#8b949e'; ctx.textAlign = 'right';
    if (u && u.updated) { const m = Math.max(0, Math.round((Date.now() - u.updated) / 60000)); ctx.fillText(m < 1 ? 'agora' : 'há ' + m + ' min', x + w - 12, y + 19); }
    ctx.textAlign = 'left';
    if (!u || !u.updated) {
      ctx.fillStyle = '#8b949e'; ctx.font = '500 10px system-ui';
      ['Aguardando dados da barra de status', 'do Claude Code. Reinstale com o', 'instalar.bat para ligar o quadro.'].forEach((l, k) => ctx.fillText(l, x + 12, y + 44 + k * 14));
      return;
    }
    ctx.font = '600 10.5px system-ui'; ctx.fillStyle = '#c9d1d9';
    ctx.fillText('Tokens hoje', x + 12, y + 40); ctx.fillText('Tokens na semana', x + 116, y + 40);
    ctx.font = '700 13px system-ui'; ctx.fillStyle = '#e6edf3';
    ctx.fillText(fmtTok(u.today.input + u.today.output), x + 12, y + 56); ctx.fillText(fmtTok(u.week.input + u.week.output), x + 116, y + 56);
    const rows = [['Limite de 5 horas', u.five_hour], ['Limite semanal', u.seven_day]];
    rows.forEach(([label, l], k) => {
      const yy = y + 76 + k * 36;
      ctx.font = '600 10px system-ui'; ctx.fillStyle = '#c9d1d9'; ctx.fillText(label, x + 12, yy);
      ctx.textAlign = 'right'; ctx.font = '700 10px system-ui';
      ctx.fillStyle = l ? barColor(l.used_percentage) : '#8b949e'; ctx.fillText(l ? Math.round(l.used_percentage) + '%' : '—', x + w - 12, yy); ctx.textAlign = 'left';
      ctx.fillStyle = '#21262d'; roundRect(x + 12, yy + 5, w - 24, 7, 3.5); ctx.fill();
      if (l) { ctx.fillStyle = barColor(l.used_percentage); roundRect(x + 12, yy + 5, Math.max(7, (w - 24) * Math.min(100, l.used_percentage) / 100), 7, 3.5); ctx.fill(); }
      ctx.font = '500 9px system-ui'; ctx.fillStyle = '#8b949e';
      ctx.fillText(l ? fmtReset(l.resets_at) : 'aparece após a 1ª resposta (Pro/Max)', x + 12, yy + 23);
    });
  }

  function drawFloor() {
    const x0 = -0.6, y0 = -0.6, x1 = 24.9, y1 = 14.9;
    poly([iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)], '#151b23', '#202833');
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= 24; x += 1) { const a = iso(x, y0), b = iso(x, y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    for (let y = 0; y <= 14; y += 1) { const a = iso(x0, y), b = iso(x1, y); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
  }

  function screen(x, y, w, z1, z2, lit, t, seed) {
    poly([iso(x + 0.04, y, z2), iso(x + w - 0.04, y, z2), iso(x + w - 0.04, y, z1), iso(x + 0.04, y, z1)], lit ? '#1f6feb' : '#0b0f14');
    if (!lit) return;
    ctx.strokeStyle = 'rgba(190,255,210,.9)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const len = 0.2 + 0.3 * Math.abs(Math.sin(t * 3 + k * 1.7 + seed));
      const z = z2 - 1.5 - k * 1.6;
      const a = iso(x + 0.1, y, z), b = iso(x + 0.1 + len * (w - 0.2), y, z);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }

  function themed(i, name, gx, gy, t, st, L) {
    const f = L;
    switch (name) {
      case 'CEO IA': { // quadro de metas
        wallX(gx, gy, 0.5, 2.3, 12, 26, shade('#d0d7de', f));
        const bars = [0.4, 0.65, 0.9];
        bars.forEach((h, k) => {
          const grow = st.lit && !reduced ? 0.85 + 0.15 * Math.sin(t * 2 + k) : 1;
          const a = 0.75 + k * 0.5;
          wallX(gx, gy, a, a + 0.3, 13, 13 + 11 * h * grow, shade(['#f0883e', '#e3b341', '#3fb950'][k], f));
        });
        break;
      }
      case 'Operações': { // kanban
        wallX(gx, gy, 0.4, 2.6, 12, 26, shade('#c9d1d9', f));
        for (let c = 0; c < 3; c++) for (let r = 0; r < 3 - c; r++) {
          const a = 0.55 + c * 0.7;
          wallX(gx, gy, a, a + 0.45, 22 - r * 3.4, 24.5 - r * 3.4, shade(['#79c0ff', '#e3b341', '#56d364'][c], f));
        }
        break;
      }
      case 'Produto': // planta
        box(gx + 3.0, gy + 0.2, 0.35, 0.35, 5, '#8a5a2b', 0, f);
        ctx.fillStyle = shade('#2ea043', f); { const p = iso(gx + 3.17, gy + 0.37, 13); ctx.beginPath(); ctx.ellipse(p[0], p[1], 9, 7, 0, 0, 7); ctx.fill(); }
        break;
      case 'Aquisição': { // funil na parede
        const a = iso(gx, gy + 0.8, 26), b = iso(gx, gy + 2.6, 26), c = iso(gx, gy + 1.7, 12);
        poly([a, b, c], shade('#ff7b72', f));
        break;
      }
      case 'Vendas': { // sino de venda
        const p = iso(gx + 2.25, gy + 1.05, 12);
        const wig = st.lit && !reduced ? Math.sin(t * 14) * 0.25 : 0;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(wig);
        ctx.fillStyle = shade('#e3b341', f); ctx.beginPath(); ctx.arc(0, 0, 5, Math.PI, 0); ctx.lineTo(6, 1); ctx.lineTo(-6, 1); ctx.fill();
        ctx.restore();
        break;
      }
      case 'Follow-up / CRM': // calendário
        wallY(gx, gy, 0.6, 1.8, 13, 25, shade('#f6f8fa', f));
        wallY(gx, gy, 0.6, 1.8, 22, 25, shade('#ff7b72', f));
        break;
      case 'Copy': { // post-its
        const cols = ['#f9e2af', '#f778ba', '#79c0ff', '#56d364'];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
          const a = 0.5 + c * 0.6, z = 22 - r * 6;
          wallY(gx, gy, a, a + 0.42, z - 4.2, z, shade(cols[(r + c) % 4], f));
        }
        break;
      }
      case 'Landing Pages': // wireframes na parede
        wallY(gx, gy, 0.6, 1.5, 13, 25, shade('#f6f8fa', f)); wallY(gx, gy, 0.7, 1.4, 21, 24, shade('#db61a2', f)); wallY(gx, gy, 0.7, 1.4, 14, 19, shade('#c9d1d9', f));
        wallY(gx, gy, 1.8, 2.7, 13, 25, shade('#f6f8fa', f)); wallY(gx, gy, 1.9, 2.6, 21, 24, shade('#388bfd', f)); wallY(gx, gy, 1.9, 2.6, 14, 19, shade('#c9d1d9', f));
        break;
      case 'Tráfego': { // telão com gráfico subindo
        wallX(gx, gy, 0.3, 2.9, 11, 28, shade('#0d1117', Math.max(f, 0.8)));
        ctx.strokeStyle = st.lit ? '#3fb950' : '#2b6a3a'; ctx.lineWidth = 2; ctx.beginPath();
        const n = 9;
        for (let k = 0; k <= n; k++) {
          const u = k / n;
          const wob = st.lit && !reduced ? Math.sin(t * 3 + k) * 1.2 : 0;
          const p = onWallX(gx, gy, 0.45 + u * 2.3, 13 + u * 12 + Math.sin(k * 1.9) * 2 + wob);
          k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
        break;
      }
      case 'Pós-venda': { // headset na mesa
        const p = iso(gx + 2.25, gy + 1.15, 11);
        ctx.strokeStyle = shade('#c9d1d9', f); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 4, Math.PI, 0); ctx.stroke();
        break;
      }
      case 'Curso IA Professores': // lousa
        wallY(gx, gy, 0.4, 3.0, 11, 27, shade('#1f4d3a', Math.max(f, 0.8)));
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const a = iso(gx, gy + 0.7, 24 - k * 4), b = iso(gx, gy + 0.7 + 0.8 + k * 0.5, 24 - k * 4);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
        break;
      case 'Sala de Jogos': {
        // videogame: TV na parede do fundo e dois pufes
        wallX(gx, gy, 1.75, 3.25, 8, 24, '#0b0f14');
        if (!reduced || true) {
          const cols = ['#ff7b72', '#e3b341', '#3fb950', '#4f8cff', '#a371f7'];
          for (let k = 0; k < 5; k++) {
            const u = 1.85 + ((k * 0.27 + (reduced ? 0 : t * 0.35)) % 1.25);
            const z = 11 + ((k * 5 + (reduced ? 0 : Math.floor(t * 2) * 3)) % 10);
            wallX(gx, gy, u, u + 0.12, z, z + 2.5, cols[k]);
          }
        }
        for (const [bx, by, col] of [[2.1, 1.15, '#8957e5'], [2.85, 1.15, '#d29922']]) {
          const c = iso(gx + bx, gy + by, 0); ctx.fillStyle = shade(col, f); ctx.beginPath(); ctx.ellipse(c[0], c[1] - 3, 10, 6, 0, 0, 7); ctx.fill();
        }
        // dardos na parede da esquerda
        { const c = iso(gx, gy + 0.75, 18);
          const rings = ['#1b1f24', '#f6f8fa', '#d1242f', '#f6f8fa', '#2ea043'];
          rings.forEach((col, k) => { ctx.fillStyle = shade(col, Math.max(f, 0.8)); ctx.beginPath(); ctx.ellipse(c[0], c[1], 6.5 - k * 1.2, 8 - k * 1.5, -0.45, 0, 7); ctx.fill(); });
          ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 1; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(c[0] - 1 + k * 1.5, c[1] - 1 + k); ctx.lineTo(c[0] + 2 + k * 1.5, c[1] + 1 + k); ctx.stroke(); } }
        // ping-pong com bolinha
        box(gx + 0.3, gy + 2.1, 1.65, 0.8, 6, '#1f6f4f', 0, f);
        { const n1 = iso(gx + 1.12, gy + 2.1, 6), n2 = iso(gx + 1.12, gy + 2.9, 6);
          ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(n1[0], n1[1] - 2); ctx.lineTo(n2[0], n2[1] - 2); ctx.stroke(); }
        if (!reduced) {
          const u = (Math.sin(t * 2.2) + 1) / 2;
          const p = iso(gx + 0.4 + u * 1.45, gy + 2.5, 9 + Math.abs(Math.sin(t * 4.4)) * 7);
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p[0], p[1], 2, 0, 7); ctx.fill();
        }
        // máquina de café
        box(gx + 3.05, gy + 2.35, 0.32, 0.3, 12, '#30363d', 0, f);
        { const p = iso(gx + 3.2, gy + 2.65, 8); ctx.fillStyle = '#f0883e'; ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); }
        break;
      }
      case 'Sua mesa / Aprovações': { // sino de aprovação
        box(gx + 2.6, gy + 0.6, 0.45, 0.45, 12, '#c08a3e', 0, f);
        if (st.waiting) {
          const p = iso(gx + 2.82, gy + 0.82, 26);
          const k = 0.5 + 0.5 * Math.sin(t * 8);
          ctx.fillStyle = `rgba(240,136,62,${0.35 + 0.65 * k})`;
          ctx.beginPath(); ctx.arc(p[0], p[1], 6, Math.PI, 0); ctx.lineTo(p[0] + 7, p[1] + 1); ctx.lineTo(p[0] - 7, p[1] + 1); ctx.fill();
          ctx.beginPath(); ctx.arc(p[0], p[1] + 3, 1.8, 0, 7); ctx.fill();
        }
        break;
      }
      case 'Entrada': { // Sala de Espera: porta, cadeiras, xadrez e cartas
        wallX(gx, gy, 1.3, 2.2, 0, 24, shade('#6e4b2a', Math.max(f, 0.8)));
        { const k = iso(gx + 2.05, gy, 12); ctx.fillStyle = '#e3b341'; ctx.beginPath(); ctx.arc(k[0], k[1], 1.5, 0, 7); ctx.fill(); }
        poly([iso(gx + 1.4, gy + 0.15), iso(gx + 2.1, gy + 0.15), iso(gx + 2.1, gy + 0.65), iso(gx + 1.4, gy + 0.65)], shade('#8b3a3a', Math.max(f, 0.8)));
        // quadro na parede
        wallY(gx, gy, 1.2, 2.4, 14, 26, shade('#30363d', Math.max(f, 0.8)));
        wallY(gx, gy, 1.35, 2.25, 16, 24, shade('#388bfd', Math.max(f, 0.8)));
        // cadeiras encostadas na parede da esquerda
        for (const y of [0.7, 1.3, 1.9, 2.5, 3.1]) { box(gx + 0.12, gy + y - 0.2, 0.42, 0.4, 5, '#3d444d', 0, f); box(gx + 0.05, gy + y - 0.2, 0.12, 0.4, 12, '#3d444d', 0, f); }
        // mesa de xadrez
        stool(gx + 1.6, gy + 1.8, f); stool(gx + 1.6, gy + 2.95, f);
        box(gx + 1.3, gy + 2.1, 0.6, 0.6, 7, '#6e4b2a', 0, f);
        checker(gx + 1.33, gy + 2.13, 4, 0.54, 7, '#e6edf3', '#30363d', Math.max(f, 0.85));
        { const mv = reduced ? 0 : (Math.floor(t / 3) % 4) * 0.13;
          for (const [px, py, col] of [[1.42 + mv, 2.2, '#f6f8fa'], [1.7, 2.3, '#f6f8fa'], [1.5, 2.55, '#1b1f24'], [1.78 - mv * 0.6, 2.6, '#1b1f24']]) {
            const c = iso(gx + px, gy + py, 7); ctx.fillStyle = col; ctx.fillRect(c[0] - 1.2, c[1] - 4, 2.4, 4); ctx.beginPath(); ctx.arc(c[0], c[1] - 4.5, 1.4, 0, 7); ctx.fill(); } }
        // mesa de cartas
        stool(gx + 2.8, gy + 1.45, f); stool(gx + 2.8, gy + 2.6, f);
        box(gx + 2.5, gy + 1.75, 0.6, 0.55, 7, '#1f6f4f', 0, f);
        for (let k = 0; k < 4; k++) { const c = iso(gx + 2.62 + k * 0.1, gy + 1.95 + (k % 2) * 0.12, 7.2); ctx.fillStyle = k === 3 ? '#d1242f' : '#f6f8fa'; ctx.fillRect(c[0] - 1.6, c[1] - 1.2, 3.2, 2.4); }
        // planta
        box(gx + 3.05, gy + 0.25, 0.3, 0.3, 5, '#8a5a2b', 0, f);
        ctx.fillStyle = shade('#2ea043', f); { const p = iso(gx + 3.2, gy + 0.4, 12); ctx.beginPath(); ctx.ellipse(p[0], p[1], 7, 6, 0, 0, 7); ctx.fill(); }
        break;
      }
      default: break;
    }
  }

  // placa com o nome da sala, na parede do fundo (texto inclinado no plano da parede)
  function drawSign(gx, gy, text, hot, L) {
    const ux = TW / 2, uy = TH / 2, len = Math.hypot(ux, uy);
    const c = iso(gx + S / 2, gy, WALL - 5);
    ctx.save();
    ctx.transform(ux / len, uy / len, 0, 1, c[0], c[1]);
    const maxW = S * len - 12;
    let size = 11, lines = [text];
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    while (ctx.measureText(text).width > maxW && size > 8.5) { size -= 0.5; ctx.font = `700 ${size}px system-ui, sans-serif`; }
    if (ctx.measureText(text).width > maxW) {
      const words = text.split(' '); let best = 1, diff = 1e9;
      for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '); const d = Math.abs(a.length - b.length); if (d < diff) { diff = d; best = k; } }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
      size = 8.5; ctx.font = `700 ${size}px system-ui, sans-serif`;
    }
    const w = Math.min(maxW + 8, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12);
    const h = lines.length * (size + 2) + 5;
    ctx.fillStyle = hot ? 'rgba(240,136,62,.95)' : `rgba(13,17,23,${0.55 + 0.3 * Math.min(1, L)})`;
    roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(255,255,255,.6)' : 'rgba(201,209,217,.25)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = hot ? '#fff' : '#e6edf3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, k) => ctx.fillText(l, 0, (k - (lines.length - 1) / 2) * (size + 2) + 0.5));
    ctx.restore();
  }
  function checker(x, y, n, sz, z, a, b, f) {
    const c = sz / n;
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      const x0 = x + q * c, y0 = y + r * c;
      poly([iso(x0, y0, z), iso(x0 + c, y0, z), iso(x0 + c, y0 + c, z), iso(x0, y0 + c, z)], shade((r + q) % 2 ? a : b, f));
    }
  }
  const stool = (x, y, f, col = '#6e4b2a') => box(x - 0.15, y - 0.15, 0.3, 0.3, 4, col, 0, f);

  // ================================================================ agentes
  const sprites = new Map(); // id -> boneco animado
  const particles = [];
  let agentList = [];

  // 3 estações por sala de trabalho; quem passar disso trabalha em pé
  const WORKSTATIONS = [
    { desk: [1.3, 0.8, 1.1], seat: [1.85, 1.95] },
    { desk: [0.2, 0.8, 0.95], seat: [0.7, 1.95] },
    { desk: [2.15, 2.25, 1.1], seat: [2.7, 3.25] },
  ];
  const SLOTS = [...WORKSTATIONS.map((w) => w.seat), [3.1, 1.0], [1.4, 3.2], [0.5, 3.1]];
  // Sala de Jogos: ping-pong, videogame, dardos e café
  const GAME_SLOTS = [
    { p: [0.15, 2.5], pose: 'play', dir: 1 }, { p: [2.15, 2.5], pose: 'play', dir: -1 },
    { p: [2.1, 1.2], pose: 'videogame', dir: 1, away: true }, { p: [2.85, 1.2], pose: 'videogame', dir: -1, away: true },
    { p: [1.15, 0.95], pose: 'darts', dir: -1, away: true },
    { p: [3.0, 3.05], pose: 'coffee', dir: -1 }, { p: [2.4, 3.2], pose: 'coffee', dir: 1 },
  ];
  // Sala de Espera (Entrada): xadrez, cartas e cadeiras com celular ou revista
  const WAIT_SLOTS = [
    { p: [1.6, 1.8], pose: 'chess', dir: 1 }, { p: [1.6, 2.95], pose: 'chess', dir: -1, away: true },
    { p: [2.8, 1.45], pose: 'cards', dir: 1 }, { p: [2.8, 2.6], pose: 'cards', dir: -1, away: true },
    { p: [0.38, 0.7], pose: 'phone', dir: 1 }, { p: [0.38, 1.3], pose: 'magazine', dir: 1 }, { p: [0.38, 1.9], pose: 'phone', dir: 1 },
    { p: [0.38, 2.5], pose: 'magazine', dir: 1 }, { p: [0.38, 3.1], pose: 'phone', dir: 1 },
  ];
  // Pré-visualização opcional pela URL: ?pausa=10 (segundos até ir para a Sala de Jogos) e ?hora=23 (hora local, UTC-4)
  const QS = new URLSearchParams(location.search);
  const IDLE_TO_GAMES_MS = QS.has('pausa') ? Math.max(1, Number(QS.get('pausa')) || 180) * 1000 : 3 * 60e3;
  // Ociosos ficam na Sala de Espera. Depois de um tempo, eles se revezam: metade vai para a Sala de Jogos
  // (troca a cada 10 min), respeitando as vagas de cada sala.
  const TURN_MS = QS.has('pausa') ? IDLE_TO_GAMES_MS * 3 : 10 * 60e3;
  function assignRooms() {
    const idle = [];
    for (const a of agentList) {
      const s = sprites.get(a.id); if (!s) continue;
      s.assigned = a.room;
      if (a.status === 'ocioso' && s.idleSince && Date.now() - s.idleSince >= IDLE_TO_GAMES_MS) idle.push([a, s]);
    }
    idle.sort((p, q) => (hash(p[0].id + 'x') % 997) - (hash(q[0].id + 'x') % 997) || (p[0].id < q[0].id ? -1 : 1));
    const turn = Math.floor(Date.now() / TURN_MS);
    let games = 0;
    idle.forEach(([, s], i) => {
      if ((i + turn) % 2 === 0 && games < GAME_SLOTS.length) { s.assigned = 'Sala de Jogos'; games++; }
    });
  }
  const effRoom = (a, s) => (s && s.assigned) || a.room;
  function slotFor(a, list) {
    const room = effRoom(a, sprites.get(a.id));
    const same = list.filter((x) => effRoom(x, sprites.get(x.id)) === room);
    const k = Math.max(0, same.findIndex((x) => x.id === a.id));
    const game = room === 'Sala de Jogos' && a.status === 'ocioso';
    const o = roomOrigin(roomIdx(room));
    const list2 = game ? GAME_SLOTS : room === 'Entrada' ? WAIT_SLOTS : null;
    if (list2) { const sl = list2[k % list2.length]; return { x: o.gx + sl.p[0], y: o.gy + sl.p[1], k, room, game, leisure: sl }; }
    const sl = SLOTS[k % SLOTS.length];
    return { x: o.gx + sl[0], y: o.gy + sl[1], k, room, game, leisure: null };
  }
  const door = () => { const o = roomOrigin(roomIdx('Entrada')); return { x: o.gx + 1.75, y: o.gy + 0.2 }; };

  // ---------------------------------------------------------------- corredores
  // Cada sala tem a porta no lado direito; corredores verticais em x = col*5+4.25 e horizontais em y = linha*5+4.25.
  function roomAtPoint(x, y) {
    for (let i = 0; i < ROOMS.length; i++) { const o = roomOrigin(i); if (x >= o.gx - 0.05 && x <= o.gx + S + 0.05 && y >= o.gy - 0.05 && y <= o.gy + S + 0.05) return i; }
    return -1;
  }
  function route(fx, fy, tx, ty) {
    const A = roomAtPoint(fx, fy), B = roomAtPoint(tx, ty);
    if (A === B && A >= 0) return [[tx, ty]];
    const pts = [];
    let vx;
    if (A >= 0) { const o = roomOrigin(A); pts.push([o.gx + S - 0.3, o.gy + 1.75], [o.gx + 4.25, o.gy + 1.75]); vx = o.gx + 4.25; }
    else { vx = Math.min(24.25, Math.max(4.25, Math.round((fx - 4.25) / 5) * 5 + 4.25)); pts.push([vx, fy]); }
    if (B >= 0) {
      const o = roomOrigin(B), hy = o.gy + 4.25, bvx = o.gx + 4.25;
      pts.push([vx, hy], [bvx, hy], [bvx, o.gy + 1.75], [o.gx + S - 0.3, o.gy + 1.75]);
    }
    pts.push([tx, ty]);
    return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
  }
  function goTo(s, x, y) {
    if (s.goalX !== undefined && Math.abs(s.goalX - x) < 0.01 && Math.abs(s.goalY - y) < 0.01) return;
    s.goalX = x; s.goalY = y;
    if (reduced) { s.x = x; s.y = y; s.path = []; return; }
    s.path = route(s.x, s.y, x, y);
  }

  function styleFor(s, a) {
    const st = STYLE[a.role];
    if (st) { s.shirt = st[0]; s.acc = st[1]; }
    else if (!s.shirt) { s.shirt = '#8b949e'; s.acc = 'nenhum'; } // Recepção / Aguardando você mantêm a roupa anterior
  }

  function poof(x, y) {
    if (reduced) return;
    const [sx, sy] = iso(x, y);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      particles.push({ kind: 'poof', x: sx, y: sy - 18, vx: Math.cos(a) * 30, vy: Math.sin(a) * 18, life: 0.7, max: 0.7, r: 4 });
    }
  }
  function confetti(x, y) {
    if (reduced) return;
    const [sx, sy] = iso(x, y);
    const cols = ['#3fb950', '#e3b341', '#4f8cff', '#f778ba', '#ff7b72', '#a371f7'];
    for (let k = 0; k < 26; k++) {
      particles.push({ kind: 'conf', x: sx, y: sy - 40, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 90,
        life: 1.6, max: 1.6, c: cols[k % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
    }
  }

  function setAgents(list) {
    agentList = list;
    const ids = new Set(list.map((a) => a.id));
    const ent = roomOrigin(roomIdx('Entrada'));
    const now = performance.now() / 1000;
    for (const a of list) {
      let s = sprites.get(a.id);
      if (!s) {
        const parent = a.parent && sprites.get(a.parent);
        const h = hash(a.id);
        s = { x: parent ? parent.x : ent.gx + 1.75, y: parent ? parent.y : ent.gy + 0.25, path: [], alpha: reduced ? 1 : 0, dir: 1, away: false,
          phase: 0, skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 3) % HAIR.length], idColor: ID_COLORS[(h >> 5) % ID_COLORS.length],
          jump: 0, say: null, sayT: 0, lastAction: null, lastStatus: null };
        sprites.set(a.id, s);
        if (a.kind === 'sub') poof(s.x, s.y);
      }
      styleFor(s, a);
      if (s.lastStatus && s.lastStatus !== 'concluido' && a.status === 'concluido') { s.jump = 0.9; confetti(s.x, s.y); }
      if (a.action && a.action !== s.lastAction && (a.status === 'trabalhando' || a.status === 'delegando')) { s.say = a.action; s.sayT = now; }
      if (a.status === 'ocioso') { if (s.lastStatus !== 'ocioso' || !s.idleSince) s.idleSince = Math.min(Date.now(), a.since || Date.now()); }
      else s.idleSince = 0;
      s.lastAction = a.action; s.lastStatus = a.status;
      Object.assign(s, { data: a, leaving: false });
    }
    relayout();
    for (const [id, s] of sprites) if (!ids.has(id) && !s.leaving) {
      s.leaving = true; s.leaveAt = now;
      if (s.data && s.data.kind === 'sub') { const d = door(); goTo(s, d.x, d.y); } // sai andando pela porta
    }
    renderAgents();
  }
  let lastAssign = '';
  function relayout() {
    assignRooms();
    const sig = agentList.map((a) => a.id + '=' + ((sprites.get(a.id) || {}).assigned || '')).join('|');
    if (sig !== lastAssign) { lastAssign = sig; if (typeof renderAgents === 'function') setTimeout(renderAgents, 0); }
    for (const a of agentList) {
      const s = sprites.get(a.id); if (!s) continue;
      const tgt = slotFor(a, agentList); s.k = tgt.k; s.game = tgt.game; s.effRoom = tgt.room; s.leisure = tgt.leisure;
      goTo(s, tgt.x, tgt.y);
    }
  }

  // ---------------------------------------------------------------- o boneco
  const hd0 = (hands, dir) => hands[dir > 0 ? 1 : 0];
  function drawPerson(s, sx, sy, t, pose) {
    const a = s.data;
    const dir = s.dir;
    const jumpY = s.jump > 0 ? Math.sin((1 - s.jump / 0.9) * Math.PI) * 14 : 0;
    const sit = SITTING.has(pose);
    const hipY = sy - (sit ? 6 : 9) - jumpY;
    const top = hipY - 14;
    const headY = top - 6;
    const swing = pose === 'walk' && !reduced ? Math.sin(s.phase) : 0;

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, sy, 9, 4.5, 0, 0, 7); ctx.fill();

    // pernas
    ctx.strokeStyle = '#2d333b'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sx + side * 3, hipY);
      if (sit) ctx.lineTo(sx + side * 3, hipY + 5);
      else ctx.lineTo(sx + side * 3 + swing * side * 4, sy - 1 - jumpY);
      ctx.stroke();
    }
    // corpo
    ctx.fillStyle = s.shirt; roundRect(sx - 6.5, top, 13, 15, 5); ctx.fill();
    if (s.acc === 'gravata') { ctx.fillStyle = a.role === 'CEO / Estrategista' ? '#e3b341' : '#b62324'; poly([[sx - 1.5, top + 1], [sx + 1.5, top + 1], [sx + 2, top + 9], [sx, top + 11], [sx - 2, top + 9]], ctx.fillStyle); }

    // braços
    const shoulderY = top + 3;
    ctx.strokeStyle = s.shirt; ctx.lineWidth = 3;
    const hand = (side) => {
      if (pose === 'wave' && side === dir) return [sx + side * 9, top - 9 + Math.sin(t * 10) * 3];
      if (pose === 'play' && side === dir) return [sx + side * 9, top + 4 + (reduced ? 0 : Math.sin(t * 4.4 + (dir > 0 ? 0 : Math.PI)) * 4)];
      if (pose === 'coffee' && side === dir) return [sx + side * 6, top + 5];
      if (pose === 'chess') { const turn = !reduced && ((t + (s.k || 0) * 3) % 6) < 0.8; return side === dir && turn ? [sx + dir * 10, top + 10] : [sx + side * 4, top + 9]; }
      if (pose === 'cards') return [sx + side * 3, top + 7];
      if (pose === 'phone') return [sx + side * 2, top + 6 + (reduced ? 0 : Math.sin(t * 9 + side) * 0.5)];
      if (pose === 'magazine') return [sx + side * 5, top + 6];
      if (pose === 'videogame') return [sx + side * 2.5, top + 8 + (reduced ? 0 : Math.sin(t * 18 + side * 2) * 1)];
      if (pose === 'darts' && side === dir) {
        const c = reduced ? 2 : (t + (s.k || 0)) % 2.6;
        if (c < 0.35) return [sx + dir * 1, top - 6];
        if (c < 0.6) return [sx + dir * 11, top - 3];
        return [sx + dir * 7, shoulderY + 6];
      }
      if (pose === 'sit' || pose === 'type') { const tap = reduced ? 0 : Math.sin(t * 22 + side * 1.7) * 1.3; return [sx + side * 4, top + 8 + tap]; }
      return [sx + side * 7 - swing * side * 3, shoulderY + 9];
    };
    const hands = [];
    for (const side of [-1, 1]) {
      const h = hand(side); hands.push(h);
      ctx.beginPath(); ctx.moveTo(sx + side * 5.5, shoulderY); ctx.lineTo(h[0], h[1]); ctx.stroke();
    }
    // objetos nas mãos
    const mid = [(hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2];
    if (!sit && !LEISURE.has(pose) && (pose === 'type' || s.acc === 'tablet' || s.acc === 'caderno' || s.acc === 'prancheta') && pose !== 'wave' && !s.away) {
      const col = s.acc === 'caderno' ? '#f6f8fa' : s.acc === 'prancheta' ? '#b08a5a' : '#161b22';
      ctx.fillStyle = col; roundRect(mid[0] - 5, mid[1] - 3, 10, 7, 1.5); ctx.fill();
      if (s.acc === 'tablet') { ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mid[0] - 3, mid[1] + 2); ctx.lineTo(mid[0], mid[1]); ctx.lineTo(mid[0] + 3, mid[1] - 1); ctx.stroke(); }
      if (s.acc === 'caderno') { ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 0.8; for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.moveTo(mid[0] - 3, mid[1] - 1 + k * 2.5); ctx.lineTo(mid[0] + 3, mid[1] - 1 + k * 2.5); ctx.stroke(); } }
    }
    for (const h of hands) { ctx.fillStyle = s.skin; ctx.beginPath(); ctx.arc(h[0], h[1], 1.8, 0, 7); ctx.fill(); }
    const hd = hands[dir > 0 ? 1 : 0];
    if (pose === 'play') { ctx.fillStyle = '#d1242f'; ctx.beginPath(); ctx.ellipse(hd[0] + dir * 3, hd[1] - 2, 3.2, 4, 0, 0, 7); ctx.fill(); }
    if (pose === 'cards' && !s.away) { for (let k = -1; k <= 1; k++) { ctx.save(); ctx.translate(mid[0], mid[1] - 2); ctx.rotate(k * 0.35); ctx.fillStyle = k ? '#f6f8fa' : '#ffdcd7'; ctx.fillRect(-2, -6, 4, 6); ctx.restore(); } }
    if (pose === 'phone' && !s.away) { ctx.fillStyle = '#161b22'; roundRect(mid[0] - 2.5, mid[1] - 4.5, 5, 7, 1); ctx.fill(); ctx.fillStyle = '#58a6ff'; ctx.fillRect(mid[0] - 1.7, mid[1] - 3.7, 3.4, 5.2); }
    if (pose === 'magazine' && !s.away) { ctx.fillStyle = '#f778ba'; ctx.fillRect(mid[0] - 6, mid[1] - 5, 6, 8); ctx.fillStyle = '#f6f8fa'; ctx.fillRect(mid[0], mid[1] - 5, 6, 8); ctx.fillStyle = '#8b949e'; ctx.fillRect(mid[0] + 1, mid[1] - 3, 4, 0.8); ctx.fillRect(mid[0] + 1, mid[1] - 1, 4, 0.8); }
    if (pose === 'videogame') { ctx.fillStyle = '#21262d'; roundRect(mid[0] - 4, mid[1] - 2, 8, 4, 2); ctx.fill(); }
    if (pose === 'darts') { const c = reduced ? 2 : (t + (s.k || 0)) % 2.6; if (c >= 0.6 && c < 1.0) { const k2 = (c - 0.6) / 0.4; ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hd0(hands, dir)[0] + dir * (2 + k2 * 18), hd0(hands, dir)[1] - k2 * 10); ctx.lineTo(hd0(hands, dir)[0] + dir * (6 + k2 * 18), hd0(hands, dir)[1] - 2 - k2 * 10); ctx.stroke(); } }
    if (pose === 'coffee') {
      ctx.fillStyle = '#f6f8fa'; roundRect(hd[0] - 2.5, hd[1] - 5, 5, 6, 1); ctx.fill();
      if (!reduced) { ctx.strokeStyle = 'rgba(230,237,243,.55)'; ctx.lineWidth = 1; for (let k = 0; k < 2; k++) { const o = Math.sin(t * 3 + k * 2) * 1.5; ctx.beginPath(); ctx.moveTo(hd[0] - 1 + k * 2, hd[1] - 6); ctx.quadraticCurveTo(hd[0] + o, hd[1] - 9, hd[0] - 1 + k * 2, hd[1] - 12); ctx.stroke(); } }
    }

    // cabeça
    ctx.fillStyle = s.skin; ctx.beginPath(); ctx.arc(sx, headY, 6.5, 0, 7); ctx.fill();
    ctx.fillStyle = s.hair;
    if (s.away) { ctx.beginPath(); ctx.arc(sx, headY, 6.6, 0, 7); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(sx, headY - 1, 6.6, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); }
    if (!s.away) {
      ctx.fillStyle = '#1b1f24';
      const ex = sx + dir * 1.5;
      if (pose === 'idle' && !reduced && Math.sin(t * 0.9 + hash(a.id)) > 0.97) { ctx.fillRect(ex - 3.5, headY, 2, 0.8); ctx.fillRect(ex + 1.5, headY, 2, 0.8); }
      else { ctx.beginPath(); ctx.arc(ex - 2.5, headY + 0.5, 0.9, 0, 7); ctx.arc(ex + 2.5, headY + 0.5, 0.9, 0, 7); ctx.fill(); }
      if (s.acc === 'oculos') { ctx.strokeStyle = '#1b1f24'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(ex - 2.5, headY + 0.5, 2, 0, 7); ctx.moveTo(ex + 4.5, headY + 0.5); ctx.arc(ex + 2.5, headY + 0.5, 2, 0, 7); ctx.stroke(); }
    }
    if (s.acc === 'fone' || s.acc === 'headset') {
      ctx.strokeStyle = '#1b1f24'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, headY, 7.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.fillStyle = s.acc === 'fone' ? '#f0883e' : '#1b1f24';
      roundRect(sx - 8.5, headY - 1, 3, 5, 1); ctx.fill(); roundRect(sx + 5.5, headY - 1, 3, 5, 1); ctx.fill();
      if (s.acc === 'headset' && !s.away) { ctx.strokeStyle = '#1b1f24'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + 7 * dir, headY + 3); ctx.quadraticCurveTo(sx + 6 * dir, headY + 7, sx + 2 * dir, headY + 6); ctx.stroke(); }
    }
    return headY;
  }

  function drawStatusIcon(s, sx, by, t) {
    const a = s.data;
    const col = (STAT[a.status] || STAT.ocioso)[0];
    if (a.status === 'aguardando') {
      const k = 1 + 0.15 * Math.sin(t * 8);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, by, 10 * k, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', sx, by + 5);
    } else if (a.status === 'concluido') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, by, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(sx - 4.5, by); ctx.lineTo(sx - 1, by + 3.5); ctx.lineTo(sx + 4.5, by - 3.5); ctx.stroke();
    } else if (a.status === 'ocioso') {
      ctx.fillStyle = col; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
      const m = reduced ? 0 : (t * 8) % 6;
      ctx.fillText('z', sx + 6, by + 6 - m); ctx.fillText('Z', sx + 12, by - 2 - ((m + 3) % 6));
    } else {
      ctx.fillStyle = col; roundRect(sx - 15, by - 8, 30, 16, 8); ctx.fill();
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = s.alpha * ((Math.floor(t * 4) % 3) === k || reduced ? 1 : 0.45);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx - 7 + k * 7, by, 2.3, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = s.alpha;
    }
  }

  function drawSay(s, sx, by, t) {
    const age = t - s.sayT;
    if (!s.say || age > 2.8) return false;
    const fade = Math.min(1, age / 0.2, (2.8 - age) / 0.4);
    ctx.save(); ctx.globalAlpha = s.alpha * fade;
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    const txt = s.say.length > 26 ? s.say.slice(0, 25) + '…' : s.say;
    const w = ctx.measureText(txt).width + 14, y = by - 4 - (reduced ? 0 : (1 - fade) * 4);
    ctx.fillStyle = '#f6f8fa'; roundRect(sx - w / 2, y - 12, w, 18, 8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - 4, y + 6); ctx.lineTo(sx, y + 11); ctx.lineTo(sx + 4, y + 6); ctx.fill();
    ctx.fillStyle = '#1b1f24'; ctx.fillText(txt, sx, y + 1);
    ctx.restore();
    return true;
  }

  function drawAgent(s, t) {
    if (s.alpha <= 0.01 || !s.data) return;
    const a = s.data;
    const [sx, sy0] = iso(s.x, s.y);
    const moving = s.path && s.path.length > 0;
    const busy = a.status === 'trabalhando' || a.status === 'delegando';
    const atDesk = !moving && s.k < WORKSTATIONS.length && busy && !s.leisure && a.room !== 'Entrada' && a.room !== 'Sua mesa / Aprovações' && a.room !== 'Sala de Jogos';
    let pose = 'idle';
    if (moving) pose = 'walk';
    else if (a.status === 'aguardando') pose = 'wave';
    else if (atDesk) pose = 'sit';
    else if (busy) pose = 'type';
    else if (s.leisure && (a.status === 'ocioso' || a.room === 'Entrada')) pose = s.leisure.pose;
    s.away = moving ? s.awayWalk : atDesk;
    if (!moving && LEISURE.has(pose)) { s.dir = s.leisure.dir; s.away = !!s.leisure.away; }
    const bob = pose === 'idle' && !reduced ? Math.sin(t * 2 + hash(a.id)) * 0.6 : 0;
    const sy = sy0 + bob;

    ctx.globalAlpha = s.alpha;
    const headY = drawPerson(s, sx, sy, t, pose);
    const by = headY - 18;
    if (!drawSay(s, sx, by, t) && !LEISURE.has(pose)) drawStatusIcon(s, sx, by, t);

    // nome
    const role = s.game && !moving ? 'Na pausa' : a.role;
    const label = role ? (role.length > 18 ? role.slice(0, 17) + '…' : role) : a.name;
    const leisure = !moving && LEISURE.has(pose);
    if (leisure) { ctx.globalAlpha = 1; return; }   // descansando: sem nome (aparece na lista e no cartão da sala)
    const ly = sy0 + 15 + ((s.k || 0) % 3) * 12;
    ctx.font = leisure ? '600 9px system-ui' : '600 11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = '#fff';
    ctx.strokeText(label, sx, ly); ctx.fillText(label, sx, ly);
    ctx.globalAlpha = 1;
  }

  function bezier(p0, p1, p2, u) {
    const v = 1 - u;
    return [v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0], v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1]];
  }
  function drawLinks(t) {
    for (const s of sprites.values()) {
      const a = s.data; if (!a || !a.parent || s.alpha < 0.1 || s.leaving) continue;
      const p = sprites.get(a.parent); if (!p || !p.data || p.data.status !== 'delegando') continue;
      const [x1, y1] = iso(p.x, p.y), [x2, y2] = iso(s.x, s.y);
      const P0 = [x1, y1 - 24], P1 = [(x1 + x2) / 2, Math.min(y1, y2) - 75], P2 = [x2, y2 - 24];
      ctx.save(); ctx.strokeStyle = 'rgba(163,113,247,.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = reduced ? 0 : -t * 30;
      ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.quadraticCurveTo(P1[0], P1[1], P2[0], P2[1]); ctx.stroke(); ctx.restore();
      // pacotes de trabalho viajando
      for (let k = 0; k < 3; k++) {
        const u = reduced ? (k + 1) / 4 : ((t * 0.45 + k / 3) % 1);
        const q = bezier(P0, P1, P2, u);
        ctx.fillStyle = '#d2a8ff'; ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(reduced ? 0 : t * 3 + k);
        ctx.fillRect(-3, -3, 6, 6); ctx.restore();
      }
    }
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
      const k = p.life / p.max;
      if (p.kind === 'poof') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt;
        ctx.fillStyle = `rgba(201,209,217,${0.55 * k})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else {
        p.vy += 220 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-2.5, -1.5, 5, 3); ctx.restore();
      }
    }
  }

  // ================================================================ laço de animação
  let last = performance.now() / 1000, lastRelayout = 0, lastSky = 0, sk = null;
  function frame() {
    const t = performance.now() / 1000, dt = Math.max(0, Math.min(0.05, t - last)); last = t;

    if (t - lastRelayout > 2) { lastRelayout = t; relayout(); }
    for (const [id, s] of sprites) {
      let budget = 4.2 * dt;
      while (s.path && s.path.length && budget > 0) {
        const [px, py] = s.path[0];
        const dx = px - s.x, dy = py - s.y, d = Math.hypot(dx, dy);
        if (d <= budget) { s.x = px; s.y = py; budget -= d; s.path.shift(); continue; }
        s.x += (dx / d) * budget; s.y += (dy / d) * budget; budget = 0;
        const sdx = dx - dy, sdy = dx + dy;          // direção na tela
        if (Math.abs(sdx) > 0.01) s.dir = sdx > 0 ? 1 : -1;
        s.awayWalk = sdy < 0;
      }
      if (s.path && s.path.length) s.phase += dt * 11;
      if (s.jump > 0) s.jump = Math.max(0, s.jump - dt);
      if (s.leaving) {
        const arrived = !(s.path && s.path.length) || !(s.data && s.data.kind === 'sub');
        if (arrived || t - s.leaveAt > 6) { s.alpha -= dt * 1.5; if (s.alpha <= 0) { sprites.delete(id); continue; } }
      } else s.alpha = Math.min(1, s.alpha + dt * 2.5);
    }

    // luz das salas
    const busyRooms = new Set(), litRooms = new Set(), busySeats = new Map();
    for (const a of agentList) {
      const s = sprites.get(a.id);
      if (a.status !== 'ocioso') busyRooms.add(roomIdx(a.room));
      if (s && s.game) busyRooms.add(roomIdx('Sala de Jogos'));
      if (a.status === 'trabalhando' || a.status === 'delegando') { const r = roomIdx(a.room); litRooms.add(r); busySeats.set(r, (busySeats.get(r) || 0) + 1); }
    }
    for (let i = 0; i < ROOMS.length; i++) {
      const target = busyRooms.has(i) ? 1.08 : 0.78;
      light[i] = reduced ? target : lerp(light[i], target, Math.min(1, dt * 3));
    }

    if (t - lastSky > 30 || !sk) { lastSky = t; sk = sky(); }
    const night = 1 - sk.day;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const k = scale * view.z;
    ctx.setTransform(k, 0, 0, k, offX + view.x, offY + view.y);
    drawSky(t, sk);
    drawFloor();
    const waiting = agentList.some((a) => a.status === 'aguardando');
    const hotIdx = waiting ? roomIdx('Sua mesa / Aprovações') : -1;
    for (let i = 0; i < ROOMS.length; i++) drawRoom(i, t, { hot: i === hotIdx, lit: litRooms.has(i), busySeats: busySeats.get(i) || 0, waiting: waiting && i === hotIdx });
    if (night > 0.02) { ctx.fillStyle = `rgba(6,12,40,${0.32 * night})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000); }
    for (let i = 0; i < ROOMS.length; i++) drawGlow(i, night);
    drawLinks(t);
    [...sprites.values()].sort((a, b) => a.x + a.y - (b.x + b.y)).forEach((s) => drawAgent(s, t));
    drawParticles(dt);
    drawUsageBoard();
    // relógio local UTC-4 (fixo na tela)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.font = `600 ${12 * dpr}px system-ui`; ctx.textAlign = 'left';
    const txt = `${sk.txt} · ${sk.label} (UTC-4)`;
    const w = ctx.measureText(txt).width + 16 * dpr;
    ctx.fillStyle = 'rgba(13,17,23,.75)'; roundRect(10 * dpr, 10 * dpr, w, 22 * dpr, 11 * dpr); ctx.fill();
    ctx.fillStyle = '#c9d1d9'; ctx.fillText(txt, 18 * dpr, 25 * dpr);
    requestAnimationFrame(frame);
  }

  // ================================================================ zoom, arrastar e tocar numa sala
  const view = { z: 1, x: 0, y: 0 };
  const pointers = new Map();
  let gesture = null;
  const devPoint = (e) => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
  function zoomAt(px, py, factor) {
    const k = scale * view.z, bx = offX + view.x, by = offY + view.y;
    const lx = (px - bx) / k, ly = (py - by) / k;
    view.z = Math.min(3.5, Math.max(1, view.z * factor));
    const k2 = scale * view.z;
    view.x = px - lx * k2 - offX; view.y = py - ly * k2 - offY;
    if (view.z === 1) { view.x = 0; view.y = 0; }
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, devPoint(e));
    if (pointers.size === 1) gesture = { start: devPoint(e), t: performance.now(), moved: false, vx: view.x, vy: view.y };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), z: view.z, moved: true }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, devPoint(e));
    if (pointers.size === 2 && gesture.pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (gesture.z * d / gesture.pinch) / view.z);
    } else if (pointers.size === 1 && gesture.start) {
      const p = devPoint(e), dx = p[0] - gesture.start[0], dy = p[1] - gesture.start[1];
      if (Math.hypot(dx, dy) > 8 * (window.devicePixelRatio || 1)) gesture.moved = true;
      if (gesture.moved && view.z > 1) { view.x = gesture.vx + dx; view.y = gesture.vy + dy; }
    }
  });
  const endPointer = (e) => {
    const g = gesture; pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (g && g.start && !g.moved && performance.now() - g.t < 400) tapAt(devPoint(e));
      gesture = null;
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); gesture = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = devPoint(e); zoomAt(p[0], p[1], e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  cv.addEventListener('dblclick', () => { view.z = 1; view.x = 0; view.y = 0; });

  function tapAt([px, py]) {
    const k = scale * view.z;
    const lx = (px - offX - view.x) / k, ly = (py - offY - view.y) / k;
    if (lx >= BOARD.x && lx <= BOARD.x + BOARD.w && ly >= BOARD.y && ly <= BOARD.y + BOARD.h) { openUsageCard(); return; }
    const a = (lx - OX) / (TW / 2), b = (ly - OY) / (TH / 2);
    const i = roomAtPoint((a + b) / 2, (b - a) / 2);
    if (i < 0) { closeCard(); return; }
    openCard(ROOMS[i]);
  }

  const card = document.getElementById('roomcard');
  function closeCard() { card.hidden = true; }
  function openUsageCard() {
    card.replaceChildren();
    const head = el('div', 'rc-head'); head.append(el('b', null, 'Uso do Claude'));
    const x = el('button', 'rc-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.addEventListener('click', closeCard); head.append(x);
    card.append(head);
    const u = USAGE;
    if (!u || !u.updated) { card.append(el('div', 'rc-empty', 'Sem dados ainda. O quadro usa a barra de status do Claude Code: rode o instalar.bat de novo no PC.')); card.hidden = false; return; }
    const usd = (v) => 'US$ ' + (v || 0).toFixed(2).replace('.', ',');
    card.append(el('div', 'rc-sub', 'Hoje (UTC-4)'));
    card.append(el('div', 'rc-row', `${fmtTok(u.today.input + u.today.output)} tokens — entrada ${fmtTok(u.today.input)}, saída ${fmtTok(u.today.output)}`));
    card.append(el('div', 'rc-row', `${u.sessions_today} sessão(ões) · custo estimado ${usd(u.today.cost)} (preço de API; no plano não é cobrado)`));
    card.append(el('div', 'rc-sub', 'Semana (desde segunda)'));
    card.append(el('div', 'rc-row', `${fmtTok(u.week.input + u.week.output)} tokens — entrada ${fmtTok(u.week.input)}, saída ${fmtTok(u.week.output)}`));
    card.append(el('div', 'rc-sub', 'Limites do plano'));
    for (const [label, l] of [['5 horas', u.five_hour], ['Semanal', u.seven_day]]) {
      card.append(el('div', 'rc-row', l ? `${label}: ${Math.round(l.used_percentage)}% usado · ${fmtReset(l.resets_at)}` : `${label}: sem dado ainda`));
    }
    card.append(el('div', 'rc-empty', 'A Anthropic não tem limite diário: os limites são a janela de 5 horas e a semanal.'));
    card.hidden = false;
  }
  async function openCard(room) {
    card.replaceChildren();
    const head = el('div', 'rc-head'); head.append(el('b', null, dispName(room)));
    const x = el('button', 'rc-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.addEventListener('click', closeCard); head.append(x);
    card.append(head);
    const now = agentList.filter((a) => effRoom(a, sprites.get(a.id)) === room);
    card.append(el('div', 'rc-sub', 'Agora'));
    if (!now.length) card.append(el('div', 'rc-empty', 'Ninguém nesta sala.'));
    for (const a of now) card.append(el('div', 'rc-row', `${a.role} ${a.tag || ''} — ${(STAT[a.status] || STAT.ocioso)[1]}`));
    card.append(el('div', 'rc-sub', 'Passaram hoje'));
    const list = el('div', 'rc-list', 'carregando…'); card.append(list);
    card.hidden = false;
    try {
      const r = await fetch('/history', { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/login'; return; }
      const all = await r.json();
      const today = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
      const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
      const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
      const groups = new Map();
      for (const v of all) {
        if (v.room !== room || fmtDay.format(new Date(v.t)) !== today) continue;
        const key = v.role + ' ' + v.tag;
        const g = groups.get(key) || { key, n: 0, first: v.t, last: v.t, sub: v.kind === 'sub' };
        g.n++; g.last = Math.max(g.last, v.t); g.first = Math.min(g.first, v.t); groups.set(key, g);
      }
      list.replaceChildren();
      if (!groups.size) list.append(el('div', 'rc-empty', 'Ninguém passou por aqui hoje.'));
      for (const g of [...groups.values()].sort((p, q) => q.last - p.last)) {
        list.append(el('div', 'rc-row', `${g.key}${g.sub ? ' (subagente)' : ''} — ${g.n}× · ${fmtTime.format(new Date(g.first))}${g.n > 1 ? '–' + fmtTime.format(new Date(g.last)) : ''}`));
      }
    } catch { list.textContent = 'Não foi possível carregar o histórico.'; }
  }

  // ================================================================ painel lateral (sem innerHTML com dados)
  const elAgents = document.getElementById('agents');
  const elLog = document.getElementById('log');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function renderAgents() {
    elAgents.replaceChildren();
    if (!agentList.length) { elAgents.append(el('div', 'empty', 'Nenhum agente ativo.')); return; }
    for (const a of agentList) {
      const [c, label] = STAT[a.status] || STAT.ocioso;
      const row = el('div', 'ag' + (a.status === 'aguardando' ? ' wait' : ''));
      const dot = el('div', 'dot'); dot.style.background = (sprites.get(a.id) || {}).shirt || c;
      const title = el('div'); title.append(el('b', null, a.role || a.name), el('span', 'room', ' ' + (a.tag || '')));
      const nm = el('div', 'nm'); nm.append(title, el('div', 'act', a.action || ''), el('div', 'room', dispName(effRoom(a, sprites.get(a.id))) + (a.kind === 'sub' ? ' · subagente' : '')));
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

  // ================================================================ tempo real
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
      USAGE = s.usage || null;
      setAgents(s.agents);
    });
    es.addEventListener('agents', (m) => setAgents(JSON.parse(m.data)));
    es.addEventListener('log', (m) => addLog(JSON.parse(m.data)));
    es.addEventListener('usage', (m) => { USAGE = JSON.parse(m.data); });
  }

  document.getElementById('demo').addEventListener('click', () => {
    fetch('/demo', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'agentes-office' } }).catch(() => {});
  });

  setTimeout(() => { const h = document.getElementById('hint'); if (h) h.classList.add('off'); }, 8000);
  cv.addEventListener('pointerdown', () => { const h = document.getElementById('hint'); if (h) h.classList.add('off'); }, { once: true });

  resize();
  connect();
  requestAnimationFrame(frame);
})();
