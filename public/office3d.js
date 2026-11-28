'use strict';
/*
 * Escritório de Agentes em 3D (WebGL, three.js).
 * Só desenha: quem decide sala, rota e pose é o app.js (a mesma lógica da versão 2D).
 * Coordenadas: x do mapa = x do mundo, y do mapa = z do mundo, altura = y. Cada sala tem 3,5 × 3,5.
 */
(function () {
  var T = window.THREE;
  function webglOK() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }
  window.Office3D = { supported: function () { return !!T && webglOK(); }, create: create, dress: dress };
  if (!T) return;

  // ================================================================ figurino dos personagens (estilo "roupa de trabalho")
  // Calça de trabalho, cinto, suspensório, botas, barba, cabelo e pele variados; mochila nos subagentes.
  // As peças ficam presas aos ossos e são desenhadas no espaço do personagem (pose de fábrica).
  var PANTS_W = ['#7a5230', '#8b6239', '#6b4a2e', '#5d6b45', '#55606e', '#7d6a4f'];
  var SKINS = ['#f2cfae', '#e0b08a', '#c68c63', '#a46a45', '#7d4e32', '#5e3a26'];
  var HAIRS = ['#2b1d14', '#4a3222', '#1b1b1b', '#7a4b26', '#b5874f', '#5b2b2b', '#3b2f2a'];
  var LEATHER = ['#5a3a22', '#6b4426', '#4a3020', '#7a5232'];
  var dressMats = {};
  function dmat(c, extra) {
    var k = c + (extra || '');
    return dressMats[k] || (dressMats[k] = new T.MeshLambertMaterial({ color: c, side: extra === 'dupla' ? T.DoubleSide : T.FrontSide }));
  }
  // ---- peças "costuradas" no corpo: cada ponto da peça é colado na superfície da roupa e herda os ossos
  // da pele mais próxima, então dobra junto quando o personagem anda, senta ou mexe os braços.
  var dressCache = {};
  function bodyData(meshes) {
    var key = meshes.map(function (m) { return m.geometry.uuid; }).join('|');
    if (dressCache[key]) return dressCache[key];
    var n = 0; meshes.forEach(function (m) { n += m.geometry.attributes.position.count; });
    var V = new Float32Array(n * 3), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), v = new T.Vector3(), o = 0;
    meshes.forEach(function (mesh) {
      var g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      mesh.updateMatrixWorld(true);
      for (var i = 0; i < pos.count; i++, o++) {
        // posição real na pose de fábrica: passa pelos ossos (nos arquivos comprimidos a escala fica no esqueleto)
        v.fromBufferAttribute(pos, i); mesh.boneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
        V[o * 3] = v.x; V[o * 3 + 1] = v.y; V[o * 3 + 2] = v.z;
        SI[o * 4] = si.getX(i); SI[o * 4 + 1] = si.getY(i); SI[o * 4 + 2] = si.getZ(i); SI[o * 4 + 3] = si.getW(i);
        SW[o * 4] = sw.getX(i); SW[o * 4 + 1] = sw.getY(i); SW[o * 4 + 2] = sw.getZ(i); SW[o * 4 + 3] = sw.getW(i);
      }
    });
    var D = { V: V, n: n, SI: SI, SW: SW, mesh: meshes[0], geos: {} };
    dressCache[key] = D;
    return D;
  }
  // frente (front = true: maior z) ou costas da superfície em (x, y)
  function surfZ(D, x, y, front, tol, minY) {
    var V = D.V, best = null;
    for (var t = tol || 0.012; t < 0.06 && best === null; t *= 1.6) {
      for (var i = 0; i < D.n; i++) {
        var vy = V[i * 3 + 1]; if (minY && vy < minY) continue;
        if (Math.abs(V[i * 3] - x) > t || Math.abs(vy - y) > t) continue;
        var vz = V[i * 3 + 2];
        if (best === null || (front ? vz > best : vz < best)) best = vz;
      }
    }
    return best === null ? 0 : best;
  }
  // topo do ombro em (x, z), procurando só na faixa do ombro (lo..hi)
  function topY(D, x, z, lo, hi) {
    var V = D.V, best = null;
    for (var t = 0.012; t < 0.05 && best === null; t *= 1.5) {
      for (var i = 0; i < D.n; i++) {
        if (Math.abs(V[i * 3] - x) > t || Math.abs(V[i * 3 + 2] - z) > t) continue;
        var vy = V[i * 3 + 1]; if (vy < lo || vy > hi) continue;
        if (best === null || vy > best) best = vy;
      }
    }
    return best === null ? lo + 0.02 : best;
  }
  function ringR(D, y, th, tol) {
    var V = D.V, best = 0, dx = Math.sin(th), dz = Math.cos(th);
    for (var i = 0; i < D.n; i++) {
      if (Math.abs(V[i * 3 + 1] - y) > (tol || 0.012)) continue;
      var x = V[i * 3], z = V[i * 3 + 2], r = Math.sqrt(x * x + z * z);
      if (r > 0.16 || r < 1e-4) continue;
      if ((x * dx + z * dz) / r < 0.97) continue;              // ~14° em volta da direção
      if (r > best) best = r;
    }
    return best || 0.08;
  }
  function nearest(D, x, y, z, minY, maxX) {
    var V = D.V, bi = 0, bd = 1e9;
    for (var i = 0; i < D.n; i++) {
      if (minY && V[i * 3 + 1] < minY) continue;
      if (maxX && Math.abs(V[i * 3]) > maxX) continue;
      var a = V[i * 3] - x, b = V[i * 3 + 1] - y, c = V[i * 3 + 2] - z, d = a * a + b * b + c * c; if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }
  /** Geometria com pele: pts em coordenadas do corpo; anchor (opcional) usa os ossos de um ponto só (peça rígida). */
  function skinnedGeo(D, pts, idx, anchor, minY, maxX) {
    var n = pts.length, P = new Float32Array(n * 3), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), v = new T.Vector3();
    var ai = anchor ? nearest(D, anchor[0], anchor[1], anchor[2]) : -1;
    var mesh = D.mesh, sk = mesh.skeleton, M = new T.Matrix4(), tmp = new T.Matrix4(), full = new T.Matrix4();
    for (var i = 0; i < n; i++) {
      var k = ai >= 0 ? ai : nearest(D, pts[i][0], pts[i][1], pts[i][2], minY, maxX);
      for (var c = 0; c < 4; c++) { SI[i * 4 + c] = D.SI[k * 4 + c]; SW[i * 4 + c] = D.SW[k * 4 + c]; }
      // inverso da pele: acha o ponto "cru" que, depois dos ossos, cai exatamente onde queremos
      for (var e = 0; e < 16; e++) M.elements[e] = 0;
      for (c = 0; c < 4; c++) {
        var w = SW[i * 4 + c]; if (!w) continue;
        var b = SI[i * 4 + c];
        tmp.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
        for (e = 0; e < 16; e++) M.elements[e] += w * tmp.elements[e];
      }
      full.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(M).multiply(mesh.bindMatrix).invert();
      v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(full);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(P, 3));
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(SW, 4));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // fita ao longo de um caminho (cada ponto com a direção "para fora")
  function ribbon(path, outs, w) {
    var pts = [], idx = [];
    for (var i = 0; i < path.length; i++) {
      var p = path[i], q = path[Math.min(path.length - 1, i + 1)], r = path[Math.max(0, i - 1)];
      var t = new T.Vector3(q[0] - r[0], q[1] - r[1], q[2] - r[2]).normalize(), o = new T.Vector3(outs[i][0], outs[i][1], outs[i][2]).normalize();
      var sd = new T.Vector3().crossVectors(t, o).normalize().multiplyScalar(w / 2);
      pts.push([p[0] + sd.x, p[1] + sd.y, p[2] + sd.z], [p[0] - sd.x, p[1] - sd.y, p[2] - sd.z]);
      if (i) { var a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    return { pts: pts, idx: idx };
  }
  function boxPts(cx, cy, cz, w, h, d) {
    var pts = [], idx = [], x = w / 2, y = h / 2, z = d / 2;
    [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].forEach(function (c) { pts.push([cx + c[0], cy + c[1], cz + c[2]]); });
    idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    return { pts: pts, idx: idx };
  }
  // as peças (geometria) são calculadas uma vez por modelo e reaproveitadas
  function piece(D, name, build) { return D.geos[name] || (D.geos[name] = build()); }
  // suaviza a profundidade ao longo da fita: envelope externo (nunca entra na camisa) + média
  function smoothOut(zs, front) {
    var n = zs.length, a = zs.slice(), k, r;
    for (r = 0; r < 2; r++) for (k = 0; k < n; k++) {
      var p = a[Math.max(0, k - 1)], q = a[Math.min(n - 1, k + 1)];
      zs[k] = front ? Math.max(p, a[k], q) : Math.min(p, a[k], q);
      if (r === 1) a = zs.slice();
    }
    for (k = 1; k + 1 < n; k++) a[k] = (zs[k - 1] + zs[k] * 2 + zs[k + 1]) / 4;
    return a;
  }
  function suspenderGeo(D, sd, hy) {
    var OFF = 0.008, path = [], outs = [], x0 = sd * 0.046, yt = 0.80 + hy, yb = 0.53, y, k;
    var fy = [], fz = [];
    for (y = yb; y <= yt + 1e-6; y += 0.02) { fy.push(y); fz.push(surfZ(D, x0, y, true, 0.018, 0.5)); }
    fz = smoothOut(fz, true);
    for (k = 0; k < fy.length; k++) { path.push([x0, fy[k], fz[k] + OFF]); outs.push([0, 0, 1]); }
    var zf = fz[fz.length - 1], zb = surfZ(D, sd * 0.042, yt, false, 0.018, 0.5);
    for (k = 1; k < 6; k++) { var z = zf + (zb - zf) * k / 6; path.push([sd * 0.044, Math.max(yt, topY(D, sd * 0.044, z, yt - 0.02, yt + 0.1)) + OFF, z]); outs.push([0, 1, 0]); }
    var by = [], bx = [], bz = [];
    for (y = yt; y >= yb - 1e-6; y -= 0.02) {
      var u = (yt - y) / (yt - yb), x = sd * 0.042 + (-sd * 0.03 - sd * 0.042) * u;
      by.push(y); bx.push(x); bz.push(surfZ(D, x, y, false, 0.018, 0.5));
    }
    bz = smoothOut(bz, false);
    for (k = 0; k < by.length; k++) { path.push([bx[k], by[k], bz[k] - OFF]); outs.push([0, 0, -1]); }
    var r = ribbon(path, outs, 0.017);
    return skinnedGeo(D, r.pts, r.idx, null, 0.56, 0.07);     // só o tronco: nem pernas nem braços
  }
  function beltGeo(D, y) {
    var pts = [], idx = [], N = 36;
    for (var i = 0; i <= N; i++) {
      var th = (i / N) * Math.PI * 2, r = ringR(D, y, th) + 0.007;
      pts.push([Math.sin(th) * r, y - 0.011, Math.cos(th) * r], [Math.sin(th) * r, y + 0.011, Math.cos(th) * r]);
      if (i) { var a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    return skinnedGeo(D, pts, idx);
  }
  function beardGeo(D, mustache) {
    var pts = [], idx = [], grid = {}, xs = [], ys = [], x, y;
    var x0 = mustache ? -0.022 : -0.052, x1 = -x0, y0 = mustache ? 0.958 : 0.932, y1 = mustache ? 0.968 : 0.978, st = mustache ? 0.011 : 0.0075;
    for (x = x0; x <= x1 + 1e-6; x += st) xs.push(x);
    for (y = y0; y <= y1 + 1e-6; y += st) ys.push(y);
    ys.forEach(function (yy, j) {
      xs.forEach(function (xx, i) {
        if (!mustache && yy > 0.952 && Math.abs(xx) < 0.022) return;          // boca livre
        if (!mustache && yy > 0.966 && Math.abs(xx) < 0.04) return;          // bochechas
        grid[i + ',' + j] = pts.length;
        pts.push([xx, yy, surfZ(D, xx, yy, true, 0.007, 0.92) + 0.004]);
      });
    });
    for (var j = 0; j + 1 < ys.length; j++) for (var i = 0; i + 1 < xs.length; i++) {
      var a = grid[i + ',' + j], b = grid[(i + 1) + ',' + j], c = grid[i + ',' + (j + 1)], d = grid[(i + 1) + ',' + (j + 1)];
      if (a != null && b != null && c != null && d != null) idx.push(a, b, c, b, d, c);
    }
    return skinnedGeo(D, pts, idx);
  }
  function wear(mesh, geo, mat) {
    var sk = new T.SkinnedMesh(geo, mat);
    sk.bind(mesh.skeleton, mesh.bindMatrix);
    sk.position.copy(mesh.position); sk.quaternion.copy(mesh.quaternion); sk.scale.copy(mesh.scale);
    sk.frustumCulled = false;
    mesh.parent.add(sk);
    return sk;
  }
  /**
   * ch: personagem clonado (já na escala), body: grupo pai sem escala; o: { h (número), shirt, female, sub, shadows }.
   * Pinta os materiais e prende as peças aos ossos.
   */
  function dress(ch, body, o) {
    var h = o.h || 0, female = !!o.female;
    var pick = function (arr, salt) { var v = Math.imul(h ^ (salt * 0x9e3779b1), 0x85ebca6b) >>> 0; v ^= v >>> 13; return arr[v % arr.length]; };
    var skin = pick(SKINS, 1), hair = o.hair || pick(HAIRS, 2);
    var pants = pick(PANTS_W, 3), boots = pick(LEATHER, 4);
    var shirt = new T.Color(o.shirt || '#8b949e').lerp(new T.Color('#7d786d'), 0.28).getStyle();
    ch.traverse(function (x) {
      if (!x.isMesh) return;
      var tm = function (m) {
        var c = /^(Shirt|Dress|Jacket)$/.test(m.name) ? shirt : /^LightJacket$/.test(m.name) ? '#d9d4c7'
          : /^Pants$/.test(m.name) ? pants : /^(Socks|Shoes)$/.test(m.name) ? boots
          : /^Skin$/.test(m.name) ? skin : /^(Hair|HairBase|Hair2|Eyebrows)$/.test(m.name) ? hair : null;
        if (!c) return m;
        var n = m.clone(); n.color.set(c); return n;
      };
      x.material = Array.isArray(x.material) ? x.material.map(tm) : tm(x.material);
    });
    // peças costuradas na roupa (pose de fábrica; o corpo precisa estar na origem)
    var all = []; ch.traverse(function (x) { if (x.isSkinnedMesh) all.push(x); });
    if (!all.length) return;
    body.updateMatrixWorld(true);
    // o corpo inteiro (pele, roupa, sapatos), menos olhos; a peça é convertida e presa no MESMO pedaço de referência
    var parts = all.filter(function (m) { var mt = Array.isArray(m.material) ? m.material[0] : m.material; return !/^Eyes$/.test(mt && mt.name); });
    var skm = (parts.length ? parts : all)[0];
    var D = bodyData(parts.length ? parts : all);
    var hy = female ? -0.034 : 0;      // as mulheres são um pouco mais baixas
    var metal = dmat('#c9b27a');
    // cinto com fivela, na cintura da calça
    wear(skm, piece(D, 'cinto', function () { return beltGeo(D, 0.488); }), dmat('#3a2a1e', 'dupla'));
    var zb = piece(D, 'zfivela', function () { return surfZ(D, 0, 0.488, true); });
    wear(skm, piece(D, 'fivela', function () { var b = boxPts(0, 0.488, zb + 0.008, 0.03, 0.024, 0.008); return skinnedGeo(D, b.pts, b.idx, [0, 0.488, zb]); }), metal);
    // suspensório (homens e metade das mulheres), em X nas costas
    if (!o.formal && (!female || h % 2)) {
      var sm = dmat(pick(['#b5652f', '#8a4b2a', '#6b4a2e', '#3f4a5a'], 5), 'dupla');
      [-1, 1].forEach(function (sd) {
        wear(skm, piece(D, 'susp' + sd, function () { return suspenderGeo(D, sd, hy); }), sm);
        var zc = piece(D, 'zclip' + sd, function () { return surfZ(D, sd * 0.046, 0.52, true, 0.018, 0.5); });
        wear(skm, piece(D, 'clip' + sd, function () { var b = boxPts(sd * 0.046, 0.52, zc + 0.012, 0.022, 0.014, 0.008); return skinnedGeo(D, b.pts, b.idx, [sd * 0.046, 0.52, zc], 0.5); }), metal);
      });
    }
    // mochila laranja nos subagentes, encostada nas costas
    if (o.sub) {
      var zk = piece(D, 'zmochila', function () { return surfZ(D, 0, 0.69 + hy, false); });
      wear(skm, piece(D, 'mochila', function () { var b = boxPts(0, 0.69 + hy, zk - 0.026, 0.1, 0.13, 0.05); return skinnedGeo(D, b.pts, b.idx, [0, 0.69 + hy, zk]); }), dmat('#d9692a'));
      wear(skm, piece(D, 'aba', function () { var b = boxPts(0, 0.742 + hy, zk - 0.028, 0.104, 0.035, 0.056); return skinnedGeo(D, b.pts, b.idx, [0, 0.69 + hy, zk]); }), dmat('#b8551f'));
    }
    // barba (60% dos homens) e bigode, colados no rosto
    if (!female && h % 5 < 3) {
      var bm = dmat(hair, 'dupla');
      wear(skm, piece(D, 'barba', function () { return beardGeo(D, false); }), bm);
      wear(skm, piece(D, 'bigode', function () { return beardGeo(D, true); }), bm);
    }
  }

  // ================================================================ utilidades
  var UNIT = new T.BoxGeometry(1, 1, 1);
  var geoCache = {};
  function cyl(rt, rb, h, seg) {
    var k = 'c' + rt + '_' + rb + '_' + h + '_' + (seg || 12);
    return geoCache[k] || (geoCache[k] = new T.CylinderGeometry(rt, rb, h, seg || 12));
  }
  function sph(r, ws, hs) {
    var k = 's' + r + '_' + (ws || 14);
    return geoCache[k] || (geoCache[k] = new T.SphereGeometry(r, ws || 14, hs || 10));
  }
  var matCache = {};
  function M(color, extra) {
    var k = color + (extra ? JSON.stringify(extra) : '');
    if (matCache[k]) return matCache[k];
    var o = { color: color };
    if (extra) for (var p in extra) o[p] = extra[p];
    return (matCache[k] = new T.MeshLambertMaterial(o));
  }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  var hash = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  // ================================================================ cena
  function create(o) {
    var cfg = o.cfg, S = cfg.S;
    var stage = o.stage;
    var ua = navigator.userAgent || '';
    var lowPower = o.lowPower || /TV|Tizen|Web0S|WebOS|SMART-TV|SmartTV|HbbTV|NetCast|BRAVIA|AFT/i.test(ua);
    var shadows = !lowPower;

    var renderer = new T.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75));
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    var cvs = renderer.domElement;
    cvs.id = 'cv3d';
    stage.insertBefore(cvs, stage.firstChild);

    var scene = new T.Scene();
    scene.background = new T.Color('#8fb8de');
    scene.fog = new T.Fog('#8fb8de', 45, 95);

    var camera = new T.PerspectiveCamera(42, 1, 0.1, 300);

    // luzes: céu + sol (muda com o horário UTC-4)
    var hemi = new T.HemisphereLight('#dfefff', '#5a5148', 0.85);
    scene.add(hemi);
    var sun = new T.DirectionalLight('#fff3dc', 0.9);
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(2048, 2048);
      var sc = sun.shadow.camera; sc.left = -18; sc.right = 18; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 90;
      sun.shadow.bias = -0.0006;
    }
    scene.add(sun); scene.add(sun.target);
    var CENTER = new T.Vector3(12, 0, 6.75);
    sun.target.position.copy(CENTER);

    // sol e lua no céu
    var sunBall = new T.Mesh(sph(1.6, 20, 14), new T.MeshBasicMaterial({ color: '#ffd27a', fog: false }));
    var moonBall = new T.Mesh(sph(1.1, 20, 14), new T.MeshBasicMaterial({ color: '#e6edf3', fog: false }));
    scene.add(sunBall); scene.add(moonBall);
    // estrelas
    var starGeo = new T.BufferGeometry(), sp = [];
    for (var si = 0; si < 260; si++) {
      var a = (si * 137.5) * Math.PI / 180, el = 0.25 + ((si * 53) % 100) / 160;
      sp.push(CENTER.x + Math.cos(a) * Math.cos(el) * 120, 20 + Math.sin(el) * 90, CENTER.z + Math.sin(a) * Math.cos(el) * 120);
    }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    var starMat = new T.PointsMaterial({ color: '#ffffff', size: 0.9, transparent: true, opacity: 0, fog: false });
    scene.add(new T.Points(starGeo, starMat));

    // ---------------------------------------------------------------- texturas
    var TEX = {
      tile: canvasTex(256, 256, function (c, w, h) {
        c.fillStyle = '#eceff2'; c.fillRect(0, 0, w, h);
        for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
          var v = 232 + ((i * 7 + j * 13) % 5) * 3;
          c.fillStyle = 'rgb(' + v + ',' + (v + 2) + ',' + (v + 4) + ')'; c.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
        }
        c.strokeStyle = '#c3c8ce'; c.lineWidth = 3;
        for (var k = 0; k <= 4; k++) { c.beginPath(); c.moveTo(k * 64, 0); c.lineTo(k * 64, h); c.moveTo(0, k * 64); c.lineTo(w, k * 64); c.stroke(); }
      }),
      carpet: canvasTex(256, 256, function (c, w, h) {
        c.fillStyle = '#5b6068'; c.fillRect(0, 0, w, h);
        for (var i = 0; i < 9000; i++) { var v = 70 + ((i * 2654435761) >>> 0) % 50; c.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 6) + ',.5)'; c.fillRect(((i * 97) % w), ((i * 61 + (i >> 3)) % h), 2, 2); }
      }),
      wood: canvasTex(256, 256, function (c, w, h) {
        for (var i = 0; i < 8; i++) {
          c.fillStyle = ['#a8794f', '#9c6f47', '#b08257', '#a3744b'][i % 4]; c.fillRect(0, i * 32, w, 32);
          c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, i * 32, w, 2); c.fillRect(((i * 83) % w), i * 32, 2, 32);
        }
      }),
      concrete: canvasTex(256, 256, function (c, w, h) {
        c.fillStyle = '#3a4048'; c.fillRect(0, 0, w, h);
        for (var i = 0; i < 4000; i++) { var v = 54 + (i * 7919) % 18; c.fillStyle = 'rgba(' + v + ',' + (v + 4) + ',' + (v + 10) + ',.6)'; c.fillRect((i * 131) % w, (i * 71 + (i >> 2)) % h, 2, 2); }
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h);
      }),
      grass: canvasTex(128, 128, function (c, w, h) {
        c.fillStyle = '#2f5426'; c.fillRect(0, 0, w, h);
        for (var i = 0; i < 2500; i++) { c.fillStyle = (i % 3) ? 'rgba(70,110,50,.5)' : 'rgba(25,45,20,.5)'; c.fillRect((i * 37) % w, (i * 53 + (i >> 4)) % h, 1, 3); }
      }),
    };
    [TEX.tile, TEX.carpet, TEX.wood, TEX.concrete, TEX.grass].forEach(function (t) { t.wrapS = t.wrapT = T.RepeatWrapping; });

    // ---------------------------------------------------------------- construtores básicos
    function B(parent, mat, x0, y0, z0, x1, y1, z1, noCast) {
      var m = new T.Mesh(UNIT, mat);
      m.scale.set(Math.abs(x1 - x0) || 0.001, Math.abs(y1 - y0) || 0.001, Math.abs(z1 - z0) || 0.001);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.castShadow = shadows && !noCast; m.receiveShadow = shadows;
      parent.add(m); return m;
    }
    function C(parent, mat, rt, rb, h, x, y0, z, seg) {
      var m = new T.Mesh(cyl(rt, rb, h, seg), mat);
      m.position.set(x, y0 + h / 2, z); m.castShadow = shadows; m.receiveShadow = shadows;
      parent.add(m); return m;
    }
    function place(parent, obj, x, z, rotY, y) { obj.position.set(x, y || 0, z); obj.rotation.y = rotY || 0; parent.add(obj); return obj; }
    function planeTex(parent, tex, w, h, x, y, z, rotY, basic) {
      var mat = basic ? new T.MeshBasicMaterial({ map: tex }) : new T.MeshLambertMaterial({ map: tex });
      var m = new T.Mesh(new T.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z); m.rotation.y = rotY || 0; parent.add(m); return m;
    }

    var COL = {
      deskTop: '#eef0f2', metal: '#24282e', partition: '#9aa3ad', partTrim: '#5d6670', monitor: '#15181c',
      chair: '#26324a', chairDark: '#1a2233', wall: '#d4d7db', wallDark: '#b9bec4', stripe: '#d9822b', base: '#a85d1e',
      wood: '#8b5a2b', woodLight: '#a8794f', white: '#f4f5f6', pot: '#e6e7e8', leaf: '#3d8b37', leaf2: '#2f6e2b', glassFrame: '#2b3138',
    };

    // monitores: compartilham materiais "ligado" e "desligado"
    var codeTex = canvasTex(128, 256, function (c, w, h) {
      c.fillStyle = '#0d1b2a'; c.fillRect(0, 0, w, h);
      var cols = ['#7ee787', '#79c0ff', '#d2a8ff', '#ffa657', '#e6edf3'];
      for (var i = 0; i < 32; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(8 + (i % 3) * 10, 4 + i * 8, 20 + ((i * 37) % 70), 4); }
    });
    codeTex.wrapT = T.RepeatWrapping; codeTex.repeat.set(1, 0.5);
    var screenOn = new T.MeshBasicMaterial({ map: codeTex });
    var screenOff = new T.MeshLambertMaterial({ color: '#0b0d10' });
    var monitors = [];

    // ---------------------------------------------------------------- modelos 3D (Kenney e Quaternius, CC0)
    // Carregados depois que a cena já aparece; enquanto isso (ou se falharem) ficam os desenhados à mão.
    var MODELS = {}, MODEL_INFO = {}, modelsReady = false;
    function toLambert(obj) {
      obj.traverse(function (x) {
        if (!x.isMesh) return;
        var conv = function (m) {
          var n = new T.MeshLambertMaterial({ color: m.color ? m.color.clone() : new T.Color('#ffffff'), map: m.map || null, transparent: !!m.transparent, opacity: m.opacity == null ? 1 : m.opacity });
          n.name = m.name; return n;
        };
        x.material = Array.isArray(x.material) ? x.material.map(conv) : conv(x.material);
        x.castShadow = shadows; x.receiveShadow = shadows;
      });
    }
    function loadModels() {
      if (!T.GLTFLoader || !window.fetch) return;
      var loader = new T.GLTFLoader();
      fetch('/models/lista.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        var n = list.length;
        if (!n) return;
        var done = function () {
          if (--n > 0) return;
          modelsReady = true;
          buildRooms();
          people.forEach(function (P) { actors.remove(P.root); });
          people.clear();
        };
        list.forEach(function (name) {
          loader.load('/models/' + name + '.glb', function (g) {
            toLambert(g.scene);
            MODELS[name] = g;
            var b = new T.Box3().setFromObject(g.scene);
            MODEL_INFO[name] = { min: b.min.clone(), size: b.getSize(new T.Vector3()) };
            done();
          }, undefined, done);
        });
      }).catch(function () { /* sem modelos */ });
    }
    /** Cópia de um modelo com a base no chão, centrada, no tamanho pedido (h = altura, w = largura). */
    function model(name, opt) {
      var g = MODELS[name];
      if (!g) return null;
      opt = opt || {};
      var info = MODEL_INFO[name], sz = info.size;
      var c = g.scene.clone(true);
      if (opt.tint) c.traverse(function (x) {
        if (!x.isMesh) return;
        var tm = function (m) { var col = opt.tint[m.name]; if (!col) return m; var n = m.clone(); n.color.set(col); return n; };
        x.material = Array.isArray(x.material) ? x.material.map(tm) : tm(x.material);
      });
      var k = opt.h ? opt.h / sz.y : opt.w ? opt.w / sz.x : 1;
      c.scale.setScalar(k);
      c.position.set(-(info.min.x + sz.x / 2) * k, -info.min.y * k, -(info.min.z + sz.z / 2) * k);
      var inner = new T.Group(); inner.add(c); inner.rotation.y = opt.rot || 0;
      var w = new T.Group(); w.add(inner);
      return w;
    }

    function makeChair(color) {
      var mc = model('chairDesk', { h: 0.6, rot: Math.PI, tint: { carpet: color || COL.chair } });   // modelo olha para +z; quem senta aqui olha para -z
      if (mc) return mc;
      var g = new T.Group(), mat = M(color || COL.chair), dark = M(COL.metal);
      for (var k = 0; k < 5; k++) {
        var leg = B(g, dark, -0.012, 0.015, 0, 0.012, 0.03, 0.13);
        leg.geometry = UNIT; leg.position.set(Math.sin(k * 1.2566) * 0.065, 0.022, Math.cos(k * 1.2566) * 0.065); leg.rotation.y = k * 1.2566;
        C(g, dark, 0.012, 0.012, 0.02, Math.sin(k * 1.2566) * 0.13, 0, Math.cos(k * 1.2566) * 0.13, 6);
      }
      C(g, dark, 0.014, 0.014, 0.18, 0, 0.03, 0, 8);
      B(g, mat, -0.13, 0.2, -0.12, 0.13, 0.25, 0.12);                 // assento
      B(g, mat, -0.12, 0.27, 0.11, 0.12, 0.56, 0.15);                 // encosto (atrás = +z)
      B(g, dark, -0.02, 0.22, 0.12, 0.02, 0.3, 0.14);
      B(g, dark, -0.15, 0.31, -0.06, -0.13, 0.33, 0.08); B(g, dark, 0.13, 0.31, -0.06, 0.15, 0.33, 0.08); // braços
      B(g, dark, -0.15, 0.25, 0.0, -0.13, 0.31, 0.02); B(g, dark, 0.13, 0.25, 0.0, 0.15, 0.31, 0.02);
      return g;  // a pessoa sentada olha para -z
    }
    function makePlant(s) {
      var mp = (s || 1) < 0.6 ? model('plantSmall1', { h: 0.17 }) : model('pottedPlant', { h: 0.62 * (s || 1) });
      if (mp) return mp;
      var g = new T.Group(); s = s || 1;
      B(g, M(COL.pot), -0.09 * s, 0, -0.09 * s, 0.09 * s, 0.2 * s, 0.09 * s);
      B(g, M('#4a3527'), -0.075 * s, 0.19 * s, -0.075 * s, 0.075 * s, 0.205 * s, 0.075 * s, true);
      C(g, M('#5b4030'), 0.012 * s, 0.015 * s, 0.18 * s, 0, 0.2 * s, 0, 6);
      var leaf = [M(COL.leaf), M(COL.leaf2)];
      [[0, 0.46, 0, 0.13], [0.07, 0.4, 0.04, 0.1], [-0.07, 0.42, -0.03, 0.1], [0.02, 0.55, -0.05, 0.09], [-0.04, 0.36, 0.07, 0.08]].forEach(function (p, k) {
        var m = new T.Mesh(new T.IcosahedronGeometry(p[3] * s, 0), leaf[k % 2]);
        m.position.set(p[0] * s, p[1] * s, p[2] * s); m.castShadow = shadows; g.add(m);
      });
      return g;
    }
    function makeBookshelf(w, h) {
      var g = new T.Group(), wd = M(COL.wood), d = 0.28;
      B(g, wd, -w / 2, 0, -d / 2, -w / 2 + 0.03, h, d / 2); B(g, wd, w / 2 - 0.03, 0, -d / 2, w / 2, h, d / 2);
      B(g, wd, -w / 2, h - 0.03, -d / 2, w / 2, h, d / 2); B(g, M('#6e4520'), -w / 2, 0, -d / 2, w / 2, h, -d / 2 + 0.02);
      var shelves = 4, cols = ['#c0392b', '#2e86c1', '#f4d03f', '#27ae60', '#8e44ad', '#ecf0f1', '#34495e', '#e67e22', '#16a085'];
      for (var s = 0; s < shelves; s++) {
        var y = s * (h - 0.03) / shelves;
        B(g, wd, -w / 2, y, -d / 2, w / 2, y + 0.025, d / 2);
        var x = -w / 2 + 0.04, n = 0;
        while (x < w / 2 - 0.08) {
          var bw = 0.025 + ((s * 7 + n * 3) % 4) * 0.008, bh = 0.13 + ((s + n * 5) % 4) * 0.02;
          if ((s * 3 + n) % 9 === 8) { x += 0.05; n++; continue; }
          B(g, M(cols[(s * 5 + n * 2) % cols.length]), x, y + 0.025, -d / 2 + 0.03, x + bw, y + 0.025 + bh, d / 2 - 0.04, true);
          x += bw + 0.004; n++;
        }
      }
      return g;
    }
    function makeCabinet(w, h) {
      var g = new T.Group(), d = 0.3, wm = M(COL.white), line = M('#9aa0a6');
      B(g, wm, -w / 2, 0, -d / 2, w / 2, h, d / 2);
      var n = Math.max(2, Math.round(h / 0.17));
      for (var k = 1; k < n; k++) B(g, line, -w / 2 + 0.01, (h * k) / n - 0.004, d / 2, w / 2 - 0.01, (h * k) / n + 0.004, d / 2 + 0.004, true);
      for (var j = 0; j < n; j++) B(g, M('#6b7178'), -0.05, (h * (j + 0.6)) / n - 0.006, d / 2, 0.05, (h * (j + 0.6)) / n + 0.006, d / 2 + 0.015, true);
      return g;
    }
    function makePrinter() {
      var g = new T.Group();
      B(g, M('#e9eaec'), -0.2, 0, -0.17, 0.2, 0.32, 0.17);
      B(g, M('#3b4047'), -0.2, 0.32, -0.17, 0.2, 0.36, 0.17);
      B(g, M('#f8f9fa'), -0.13, 0.36, -0.1, 0.13, 0.4, 0.12);
      B(g, M('#2d333b'), 0.08, 0.33, 0.12, 0.18, 0.37, 0.17);
      B(g, M('#c9ccd0'), -0.18, 0.1, 0.17, 0.18, 0.12, 0.19, true); B(g, M('#c9ccd0'), -0.18, 0.2, 0.17, 0.18, 0.22, 0.19, true);
      return g;
    }
    function makeSofa(w, color) {
      var ms = model('loungeSofa', { w: w, tint: { carpet: color || '#6b6f76' } });
      if (ms) return ms;
      var g = new T.Group(), m = M(color || '#6b6f76'), d = 0.42;
      B(g, m, -w / 2, 0.05, -d / 2, w / 2, 0.22, d / 2);
      B(g, m, -w / 2, 0.05, -d / 2, w / 2, 0.5, -d / 2 + 0.12);          // encosto atrás (-z), frente +z
      B(g, m, -w / 2, 0.05, -d / 2, -w / 2 + 0.1, 0.32, d / 2); B(g, m, w / 2 - 0.1, 0.05, -d / 2, w / 2, 0.32, d / 2);
      B(g, M('#30343a'), -w / 2 + 0.03, 0, -d / 2 + 0.03, w / 2 - 0.03, 0.05, d / 2 - 0.03);
      var cush = M(color ? color : '#7a7f87');
      B(g, cush, -w / 2 + 0.11, 0.22, -d / 2 + 0.12, -0.01, 0.27, d / 2 - 0.02); B(g, cush, 0.01, 0.22, -d / 2 + 0.12, w / 2 - 0.11, 0.27, d / 2 - 0.02);
      return g;
    }
    function makeWallBoard(w, h, tex, frame) {
      var g = new T.Group();
      B(g, M(frame || '#8a9099'), -w / 2 - 0.02, -0.02, 0, w / 2 + 0.02, h + 0.02, 0.025);
      var p = planeTex(g, tex, w, h, 0, h / 2, 0.027, 0, false);
      p.receiveShadow = shadows;
      return g;
    }
    function makeRack() {
      var g = new T.Group();
      B(g, M('#1c2026'), -0.18, 0, -0.18, 0.18, 0.95, 0.18);
      var leds = [];
      for (var k = 0; k < 7; k++) {
        B(g, M('#2b313a'), -0.16, 0.08 + k * 0.12, 0.18, 0.16, 0.17 + k * 0.12, 0.19, true);
        var led = new T.Mesh(UNIT, new T.MeshBasicMaterial({ color: k % 3 ? '#3fb950' : '#4f8cff' }));
        led.scale.set(0.02, 0.02, 0.01); led.position.set(0.12, 0.125 + k * 0.12, 0.195); g.add(led); leds.push(led);
      }
      g.userData.leds = leds;
      return g;
    }
    function makeCooler() {
      var g = new T.Group();
      B(g, M('#e8eaed'), -0.1, 0, -0.1, 0.1, 0.42, 0.1);
      var jar = new T.Mesh(cyl(0.08, 0.08, 0.2, 14), new T.MeshLambertMaterial({ color: '#8ecbff', transparent: true, opacity: 0.75 }));
      jar.position.set(0, 0.52, 0); g.add(jar);
      B(g, M('#d23f3f'), -0.05, 0.3, 0.1, -0.02, 0.33, 0.12, true); B(g, M('#3f7fd2'), 0.02, 0.3, 0.1, 0.05, 0.33, 0.12, true);
      return g;
    }
    function makeCoffee() {
      var g = new T.Group();
      B(g, M('#8b5a2b'), -0.32, 0, -0.18, 0.32, 0.38, 0.18);               // balcão
      B(g, M('#eef0f2'), -0.34, 0.38, -0.2, 0.34, 0.41, 0.2);
      var cm = model('kitchenCoffeeMachine', { h: 0.24 });
      if (cm) place(g, cm, -0.14, 0, 0, 0.41);
      else { B(g, M('#2d333b'), -0.25, 0.41, -0.12, -0.03, 0.66, 0.1); B(g, M('#c0392b'), -0.2, 0.6, 0.1, -0.08, 0.63, 0.11, true); }   // máquina
      C(g, M('#ffffff'), 0.03, 0.025, 0.06, 0.08, 0.41, 0.02, 10); C(g, M('#e3b341'), 0.03, 0.025, 0.06, 0.18, 0.41, -0.03, 10);
      return g;
    }
    function makePingPong() {
      var g = new T.Group();
      B(g, M('#1f6f43'), -0.75, 0.36, -0.42, 0.75, 0.39, 0.42);
      B(g, M('#ffffff'), -0.75, 0.39, -0.005, 0.75, 0.392, 0.005, true); B(g, M('#ffffff'), -0.005, 0.39, -0.42, 0.005, 0.392, 0.42, true);
      B(g, M('#e8e8e8'), -0.75, 0.39, -0.43, 0.75, 0.47, -0.42);            // rede (ao longo de x? não: rede no meio de x)
      g.children[g.children.length - 1].scale.set(0.01, 0.08, 0.86); g.children[g.children.length - 1].position.set(0, 0.43, 0);
      [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]].forEach(function (p) { B(g, M(COL.metal), p[0] - 0.02, 0, p[1] - 0.02, p[0] + 0.02, 0.36, p[1] + 0.02); });
      var ball = new T.Mesh(sph(0.02, 8, 6), M('#ffffff', { emissive: '#666666' })); ball.position.set(0, 0.45, 0); g.add(ball);
      g.userData.ball = ball;
      return g;
    }
    function makeDartboard() {
      var tex = canvasTex(128, 128, function (c) {
        var cols = ['#1b1b1b', '#f1e3c6'];
        for (var r = 60; r > 0; r -= 10) { c.fillStyle = cols[(r / 10) % 2]; c.beginPath(); c.arc(64, 64, r, 0, 7); c.fill(); }
        c.fillStyle = '#c0392b'; c.beginPath(); c.arc(64, 64, 8, 0, 7); c.fill();
        c.fillStyle = '#27ae60'; c.beginPath(); c.arc(64, 64, 3, 0, 7); c.fill();
      });
      var g = new T.Group();
      var m = new T.Mesh(new T.CircleGeometry(0.17, 24), new T.MeshLambertMaterial({ map: tex })); m.position.set(0, 0, 0.03); g.add(m);
      var back = new T.Mesh(cyl(0.19, 0.19, 0.03, 24), M('#3a2a1a')); back.rotation.x = Math.PI / 2; back.position.z = 0.012; g.add(back);
      return g;
    }
    function makeTVWall(tex, w, h) {
      var g = new T.Group();
      B(g, M('#0e1013'), -w / 2 - 0.03, -0.03, 0, w / 2 + 0.03, h + 0.03, 0.04);
      var p = planeTex(g, tex, w, h, 0, h / 2, 0.042, 0, true);
      g.userData.screen = p;
      return g;
    }
    function makeTable(r, h, color, round) {
      var g = new T.Group();
      if (round) C(g, M(color || COL.white), r, r, 0.03, 0, h - 0.03, 0, 20);
      else B(g, M(color || COL.white), -r, h - 0.03, -r * 0.75, r, h, r * 0.75);
      C(g, M(COL.metal), 0.02, 0.02, h - 0.03, 0, 0, 0, 8);
      C(g, M(COL.metal), 0.12, 0.14, 0.02, 0, 0, 0, 12);
      return g;
    }
    function makeBeanbag(color) {
      var g = new T.Group();
      var m = new T.Mesh(sph(0.17, 14, 10), M(color)); m.scale.set(1, 0.65, 1); m.position.y = 0.11; m.castShadow = shadows; g.add(m);
      var b = new T.Mesh(sph(0.12, 12, 8), M(color)); b.scale.set(1.2, 1, 0.6); b.position.set(0, 0.22, 0.1); g.add(b);
      return g;
    }
    function makeDoor(w, h, color) {
      var g = new T.Group();
      B(g, M('#2b2f36'), -w / 2 - 0.04, 0, 0, w / 2 + 0.04, h + 0.04, 0.03);
      B(g, M(color || '#14171b'), -w / 2, 0, 0.03, w / 2, h, 0.045);
      B(g, M('#c9ccd0'), w / 2 - 0.08, h * 0.45, 0.045, w / 2 - 0.04, h * 0.47, 0.065, true);
      return g;
    }

    // ---------------------------------------------------------------- texturas das paredes
    function boardTex(kind, accent) {
      return canvasTex(256, 160, function (c, w, h) {
        c.fillStyle = kind === 'chalk' ? '#244a3a' : '#f7f8fa'; c.fillRect(0, 0, w, h);
        c.lineWidth = 3;
        if (kind === 'kanban') {
          ['A fazer', 'Fazendo', 'Feito'].forEach(function (t, k) {
            c.fillStyle = '#57606a'; c.font = 'bold 14px sans-serif'; c.fillText(t, 12 + k * 84, 22);
            for (var n = 0; n < 3 - (k === 2 ? 0 : k); n++) { c.fillStyle = ['#ffd33d', '#79c0ff', '#7ee787', '#ffa198'][(k + n) % 4]; c.fillRect(12 + k * 84, 32 + n * 40, 62, 32); }
          });
        } else if (kind === 'goals') {
          c.fillStyle = '#24292f'; c.font = 'bold 18px sans-serif'; c.fillText('Metas do trimestre', 14, 26);
          [0.45, 0.7, 0.92].forEach(function (v, k) { c.fillStyle = ['#f0883e', '#e3b341', '#3fb950'][k]; c.fillRect(30 + k * 70, h - 14 - v * 100, 46, v * 100); });
        } else if (kind === 'chart' || kind === 'funnel' || kind === 'page') {
          c.fillStyle = '#0d1117'; c.fillRect(0, 0, w, h);
          if (kind === 'chart') {
            c.strokeStyle = accent || '#3fb950'; c.beginPath();
            [10, 40, 30, 70, 55, 95, 85, 120].forEach(function (v, k) { if (k) c.lineTo(20 + k * 30, h - 20 - v); else c.moveTo(20, h - 20 - v); });
            c.stroke(); c.fillStyle = '#e6edf3'; c.font = 'bold 15px sans-serif'; c.fillText('+38% esta semana', 16, 24);
          } else if (kind === 'funnel') {
            [0.95, 0.72, 0.5, 0.3].forEach(function (v, k) { c.fillStyle = ['#4f8cff', '#a371f7', '#f778ba', '#3fb950'][k]; c.fillRect(w / 2 - v * 110, 18 + k * 34, v * 220, 26); });
          } else {
            c.fillStyle = '#f6f8fa'; c.fillRect(30, 14, w - 60, h - 28); c.fillStyle = '#db61a2'; c.fillRect(44, 26, w - 88, 30);
            c.fillStyle = '#8b949e'; for (var i = 0; i < 4; i++) c.fillRect(44, 66 + i * 14, w - 120 - i * 18, 6);
            c.fillStyle = '#3fb950'; c.fillRect(44, h - 40, 70, 16);
          }
        } else if (kind === 'chalk') {
          c.fillStyle = '#e6f2ea'; c.font = 'bold 26px sans-serif'; c.fillText('Aula de IA', 18, 40);
          c.font = '16px sans-serif'; c.fillText('1. O que é um prompt', 22, 76); c.fillText('2. Agentes na prática', 22, 102); c.fillText('3. Projeto da turma', 22, 128);
        } else if (kind === 'crm') {
          c.fillStyle = '#24292f'; c.font = 'bold 16px sans-serif'; c.fillText('Follow-ups de hoje', 14, 24);
          for (var r = 0; r < 5; r++) { c.fillStyle = r % 2 ? '#eaeef2' : '#f6f8fa'; c.fillRect(12, 34 + r * 24, w - 24, 22); c.fillStyle = ['#3fb950', '#e3b341', '#ff7b72'][r % 3]; c.beginPath(); c.arc(26, 45 + r * 24, 6, 0, 7); c.fill(); c.fillStyle = '#57606a'; c.fillRect(40, 42 + r * 24, 120 - r * 10, 6); }
        } else if (kind === 'approve') {
          c.fillStyle = '#24292f'; c.font = 'bold 18px sans-serif'; c.fillText('Aprovações', 14, 26);
          c.font = '14px sans-serif'; c.fillStyle = '#57606a'; c.fillText('Quando um agente pedir', 14, 56); c.fillText('permissão, ele vem para cá.', 14, 76);
          c.fillStyle = '#f0883e'; c.fillRect(14, 96, 110, 30); c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.fillText('Aprovar', 40, 117);
        } else {
          c.fillStyle = '#24292f'; c.font = 'bold 16px sans-serif'; c.fillText('Ideias', 14, 24);
          for (var n2 = 0; n2 < 8; n2++) { c.fillStyle = ['#ffd33d', '#79c0ff', '#7ee787', '#ffa198'][n2 % 4]; c.fillRect(14 + (n2 % 4) * 58, 38 + Math.floor(n2 / 4) * 56, 48, 44); }
        }
      });
    }
    // nome "pintado" na parede: sem fundo, letras na cor da sala, com textura leve de tinta
    function paintTex(text, color) {
      return canvasTex(1024, 160, function (c, w, h) {
        c.clearRect(0, 0, w, h);
        var size = 112, font = function (z) { return '800 ' + z + 'px system-ui, \"Segoe UI\", sans-serif'; };
        c.font = font(size);
        while (c.measureText(text).width > w - 40 && size > 40) { size -= 4; c.font = font(size); }
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = color; c.fillText(text, w / 2, h / 2 + 4);
        // tinta: falhas pequenas e bordas levemente irregulares
        c.globalCompositeOperation = 'destination-out';
        for (var k = 0; k < 1400; k++) { c.fillStyle = 'rgba(0,0,0,' + (0.12 + ((k * 37) % 10) / 40) + ')'; c.fillRect((k * 131) % w, (k * 71 + (k >> 3)) % h, 2, 2); }
        c.globalCompositeOperation = 'source-over';
      });
    }
    // letreiro de LED: letras feitas de pontinhos acesos + brilho na parede (mais forte com a sala em uso e à noite)
    var leds = [];
    function ledTexs(text, color) {
      var W = 1024, H = 192, mask = document.createElement('canvas'); mask.width = W; mask.height = H;
      var m = mask.getContext('2d'), size = 128;
      var font = function (z) { return '900 ' + z + 'px system-ui, \"Segoe UI\", sans-serif'; };
      m.font = font(size); while (m.measureText(text).width > W - 60 && size > 40) { size -= 4; m.font = font(size); }
      m.textAlign = 'center'; m.textBaseline = 'middle'; m.fillStyle = '#fff'; m.fillText(text, W / 2, H / 2 + 6);
      var data = m.getImageData(0, 0, W, H).data, step = 9, r = 3.7;
      var lit = new T.Color(color).getStyle(), hi = new T.Color(color).lerp(new T.Color('#ffffff'), 0.6).getStyle();
      var on = function (x, y) { return data[((y | 0) * W + (x | 0)) * 4 + 3] >= 110; };
      var dots = canvasTex(W, H, function (c) {
        c.clearRect(0, 0, W, H);
        var x, y;
        // soquete escuro em volta de cada LED (aparece em qualquer parede, de dia também)
        c.fillStyle = 'rgba(18,20,24,.92)';
        for (y = step / 2; y < H; y += step) for (x = step / 2; x < W; x += step) if (on(x, y)) { c.beginPath(); c.arc(x, y, r + 1.2, 0, 6.3); c.fill(); }
        // LED aceso: cor da sala com o centro mais claro
        for (y = step / 2; y < H; y += step) for (x = step / 2; x < W; x += step) {
          if (!on(x, y)) continue;
          c.fillStyle = lit; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
          c.fillStyle = hi; c.beginPath(); c.arc(x - 0.6, y - 0.6, r * 0.45, 0, 6.3); c.fill();
        }
      });
      var glow = canvasTex(W / 4, H / 4, function (c, w, h) {
        c.clearRect(0, 0, w, h); c.filter = 'blur(6px)';
        c.drawImage(mask, 0, 0, w, h);
        c.globalCompositeOperation = 'source-in'; c.filter = 'none'; c.fillStyle = color; c.fillRect(0, 0, w, h);
      });
      return { dots: dots, glow: glow };
    }
    function ledSign(parent, text, color, w, h, x, y, z, rotY) {
      var tx = ledTexs(text, color), g = new T.Group();
      var gm = new T.MeshBasicMaterial({ map: tx.glow, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
      var halo = new T.Mesh(new T.PlaneGeometry(w * 1.08, h * 1.5), gm); halo.position.z = 0.001; g.add(halo);
      var dm = new T.MeshBasicMaterial({ map: tx.dots, transparent: true, depthWrite: false, toneMapped: false });
      var letters = new T.Mesh(new T.PlaneGeometry(w, h), dm); letters.position.z = 0.003; g.add(letters);
      g.position.set(x, y, z); g.rotation.y = rotY || 0; parent.add(g);
      var L = { glow: gm, dots: dm, room: -1, ph: Math.random() * 6 }; leds.push(L);
      return L;
    }
    function paintSign(parent, text, color, w, h, x, y, z, rotY) {
      var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshLambertMaterial({ map: paintTex(text, color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(x, y, z); m.rotation.y = rotY || 0; m.receiveShadow = shadows; parent.add(m); return m;
    }

    // ---------------------------------------------------------------- prédio
    var world = new T.Group(); scene.add(world);
    var grass = new T.Mesh(new T.PlaneGeometry(220, 220), new T.MeshLambertMaterial({ map: TEX.grass }));
    TEX.grass.repeat.set(60, 60);
    grass.rotation.x = -Math.PI / 2; grass.position.set(CENTER.x, -0.06, CENTER.z); grass.receiveShadow = shadows; world.add(grass);
    var slab = new T.Mesh(new T.BoxGeometry(26.2, 0.1, 15.6), new T.MeshLambertMaterial({ map: TEX.concrete }));
    TEX.concrete.repeat.set(13, 8);
    slab.position.set(11.95, -0.05, 6.55); slab.receiveShadow = shadows; world.add(slab);
    // muro baixo em volta
    var edge = M('#2a3038');
    B(world, edge, -1.15, -0.05, -1.25, 25.05, 0.12, -1.15); B(world, edge, -1.15, -0.05, 14.25, 25.05, 0.12, 14.35);
    B(world, edge, -1.15, -0.05, -1.25, -1.05, 0.12, 14.35); B(world, edge, 24.95, -0.05, -1.25, 25.05, 0.12, 14.35);

    var ACCENT = ['#8957e5', '#39c5cf', '#4f8cff', '#56d364', '#ff7b72', '#d29922', '#e3b341', '#f778ba', '#db61a2', '#3fb950', '#79c0ff', '#a371f7', '#2ea043', '#f0883e', '#8b949e'];
    // cor de cada sala: parede do fundo em destaque, paredes em tom claro, piso tingido, cadeiras e divisórias na cor da sala
    var ROOM_COLOR = {
      'CEO IA': '#7c4dff', 'Operações': '#00acc1', 'Tecnologia': '#2f6fec', 'Produto': '#2fa65a', 'Aquisição': '#f4511e',
      'Vendas': '#f2a900', 'Follow-up / CRM': '#e0a800', 'Copy': '#e83e8c', 'Landing Pages': '#c2185b', 'Tráfego': '#43a047',
      'Pós-venda': '#1e88e5', 'Curso IA Professores': '#8e5ce6', 'Sua mesa / Aprovações': '#fb8c00', 'Sala de Jogos': '#ff7043', 'Entrada': '#26a69a',
    };
    function mix(a, b, k) { return '#' + new T.Color(a).lerp(new T.Color(b), k).getHexString(); }
    function paletteOf(name, i) {
      var c = ROOM_COLOR[name] || ACCENT[i % ACCENT.length];
      return { accent: c, wall: mix(c, '#ffffff', 0.8), feature: mix(c, '#ffffff', 0.42), tile: mix(c, '#ffffff', 0.86),
        carpet: mix(c, '#ffffff', 0.35), wood: mix(c, '#ffffff', 0.82), chair: mix(c, '#101418', 0.4), partition: mix(c, '#9aa3ad', 0.62) };
    }
    var FLOOR = { 'CEO IA': 'carpet', 'Copy': 'carpet', 'Curso IA Professores': 'carpet', 'Pós-venda': 'carpet', 'Sala de Jogos': 'wood', 'Entrada': 'wood' };
    var rooms = [];      // por sala: { g, floorMat, wallMat, anim: [] }
    var skyGlass = new T.MeshBasicMaterial({ color: '#a9d3f5', transparent: true, opacity: 0.85 });
    var WALL_H = 1.3, WT = 0.08;

    function buildRooms(list) {
      if (Array.isArray(list) && list.length) cfg.ROOMS = list.slice();
      for (var r = 0; r < rooms.length; r++) world.remove(rooms[r].g);
      rooms = []; monitors = []; leds = [];
      cfg.ROOMS.forEach(function (name, i) {
        var og = cfg.roomOrigin(i);
        var g = new T.Group(); g.position.set(og.gx, 0, og.gy); world.add(g);
        var pal = paletteOf(name, i), accent = pal.accent;
        var kind = FLOOR[name] || 'tile';
        var tex = TEX[kind].clone(); tex.needsUpdate = true; tex.repeat.set(kind === 'tile' ? 3.5 : 2, kind === 'tile' ? 3.5 : 2);
        var floorBase = new T.Color(pal[kind]);
        var floorMat = new T.MeshLambertMaterial({ map: tex, color: floorBase.clone(), emissive: '#000000' });
        var floor = new T.Mesh(new T.PlaneGeometry(S, S), floorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.set(S / 2, 0.005, S / 2); floor.receiveShadow = shadows; g.add(floor);
        var wallBase = new T.Color(pal.wall), featBase = new T.Color(pal.feature);
        var wallMat = new T.MeshLambertMaterial({ color: wallBase.clone(), emissive: '#000000' });
        var featMat = new T.MeshLambertMaterial({ color: featBase.clone(), emissive: '#000000' });
        var stripe = M(accent), base = M(mix(accent, '#000000', 0.35));
        var lounge = name === 'Entrada' && loungeSide(i) === 'oeste';
        // parede do fundo (norte, cor de destaque) e da esquerda (oeste): altas
        B(g, featMat, -WT, 0, -WT, S + WT, WALL_H, 0);
        if (lounge) {   // passagem para a Sala de Jogos
          B(g, wallMat, -WT, 0, 0, 0, WALL_H, 1.35); B(g, wallMat, -WT, 0, 2.15, 0, WALL_H, S + WT);
          B(g, wallMat, -WT, 0.95, 1.35, 0, WALL_H, 2.15);
          B(g, M(mix(accent, '#000000', 0.3)), -WT - 0.01, 0.92, 1.33, 0.01, 0.97, 2.17, true);
        } else B(g, wallMat, -WT, 0, 0, 0, WALL_H, S + WT);
        B(g, M(COL.wallDark), -WT, WALL_H, -WT, S + WT, WALL_H + 0.03, 0, true); B(g, M(COL.wallDark), -WT, WALL_H, 0, 0, WALL_H + 0.03, S + WT, true);
        // faixas (como na referência) e rodapé
        [0.34, 0.39].forEach(function (y) { B(g, stripe, 0, y, 0, S, y + 0.022, 0.01, true); B(g, stripe, 0, y, 0, 0.01, y + 0.022, S, true); });
        B(g, base, 0, 0, 0, S, 0.05, 0.012, true); B(g, base, 0, 0, 0, 0.012, 0.05, S, true);
        // paredes da frente (sul) e da direita (leste): baixas, para ver dentro; porta no leste
        var low = 0.22;
        B(g, wallMat, 0, 0, S, S + WT, low, S + WT);
        B(g, wallMat, S, 0, 0, S + WT, low, 1.35); B(g, wallMat, S, 0, 2.15, S + WT, low, S);
        B(g, M(COL.wallDark), 0, low, S, S + WT, low + 0.02, S + WT, true);
        B(g, M(COL.wallDark), S, low, 0, S + WT, low + 0.02, 1.35, true); B(g, M(COL.wallDark), S, low, 2.15, S + WT, low + 0.02, S, true);
        B(g, M('#3b3f46'), S - 0.25, 0.004, 1.4, S + 0.3, 0.012, 2.1, true);    // capacho
        // janelas na parede oeste (a Sala de Espera tem a passagem no lugar)
        if (!lounge) {
        B(g, M(COL.glassFrame), 0.005, 0.66, 0.28, 0.03, 1.2, 2.12, true);
        var glass = new T.Mesh(new T.PlaneGeometry(1.8, 0.48), skyGlass); glass.rotation.y = Math.PI / 2; glass.position.set(0.035, 0.93, 1.2); g.add(glass);
        for (var mz = 0; mz <= 3; mz++) B(g, M(COL.glassFrame), 0.03, 0.66, 0.29 + mz * 0.6 - 0.015, 0.05, 1.2, 0.29 + mz * 0.6 + 0.015, true);
        B(g, M(COL.glassFrame), 0.03, 0.92, 0.28, 0.05, 0.94, 2.12, true);
        B(g, M('#c9ccd0'), 0.03, 0.64, 0.26, 0.09, 0.66, 2.14, true);          // peitoril
        }
        // placa com o nome da sala na parede do fundo
        var sign = ledSign(g, cfg.dispName(name), new T.Color(accent).offsetHSL(0, 0.15, 0.05).getStyle(), 2.5, 0.36, S / 2, 1.06, 0.004, 0);
        sign.room = i;
        var R = { g: g, floorMat: floorMat, wallMat: wallMat, featMat: featMat, floorBase: floorBase, wallBase: wallBase, featBase: featBase,
          anim: [], name: name, i: i, sign: sign, pal: pal };
        rooms.push(R);
        furnish(R, name, i, accent);
      });
      buildLounge();
    }
    // A Sala de Jogos fica colada na Sala de Espera: corredor coberto entre as duas portas
    function loungeSide(i) {
      var j = cfg.ROOMS.indexOf('Sala de Jogos'); if (j < 0) return null;
      var a = cfg.roomOrigin(i), b = cfg.roomOrigin(j);
      if (a.gy !== b.gy) return null;
      if (b.gx === a.gx - 5) return 'oeste';
      return null;
    }
    var loungeG = null;
    function buildLounge() {
      if (loungeG) { world.remove(loungeG); loungeG = null; }
      var ie = cfg.ROOMS.indexOf('Entrada');
      if (ie < 0 || loungeSide(ie) !== 'oeste') return;
      var o = cfg.roomOrigin(ie);
      loungeG = new T.Group(); world.add(loungeG);
      var x0 = o.gx - 5 + S + WT, x1 = o.gx - WT, z0 = o.gy + 1.35, z1 = o.gy + 2.15;
      var tex = TEX.wood.clone(); tex.needsUpdate = true; tex.repeat.set(1, 0.5);
      var fl = new T.Mesh(new T.PlaneGeometry(x1 - x0 + 0.2, z1 - z0), new T.MeshLambertMaterial({ map: tex, color: '#ffe0b2' }));
      fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2); fl.receiveShadow = shadows; loungeG.add(fl);
      var wm = M('#fff3e0'), glassM = new T.MeshLambertMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.45 });
      // paredes de vidro baixas dos dois lados, com faixa colorida
      [z0 - 0.04, z1].forEach(function (z) {
        B(loungeG, wm, x0, 0, z, x1, 0.25, z + 0.04);
        var g2 = new T.Mesh(UNIT, glassM); g2.scale.set(x1 - x0, 0.6, 0.02); g2.position.set((x0 + x1) / 2, 0.55, z + 0.02); loungeG.add(g2);
        B(loungeG, M('#ff7043'), x0, 0.85, z, x1, 0.9, z + 0.04, true);
      });
      // placa "Lounge" no alto
      B(loungeG, M('#fff3e0'), x0, 0.96, z0 - 0.05, x1, 1.16, z0, true); B(loungeG, M('#fff3e0'), x0, 0.96, z1, x1, 1.16, z1 + 0.05, true);   // faixa de parede para a pintura
      var sg = ledSign(loungeG, 'Lounge', '#ff7043', 1.3, 0.2, (x0 + x1) / 2, 1.06, z0 - 0.052, Math.PI);
      var sg2 = ledSign(loungeG, 'Lounge', '#ff7043', 1.3, 0.2, (x0 + x1) / 2, 1.06, z1 + 0.052, 0);
      void sg2;
      B(loungeG, M('#5d4037'), x0, 0.95, z0 - 0.05, x0 + 0.04, 1.18, z1 + 0.05, true); B(loungeG, M('#5d4037'), x1 - 0.04, 0.95, z0 - 0.05, x1, 1.18, z1 + 0.05, true);
      B(loungeG, M('#5d4037'), x0, 1.16, z0 - 0.05, x1, 1.2, z0, true); B(loungeG, M('#5d4037'), x0, 1.16, z1, x1, 1.2, z1 + 0.05, true);
    }

    function workstations(R, i) {
      var g = R.g;
      cfg.WORKSTATIONS.forEach(function (w, k) {
        var x0 = w.desk[0], x1 = w.desk[0] + w.desk[2], z0 = w.desk[1], z1 = w.desk[1] + 0.6, cx = (x0 + x1) / 2;
        var top = M(COL.deskTop), metal = M(COL.metal), part = M(R.pal.partition), trim = M(mix(R.pal.accent, '#000000', 0.25));
        B(g, top, x0, 0.36, z0, x1, 0.39, z1);
        B(g, metal, x0 + 0.03, 0, z0 + 0.05, x0 + 0.06, 0.36, z1 - 0.05); B(g, metal, x1 - 0.06, 0, z0 + 0.05, x1 - 0.03, 0.36, z1 - 0.05);
        B(g, metal, x0 + 0.03, 0.0, z0 + 0.25, x1 - 0.03, 0.03, z0 + 0.3);
        // divisórias da baia (fundo e lado esquerdo)
        B(g, part, x0 - 0.02, 0, z0 - 0.04, x1 + 0.02, 0.66, z0); B(g, trim, x0 - 0.025, 0.66, z0 - 0.045, x1 + 0.025, 0.68, z0 + 0.005, true);
        B(g, part, x0 - 0.04, 0, z0, x0, 0.62, z1 + 0.05); B(g, trim, x0 - 0.045, 0.62, z0, x0 + 0.005, 0.64, z1 + 0.05, true);
        // monitor, teclado, mouse, gabinete
        C(g, metal, 0.05, 0.06, 0.01, cx, 0.39, z0 + 0.12, 10);
        B(g, metal, cx - 0.012, 0.39, z0 + 0.1, cx + 0.012, 0.47, z0 + 0.125);
        B(g, M(COL.monitor), cx - 0.23, 0.45, z0 + 0.08, cx + 0.23, 0.72, z0 + 0.11);
        var scr = new T.Mesh(new T.PlaneGeometry(0.42, 0.24), screenOff); scr.position.set(cx, 0.585, z0 + 0.112); g.add(scr);
        monitors.push({ room: i, k: k, mesh: scr });
        B(g, M('#2d333b'), cx - 0.16, 0.39, z0 + 0.3, cx + 0.16, 0.405, z0 + 0.4, true);
        B(g, M('#2d333b'), cx + 0.21, 0.39, z0 + 0.33, cx + 0.25, 0.405, z0 + 0.39, true);
        B(g, M('#1f2329'), x1 - 0.2, 0, z0 + 0.1, x1 - 0.09, 0.28, z0 + 0.45);
        if (k === 0) { C(g, M('#ffffff'), 0.025, 0.022, 0.06, x0 + 0.12, 0.39, z0 + 0.42, 10); B(g, M('#f7f2d0'), x0 + 0.2, 0.39, z0 + 0.15, x0 + 0.34, 0.395, z0 + 0.26, true); }
        if (k === 2) place(g, makePlant(0.45), x0 + 0.1, z0 + 0.12, 0, 0.39);
        // cadeira (a pessoa senta de frente para o monitor)
        place(g, makeChair(R.pal.chair), cx, z1 + 0.3, 0);
      });
    }

    function decor(R, name) {
      var g = R.g, put = function (m, x, z, rot, y) { if (m) place(g, m, x, z, rot || 0, y || 0); };
      var work = name !== 'Entrada' && name !== 'Sala de Jogos';
      if (work) put(model('trashcan', { h: 0.2 }), 2.55, 1.55);
      switch (name) {
        case 'CEO IA': put(model('rugRectangle', { w: 1.3 }), 1.25, 2.85); put(model('lampRoundFloor', { h: 0.8 }), 2.3, 3.25); break;
        case 'Vendas': case 'Pós-venda': put(model('lampRoundFloor', { h: 0.8 }), 2.0, 3.25); put(model('rugRectangle', { w: 1.1 }), 1.25, 2.95); break;
        case 'Sua mesa / Aprovações': put(model('laptop', { h: 0.11 }), 1.5, 1.1, 0, 0.39); break;
        case 'Sala de Jogos': put(model('rugRound', { w: 1.0 }), 2.48, 1.2); put(model('speaker', { h: 0.55 }), 3.3, 0.2); put(model('speaker', { h: 0.55 }), 1.75, 0.2); put(model('kitchenFridgeSmall', { h: 0.45 }), 3.3, 2.75, -Math.PI / 2); break;
        case 'Entrada': put(model('rugRound', { w: 1.05 }), 1.6, 2.37); put(model('rugRound', { w: 0.95 }), 2.8, 2.02); put(model('sideTableDrawers', { h: 0.28 }), 0.25, 0.2); break;
        case 'Curso IA Professores': put(model('radio', { h: 0.12 }), 0.8, 0.95, 0, 0.39); break;
        default: break;
      }
    }

    function furnish(R, name, i, accent) {
      var g = R.g;
      if (modelsReady) decor(R, name);
      var work = name !== 'Entrada' && name !== 'Sala de Jogos';
      if (work) workstations(R, i);
      var wallItem = function (kind, x) { place(g, makeWallBoard(1.15, 0.36, boardTex(kind, accent)), x || 1.75, 0.012, 0, 0.5); };
      var tv = function (kind) { var t = makeTVWall(boardTex(kind, accent), 0.9, 0.42); place(g, t, 1.75, 0.012, 0, 0.46); };
      switch (name) {
        case 'CEO IA':
          wallItem('goals'); place(g, makeBookshelf(1.0, 0.95), 0.2, 2.8, Math.PI / 2); place(g, makePlant(1.1), 3.2, 0.3);
          place(g, makeSofa(0.9, '#4b3f63'), 1.25, 2.9, Math.PI); break;
        case 'Operações':
          wallItem('kanban'); place(g, makeCabinet(0.5, 0.75), 0.2, 2.75, Math.PI / 2); place(g, makePlant(0.9), 3.2, 0.3); place(g, makePrinter(), 1.3, 2.75, Math.PI); break;
        case 'Tecnologia': {
          tv('chart'); var rk = place(g, makeRack(), 0.22, 2.6, Math.PI / 2); var rk2 = place(g, makeRack(), 0.22, 3.0, Math.PI / 2);
          R.anim.push(function (t, st) { [rk, rk2].forEach(function (r, n) { r.userData.leds.forEach(function (l, k) { l.visible = !st.lit || Math.sin(t * (3 + k) + n * 2 + k) > -0.4; }); }); });
          place(g, makePlant(0.9), 3.2, 0.3); break;
        }
        case 'Produto':
          wallItem('ideas'); place(g, makeBookshelf(0.9, 0.95), 0.2, 2.8, Math.PI / 2); place(g, makePlant(0.9), 3.2, 0.3); break;
        case 'Aquisição':
          tv('funnel'); place(g, makePlant(1.1), 0.25, 3.2); place(g, makeCabinet(0.45, 0.6), 0.2, 2.6, Math.PI / 2); place(g, makePlant(0.8), 3.2, 0.3); break;
        case 'Vendas':
          tv('chart'); place(g, makeCooler(), 0.22, 2.6, Math.PI / 2); place(g, makeSofa(0.9, '#5a4a2a'), 1.3, 2.95, Math.PI); place(g, makePlant(1), 3.2, 0.3); break;
        case 'Follow-up / CRM':
          wallItem('crm'); place(g, makeCabinet(0.45, 0.75), 0.2, 2.55, Math.PI / 2); place(g, makeCabinet(0.45, 0.75), 0.2, 3.05, Math.PI / 2); place(g, makePrinter(), 1.35, 2.8, Math.PI); break;
        case 'Copy':
          wallItem('ideas'); place(g, makeBookshelf(1.0, 0.95), 0.2, 2.8, Math.PI / 2); place(g, makeBookshelf(0.8, 0.95), 1.4, 3.3, Math.PI); place(g, makePlant(1), 3.2, 0.3); break;
        case 'Landing Pages':
          tv('page'); place(g, makePlant(1), 0.25, 3.2); place(g, makeCabinet(0.45, 0.6), 0.2, 2.6, Math.PI / 2); place(g, makePlant(0.8), 3.2, 0.3); break;
        case 'Tráfego':
          tv('chart'); place(g, makeTVWall(boardTex('funnel', accent), 0.7, 0.36), 0.012, 2.8, Math.PI / 2, 0.55); place(g, makePlant(1), 3.2, 0.3); place(g, makeCooler(), 1.3, 3.2, Math.PI); break;
        case 'Pós-venda':
          wallItem('crm'); place(g, makeSofa(1.0, '#3f5a6b'), 1.2, 2.95, Math.PI); place(g, makeCooler(), 0.22, 2.6, Math.PI / 2); place(g, makePlant(1), 3.2, 0.3); break;
        case 'Curso IA Professores':
          place(g, makeWallBoard(1.4, 0.4, boardTex('chalk'), '#7a5a3a'), 1.75, 0.012, 0, 0.48); place(g, makeBookshelf(1.0, 0.95), 0.2, 2.8, Math.PI / 2); place(g, makePlant(1), 3.2, 0.3); break;
        case 'Sua mesa / Aprovações': {
          wallItem('approve');
          var beacon = new T.Mesh(sph(0.06, 12, 8), new T.MeshBasicMaterial({ color: '#f0883e' }));
          beacon.position.set(1.85, 0.45, 0.95); g.add(beacon);
          C(g, M(COL.metal), 0.03, 0.03, 0.02, 1.85, 0.39, 0.95, 8);
          R.anim.push(function (t, st) { var on = st.waiting; beacon.visible = !on || Math.sin(t * 8) > -0.3; beacon.material.color.set(on ? '#ff7b2e' : '#6e7681'); beacon.scale.setScalar(on ? 1 + 0.25 * Math.sin(t * 8) : 0.8); });
          place(g, makePlant(1), 3.2, 0.3); place(g, makeCabinet(0.45, 0.6), 0.2, 2.6, Math.PI / 2); break;
        }
        case 'Sala de Jogos': {
          // posições casam com GAME_SLOTS do app.js
          var pp = place(g, makePingPong(), 1.15, 2.5, 0);
          pp.scale.set(0.62, 1, 0.55);
          R.anim.push(function (t, st) { var b = pp.userData.ball; if (st.playing) { var u = (t * 1.6) % 2, k = u < 1 ? u : 2 - u; b.position.set(-0.7 + 1.4 * k, 0.42 + Math.abs(Math.sin(k * Math.PI * 2)) * 0.12, 0.1 * Math.sin(t)); b.visible = true; } else b.visible = false; });
          var gtv = makeTVWall(canvasTex(256, 144, function (c, w, h) { var gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a86ff'); gr.addColorStop(1, '#8338ec'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#ffbe0b'; c.fillRect(40, 90, 30, 30); c.fillStyle = '#fb5607'; c.fillRect(170, 60, 40, 60); c.fillStyle = '#06d6a0'; c.fillRect(0, 120, w, 24); }), 0.8, 0.45);
          place(g, gtv, 2.48, 0.012, 0, 0.45);
          place(g, makeBeanbag('#e85d75'), 2.1, 1.2, Math.PI); place(g, makeBeanbag('#3a86ff'), 2.85, 1.2, Math.PI);
          place(g, makeDartboard(), 1.15, 0.012, 0, 0.7);
          place(g, makeCoffee(), 2.75, 3.3, Math.PI);
          place(g, makeSofa(0.9, '#c0583a'), 0.3, 1.0, Math.PI / 2);
          place(g, makePlant(1), 0.25, 3.25);
          break;
        }
        case 'Entrada': {
          // Sala de Espera: cadeiras na parede oeste, mesa de xadrez e de cartas (casam com WAIT_SLOTS)
          place(g, makeDoor(0.7, 0.85, '#1b2a3a'), 1.75, 0.012, 0);
          var CH = ['#e53935', '#1e88e5', '#43a047', '#fbc02d', '#8e24aa', '#00897b', '#f4511e'];
          cfg.WAIT_SLOTS.forEach(function (s, k) {
            var f = focusFor('Entrada', s), dx = f[0] - s.p[0], dz = f[1] - s.p[1];
            place(g, model('loungeChair', { h: 0.44, rot: Math.PI, tint: { carpet: CH[k % CH.length] } }) || makeChair(CH[k % CH.length]), s.p[0], s.p[1], Math.atan2(-dx, -dz));
          });
          var chess = place(g, makeTable(0.2, 0.3, '#f4f5f6', false), 1.6, 2.37);
          var board = new T.Mesh(new T.PlaneGeometry(0.22, 0.22), new T.MeshLambertMaterial({ map: canvasTex(64, 64, function (c) { for (var a = 0; a < 8; a++) for (var b = 0; b < 8; b++) { c.fillStyle = (a + b) % 2 ? '#3b2a1a' : '#f1e3c6'; c.fillRect(a * 8, b * 8, 8, 8); } }) }));
          board.rotation.x = -Math.PI / 2; board.position.set(0, 0.302, 0); chess.add(board);
          var cards = place(g, makeTable(0.24, 0.3, '#2f6b4f', true), 2.8, 2.02);
          for (var cdi = 0; cdi < 5; cdi++) B(cards, M(cdi % 2 ? '#ffffff' : '#f2d7d5'), -0.08 + cdi * 0.035, 0.302, -0.03, -0.055 + cdi * 0.035, 0.306, 0.02, true);
          place(g, makePlant(1.2), 3.2, 0.3); place(g, makeCooler(), 3.2, 3.25, -Math.PI / 2);
          break;
        }
        default:
          wallItem('ideas'); place(g, makePlant(1), 3.2, 0.3);
      }
    }

    // para onde olha quem está numa vaga de lazer
    var FOCUS = { play: [1.15, 2.5], videogame: [2.48, 0.0], darts: [1.15, 0.0], coffee: [2.75, 3.6], chess: [1.6, 2.37], cards: [2.8, 2.02] };
    function focusFor(room, slot) {
      if (slot.face) return [slot.p[0] + slot.face[0], slot.p[1] + slot.face[1]];
      var f = FOCUS[slot.pose];
      if (f) return f;
      return [slot.p[0] + 1, slot.p[1]];      // celular/revista: olha para dentro da sala
    }

    // ================================================================ bonecos
    var PANTS = ['#2d3748', '#3b3f46', '#1f2a44', '#4a3b2a', '#283a2e'];
    var STATUS_COL = { trabalhando: '#4f8cff', delegando: '#a371f7', aguardando: '#f0883e', concluido: '#3fb950', ocioso: '#8b949e' };
    var ringMats = {};
    function ringMat(st) { return ringMats[st] || (ringMats[st] = new T.MeshBasicMaterial({ color: STATUS_COL[st] || '#8b949e', transparent: true, opacity: 0.85, depthWrite: false })); }
    var ringGeo = new T.RingGeometry(0.16, 0.2, 28);
    var iconTex = {};
    function statusIcon(st) {
      if (iconTex[st]) return iconTex[st];
      var glyph = { trabalhando: '⚙', delegando: '⇄', aguardando: '!', concluido: '✓', ocioso: 'z' }[st] || '•';
      var t = canvasTex(64, 64, function (c) {
        c.fillStyle = STATUS_COL[st] || '#8b949e'; c.beginPath(); c.arc(32, 32, 28, 0, 7); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 4; c.stroke();
        c.fillStyle = '#fff'; c.font = 'bold 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(glyph, 32, 34);
      });
      return (iconTex[st] = new T.SpriteMaterial({ map: t, depthTest: false, sizeAttenuation: false }));
    }
    function textSprite(text, opt) {
      opt = opt || {};
      var fs = opt.size || 30, pad = 14;
      var c = document.createElement('canvas'), x = c.getContext('2d');
      x.font = '600 ' + fs + 'px system-ui, sans-serif';
      var w = Math.ceil(x.measureText(text).width) + pad * 2, h = fs + pad;
      c.width = w; c.height = h + (opt.tail ? 10 : 0);
      x = c.getContext('2d'); x.font = '600 ' + fs + 'px system-ui, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
      x.fillStyle = opt.bg || 'rgba(13,17,23,.78)'; rr(x, 0, 0, w, h, h / 2.4); x.fill();
      if (opt.tail) { x.beginPath(); x.moveTo(w / 2 - 8, h); x.lineTo(w / 2, h + 10); x.lineTo(w / 2 + 8, h); x.fill(); }
      x.fillStyle = opt.color || '#ffffff'; x.fillText(text, w / 2, h / 2 + 1);
      var tex = new T.CanvasTexture(c);
      var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
      sp.userData.px = [c.width / fs, c.height / fs];   // tamanho em "letras"
      fitSprite(sp);
      sp.renderOrder = 10;
      return sp;
    }

    // sprites com tamanho fixo na tela (não somem de longe nem ficam enormes de perto)
    var FONT_PX = 12;
    function pxK() { return Math.tan(camera.fov * Math.PI / 360) / ((stage.clientHeight || 500) / 2); }
    function fitSprite(sp) {
      var k = pxK();
      if (sp.userData.px) sp.scale.set(sp.userData.px[0] * FONT_PX * k, sp.userData.px[1] * FONT_PX * k, 1);
      else if (sp.userData.icon) sp.scale.set(sp.userData.icon * k, sp.userData.icon * k, 1);
    }
    function limb(parent, mat, w, len, d, x, y, z) {
      var pivot = new T.Group(); pivot.position.set(x, y, z); parent.add(pivot);
      var m = new T.Mesh(UNIT, mat); m.scale.set(w, len, d); m.position.y = -len / 2; m.castShadow = shadows; pivot.add(m);
      return pivot;
    }
    // personagens animados (Quaternius): roupa na cor da função; terno/vestido para CEO e Vendas
    var CHARS_M = ['Male_LongSleeve', 'Male_Shirt', 'Male_LongSleeve', 'Male_Suit'], CHARS_F = ['Female_Alternative', 'Female_TankTop', 'Female_Alternative', 'Female_Dress'];
    var FORMAL = { 'CEO / Estrategista': 1, 'Vendedor': 1 };
    var CH_K = 0.22, SIT_DY = 0, SIT_FWD = 0.13;
    function makeModelPerson(s) {
      if (!T.SkeletonUtils) return null;
      var a = s.data || {}, h = hash(a.id || 'x');
      var list = ((h >> 2) % 2) ? CHARS_F : CHARS_M;
      var g = MODELS[FORMAL[a.role] ? list[3] : list[h % 3]];
      if (!g) return null;
      var ch = T.SkeletonUtils.clone(g.scene);
      ch.scale.setScalar(CH_K);
      ch.traverse(function (x) { if (x.isMesh) { x.frustumCulled = false; x.castShadow = shadows; } });
      var root = new T.Group(), body = new T.Group(); root.add(body); body.add(ch);
      dress(ch, body, { h: h, shirt: s.shirt, female: list === CHARS_F, sub: a.kind === 'sub', hair: s.hair, formal: !!FORMAL[a.role] });
      body.traverse(function (x) { if (x.isMesh) x.castShadow = shadows; });
      var mixer = new T.AnimationMixer(ch), acts = {};
      g.animations.forEach(function (c) { acts[c.name.replace(/^(Man|Female)_/, '')] = mixer.clipAction(c); });
      var bones = {}; ch.traverse(function (x) { if (x.isBone) bones[x.name] = x; });
      // pose que a animação deu a cada osso do braço. O three.js só reescreve o osso quando o valor muda;
      // por isso guardamos a pose da animação e aplicamos o ajuste sempre em cima dela (sem acumular)
      var base = {}, out = {};
      ['UpperArmR', 'UpperArmL', 'LowerArmR', 'LowerArmL'].forEach(function (n) { if (bones[n]) { base[n] = bones[n].quaternion.clone(); out[n] = null; } });
      var P = { root: root, body: body, h: h, model: true, mixer: mixer, acts: acts, bones: bones, base: base, out: out, cur: null };
      // objetos na mão direita (compensando a escala do esqueleto)
      var hand = bones.PalmR || bones.LowerArmR;
      var holder = new T.Group();
      if (hand) {
        root.updateMatrixWorld(true);
        var ws = new T.Vector3(); hand.getWorldScale(ws);
        holder.scale.setScalar(1 / (ws.x || 1)); hand.add(holder);
      } else root.add(holder);
      var inner = new T.Group(); inner.position.y = 0.17; holder.add(inner);
      finishPerson(P, s, inner);
      return P;
    }
    /** Aro de status, ícone, objetos de lazer e campos comuns (boneco desenhado ou modelo). */
    function finishPerson(P, s, handParent) {
      var root = P.root;
      var ring = new T.Mesh(ringGeo, ringMat('ocioso')); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; root.add(ring); P.ring = ring;
      var icon = new T.Sprite(statusIcon('ocioso')); icon.userData.icon = 20; fitSprite(icon); icon.center.set(0.5, -0.25); icon.position.y = 1.0; icon.renderOrder = 11; root.add(icon); P.icon = icon;
      var hp = handParent;
      var cup = new T.Mesh(cyl(0.025, 0.02, 0.06, 10), M('#ffffff')); cup.position.y = -0.17; cup.visible = false; hp.add(cup); P.cup = cup;
      var phone = new T.Mesh(UNIT, M('#111418')); phone.scale.set(0.045, 0.085, 0.01); phone.position.set(0, -0.17, 0.02); phone.visible = false; hp.add(phone); P.phone = phone;
      var mag = new T.Mesh(UNIT, M('#e85d75')); mag.scale.set(0.16, 0.2, 0.01); mag.position.set(-0.07, -0.17, 0.05); mag.visible = false; hp.add(mag); P.mag = mag;
      var pad = new T.Mesh(UNIT, M('#2d333b')); pad.scale.set(0.1, 0.02, 0.05); pad.position.set(-0.06, -0.17, 0.03); pad.visible = false; hp.add(pad); P.pad = pad;
      var paddle = new T.Mesh(cyl(0.05, 0.05, 0.01, 12), M('#c0392b')); paddle.rotation.x = Math.PI / 2; paddle.position.set(0, -0.2, 0.02); paddle.visible = false; hp.add(paddle); P.paddle = paddle;
      var dart = new T.Mesh(UNIT, M('#e3b341')); dart.scale.set(0.01, 0.01, 0.08); dart.position.set(0, -0.17, 0.04); dart.visible = false; hp.add(dart); P.dart = dart;
      P.heading = 0; P.walk = 0; P.label = null; P.labelText = ''; P.say = null; P.sayText = ''; P.scale = 0.01;
      P.prev = null; P.shirt = s.shirt;
    }

    function makePerson(s) {
      if (modelsReady) { var mp = makeModelPerson(s); if (mp) return mp; }
      var h = hash(s.data ? s.data.id : String(Math.random()));
      var shirt = M(s.shirt || '#8b949e'), skin = M(s.skin || '#e0b48f'), hair = M(s.hair || '#2b1d14');
      var pants = M(PANTS[h % PANTS.length]), shoe = M('#1b1d21');
      var root = new T.Group();
      var body = new T.Group(); body.position.y = 0.42; root.add(body);
      var P = { root: root, body: body, h: h };
      // pernas
      ['L', 'R'].forEach(function (side, k) {
        var sx = k ? -0.055 : 0.055;
        var hip = limb(body, pants, 0.085, 0.2, 0.09, sx, 0, 0);
        var knee = limb(hip, pants, 0.075, 0.19, 0.08, 0, -0.2, 0);
        var sh = new T.Mesh(UNIT, shoe); sh.scale.set(0.08, 0.035, 0.13); sh.position.set(0, -0.2, 0.025); sh.castShadow = shadows; knee.add(sh);
        P['hip' + side] = hip; P['knee' + side] = knee;
      });
      // tronco
      var torso = new T.Group(); body.add(torso); P.torso = torso;
      var hipsM = new T.Mesh(UNIT, pants); hipsM.scale.set(0.2, 0.08, 0.11); hipsM.position.y = 0.01; torso.add(hipsM);
      var belt = new T.Mesh(UNIT, M('#24282e')); belt.scale.set(0.205, 0.02, 0.115); belt.position.y = 0.055; torso.add(belt);
      var chest = new T.Mesh(new T.CylinderGeometry(0.115, 0.1, 0.27, 10), shirt); chest.scale.z = 0.6; chest.position.y = 0.2; chest.castShadow = shadows; torso.add(chest);
      var collar = new T.Mesh(cyl(0.045, 0.06, 0.03, 10), shirt); collar.position.y = 0.335; torso.add(collar);
      var neck = new T.Mesh(cyl(0.032, 0.035, 0.05, 8), skin); neck.position.y = 0.36; torso.add(neck);
      // cabeça
      var head = new T.Group(); head.position.y = 0.38; torso.add(head); P.head = head;
      var skull = new T.Mesh(sph(0.088, 16, 12), skin); skull.scale.set(1, 1.08, 0.98); skull.position.y = 0.09; skull.castShadow = shadows; head.add(skull);
      var hairCap = new T.Mesh(new T.SphereGeometry(0.093, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
      hairCap.position.y = 0.1; hairCap.rotation.x = -0.25; hairCap.scale.set(1, 1.08, 1.02); head.add(hairCap);
      var style = h % 4;
      if (style === 1) { var bun = new T.Mesh(sph(0.04, 10, 8), hair); bun.position.set(0, 0.17, -0.07); head.add(bun); }
      if (style === 2) { var back = new T.Mesh(UNIT, hair); back.scale.set(0.17, 0.14, 0.04); back.position.set(0, 0.07, -0.075); head.add(back); }
      var eyeM = M('#14161a');
      [-1, 1].forEach(function (d) {
        var e = new T.Mesh(sph(0.012, 8, 6), eyeM); e.position.set(d * 0.032, 0.1, 0.082); head.add(e);
        var brow = new T.Mesh(UNIT, hair); brow.scale.set(0.03, 0.007, 0.01); brow.position.set(d * 0.033, 0.127, 0.084); head.add(brow);
        var ear = new T.Mesh(sph(0.018, 8, 6), skin); ear.scale.set(0.6, 1, 1); ear.position.set(d * 0.088, 0.09, 0); head.add(ear);
      });
      var nose = new T.Mesh(UNIT, M(s.skin || '#e0b48f', { emissive: '#1a0d05' })); nose.scale.set(0.016, 0.025, 0.02); nose.position.set(0, 0.08, 0.09); head.add(nose);
      var mouth = new T.Mesh(UNIT, M('#8a3b32')); mouth.scale.set(0.03, 0.007, 0.01); mouth.position.set(0, 0.048, 0.083); head.add(mouth);
      // braços (manga curta + antebraço de pele)
      ['L', 'R'].forEach(function (side, k) {
        var sx = k ? -0.135 : 0.135;
        var shp = limb(torso, shirt, 0.06, 0.15, 0.065, sx, 0.31, 0);
        var arm2 = new T.Mesh(UNIT, skin); arm2.scale.set(0.048, 0.04, 0.05); arm2.position.y = -0.165; shp.children[0].castShadow = shadows; shp.add(arm2);
        var el = limb(shp, skin, 0.046, 0.14, 0.048, 0, -0.165, 0);
        var hand = new T.Mesh(sph(0.028, 8, 6), skin); hand.position.y = -0.155; el.add(hand);
        P['sh' + side] = shp; P['el' + side] = el; P['hand' + side] = hand;
      });
      // acessório da função
      var acc = s.acc || 'nenhum';
      if (acc === 'fone' || acc === 'headset') {
        var band = new T.Mesh(new T.TorusGeometry(0.095, 0.012, 6, 16, Math.PI), M('#1f2328')); band.position.y = 0.1; head.add(band);
        [-1, 1].forEach(function (d) { var cup = new T.Mesh(cyl(0.03, 0.03, 0.025, 10), M('#1f2328')); cup.rotation.z = Math.PI / 2; cup.position.set(d * 0.095, 0.09, 0); head.add(cup); });
        if (acc === 'headset') { var mic = new T.Mesh(UNIT, M('#1f2328')); mic.scale.set(0.008, 0.008, 0.08); mic.position.set(0.08, 0.05, 0.05); mic.rotation.y = -0.5; head.add(mic); }
      } else if (acc === 'oculos') {
        [-1, 1].forEach(function (d) { var lens = new T.Mesh(new T.TorusGeometry(0.019, 0.004, 6, 14), M('#111')); lens.position.set(d * 0.032, 0.1, 0.09); head.add(lens); });
        var bridge = new T.Mesh(UNIT, M('#111')); bridge.scale.set(0.025, 0.004, 0.004); bridge.position.set(0, 0.1, 0.092); head.add(bridge);
      } else if (acc === 'gravata') {
        var tie = new T.Mesh(UNIT, M('#b62324')); tie.scale.set(0.03, 0.15, 0.01); tie.position.set(0, 0.24, 0.067); torso.add(tie);
        var knot = new T.Mesh(UNIT, M('#8e1b1c')); knot.scale.set(0.035, 0.025, 0.012); knot.position.set(0, 0.32, 0.066); torso.add(knot);
      } else if (acc === 'tablet' || acc === 'caderno' || acc === 'prancheta') {
        var item = new T.Mesh(UNIT, M(acc === 'tablet' ? '#1f2328' : acc === 'caderno' ? '#d29922' : '#a0703f')); item.scale.set(0.11, 0.15, 0.012);
        item.position.set(0, -0.14, 0.03); item.rotation.x = -0.4; P.elL.add(item); P.item = item;
      }
      finishPerson(P, s, P.elR);
      return P;
    }

    var people = new Map();
    var links = new Map();
    var fx = [];      // partículas
    var actors = new T.Group(); scene.add(actors);

    function setRot(p, k, v, speed) { p.rotation[k] += (v - p.rotation[k]) * Math.min(1, speed); }
    function angDiff(a, b) { var d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

    var SITS = { sit: 1, chess: 1, cards: 1, phone: 1, magazine: 1, videogame: 1 };
    function animModel(P, name, t, dt, moving) {
      var sit = !moving && SITS[name];
      var clip = moving ? 'Walk' : (P.jump > 0 || name === 'wave') ? 'Clapping' : sit ? 'Sitting' : 'Idle';
      if (P.cur !== clip && P.acts[clip]) {
        var nx = P.acts[clip]; nx.reset(); nx.setEffectiveWeight(1); nx.fadeIn(P.cur ? 0.25 : 0); nx.play();
        if (P.cur && P.acts[P.cur]) P.acts[P.cur].fadeOut(0.25);
        P.cur = clip;
      }
      if (P.acts.Walk) P.acts.Walk.timeScale = 1.45;
      P.mixer.update(dt);
      for (var bk in P.base) {
        var bq = P.bones[bk].quaternion;
        if (!P.out[bk] || !bq.equals(P.out[bk])) P.base[bk].copy(bq);      // a animação escreveu um valor novo
        bq.copy(P.base[bk]);
      }
      // braços por cima da animação, dobrando o cotovelo: digitar, celular, revista, controle, raquete, dardo, café
      // ur/ul = braço (para a frente), fr/fl = antebraço (dobra o cotovelo)
      var ur = 0, ul = 0, fr = 0, fl = 0, w = Math.sin(t * 13 + P.h), w2 = Math.sin(t * 12 + P.h + 1.7);
      if (!moving) switch (name) {
        case 'sit': ur = 0.45; ul = 0.45; fr = -1.15 + w * 0.08; fl = -1.15 + w2 * 0.08; break;          // mãos no teclado
        case 'type': ur = 0.5; ul = 0.5; fr = -1.5 + w * 0.05; fl = -1.5; break;                          // tablet no peito
        case 'phone': ur = 0.3; fr = -2.2; if (Math.sin(t * 0.5 + P.h) > 0.6) { ul = 0.4; fl = -1.3; } break;  // celular no ouvido
        case 'magazine': ur = 0.45; ul = 0.45; fr = -1.6; fl = -1.6; break;                                // revista aberta
        case 'videogame': ur = 0.4; ul = 0.4; fr = -1.3 + w * 0.06; fl = -1.3 + w2 * 0.06; break;          // controle
        case 'chess': case 'cards': {
          var mv = Math.sin(t * 0.8 + P.h) > 0.7;
          ur = mv ? 0.75 : 0.45; fr = mv ? -0.6 : -1.1; ul = 0.3; fl = -0.8; break;                        // mexe a peça / segura as cartas
        }
        case 'play': ur = 0.85 + Math.sin(t * 5 + P.h * 0.1) * 0.4; fr = -0.7; break;                      // raquete
        case 'darts': { var th = ((t * 0.7 + P.h * 0.01) % 1) < 0.7; ur = 1.3; fr = th ? -1.6 : -0.3; break; }  // mira e arremessa
        case 'coffee': ur = 0.3; fr = Math.sin(t * 0.9 + P.h) > 0.5 ? -2.0 : -1.35; break;                  // xícara
        default: break;
      }
      var bn = P.bones;
      if (bn.UpperArmR && ur) bn.UpperArmR.rotation.z += ur;
      if (bn.UpperArmL && ul) bn.UpperArmL.rotation.z -= ul;
      if (bn.LowerArmR && fr) bn.LowerArmR.rotation.x += fr;
      if (bn.LowerArmL && fl) bn.LowerArmL.rotation.x += fl;
      for (var ok in P.out) P.out[ok] = P.bones[ok].quaternion.clone();
      var jy = P.jump > 0 ? Math.sin((1 - P.jump / 0.9) * Math.PI) * 0.18 : 0;
      var ty = (sit ? SIT_DY + (name === 'videogame' ? -0.04 : 0) : 0) + jy;
      P.body.position.y += (ty - P.body.position.y) * Math.min(1, dt * 10);
      P.body.position.z += ((sit ? SIT_FWD : 0) - P.body.position.z) * Math.min(1, dt * 10);
      props(P, name, t, moving);
    }
    function props(P, name, t, moving) {
      P.cup.visible = !moving && name === 'coffee';
      P.phone.visible = !moving && name === 'phone';
      P.mag.visible = !moving && name === 'magazine';
      P.pad.visible = !moving && name === 'videogame';
      P.paddle.visible = !moving && name === 'play';
      P.dart.visible = !moving && name === 'darts' && ((t * 0.7 + P.h * 0.01) % 1) < 0.7;
    }

    function pose(P, name, t, dt, moving) {
      if (P.model) return animModel(P, name, t, dt, moving);
      var k = Math.min(1, dt * 10), ph = P.walk;
      var sit = name === 'sit' || name === 'chess' || name === 'cards' || name === 'phone' || name === 'magazine' || name === 'videogame';
      var hipY = sit ? (name === 'videogame' ? 0.2 : 0.29) : 0.42;
      var tgt = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shLx: 0, shRx: 0, shLz: 0.08, shRz: -0.08, elL: 0, elR: 0, torso: 0, head: 0, headY: 0 };
      if (moving) {
        var sw = Math.sin(ph);
        tgt.hipL = sw * 0.55; tgt.hipR = -sw * 0.55;
        tgt.kneeL = Math.max(0, Math.sin(ph + 1.3)) * 0.8; tgt.kneeR = Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * 0.8;
        tgt.shLx = -sw * 0.45; tgt.shRx = sw * 0.45; tgt.elL = -0.3; tgt.elR = -0.3;
        hipY += Math.abs(Math.cos(ph)) * 0.018;
      } else if (sit) {
        tgt.hipL = tgt.hipR = -1.5; tgt.kneeL = tgt.kneeR = 1.45;
        if (name === 'sit') {
          var ty = Math.sin(t * 14 + P.h) * 0.06, ty2 = Math.sin(t * 13 + P.h + 1.7) * 0.06;
          tgt.shLx = -0.75 + ty; tgt.shRx = -0.75 + ty2; tgt.elL = -0.75; tgt.elR = -0.75; tgt.shLz = 0.18; tgt.shRz = -0.18; tgt.torso = 0.12;
          tgt.head = 0.1 + Math.sin(t * 0.7 + P.h) * 0.05;
        } else if (name === 'phone') {
          tgt.shRx = -0.6; tgt.elR = -1.9; tgt.shRz = -0.25; tgt.headY = 0.15; tgt.head = 0.15;
          if (Math.sin(t * 0.5 + P.h) > 0.6) { tgt.shLx = -0.5; tgt.elL = -1.2; }
        } else if (name === 'magazine') {
          tgt.shLx = tgt.shRx = -0.9; tgt.elL = tgt.elR = -0.9; tgt.shLz = 0.25; tgt.shRz = -0.25; tgt.head = 0.3;
        } else if (name === 'videogame') {
          var tap = Math.sin(t * 16 + P.h) * 0.08;
          tgt.shLx = tgt.shRx = -0.7; tgt.elL = -0.9 + tap; tgt.elR = -0.9 - tap; tgt.shLz = 0.3; tgt.shRz = -0.3; tgt.head = -0.1;
          tgt.torso = Math.sin(t * 2 + P.h) * 0.08;
        } else { // xadrez / cartas
          var think = Math.sin(t * 0.8 + P.h);
          tgt.shLx = -0.6; tgt.elL = -0.8; tgt.shRx = think > 0.7 ? -1.1 : -0.55; tgt.elR = think > 0.7 ? -0.5 : -0.8; tgt.shLz = 0.2; tgt.shRz = -0.2;
          tgt.head = 0.35; tgt.torso = 0.15;
        }
      } else if (name === 'type') {
        tgt.shLx = -0.9; tgt.elL = -0.9; tgt.shRx = -0.7 + Math.sin(t * 10 + P.h) * 0.1; tgt.elR = -0.9; tgt.head = 0.25;
      } else if (name === 'wave') {
        tgt.shRz = -2.6 - Math.sin(t * 9) * 0.25; tgt.elR = -0.3 + Math.sin(t * 9) * 0.3; tgt.head = -0.1;
      } else if (name === 'play') {
        var hit = Math.sin(t * 5 + P.h * 0.1);
        tgt.shRx = -0.8 - hit * 0.6; tgt.elR = -0.8; tgt.shRz = -0.3 + hit * 0.3; tgt.hipL = 0.25; tgt.hipR = -0.2; tgt.kneeL = tgt.kneeR = 0.35; hipY -= 0.03;
        tgt.torso = 0.15;
      } else if (name === 'coffee') {
        var sip = Math.sin(t * 0.9 + P.h) > 0.5;
        tgt.shRx = sip ? -1.0 : -0.4; tgt.elR = sip ? -1.9 : -1.2; tgt.head = sip ? -0.2 : 0;
      } else if (name === 'darts') {
        var th = (t * 0.7 + P.h * 0.01) % 1;
        tgt.shRx = th < 0.7 ? -2.2 : -1.2; tgt.elR = th < 0.7 ? -1.6 + th : -0.1; tgt.head = -0.15;
      } else { // parado
        tgt.shLx = Math.sin(t * 1.6 + P.h) * 0.04; tgt.shRx = -tgt.shLx;
        hipY += Math.sin(t * 2 + P.h) * 0.004;
      }
      if (P.jump > 0) { var j = Math.sin((1 - P.jump / 0.9) * Math.PI); hipY += j * 0.22; tgt.shLz = 2.6; tgt.shRz = -2.6; tgt.elL = tgt.elR = -0.2; tgt.kneeL = tgt.kneeR = j * 0.6; }
      P.body.position.y += (hipY - P.body.position.y) * Math.min(1, dt * 12);
      setRot(P.hipL, 'x', tgt.hipL, k); setRot(P.hipR, 'x', tgt.hipR, k);
      setRot(P.kneeL, 'x', tgt.kneeL, k); setRot(P.kneeR, 'x', tgt.kneeR, k);
      setRot(P.shL, 'x', tgt.shLx, k); setRot(P.shR, 'x', tgt.shRx, k);
      setRot(P.shL, 'z', tgt.shLz, k); setRot(P.shR, 'z', tgt.shRz, k);
      setRot(P.elL, 'x', tgt.elL, k); setRot(P.elR, 'x', tgt.elR, k);
      setRot(P.torso, 'x', tgt.torso, k); setRot(P.head, 'x', tgt.head, k); setRot(P.head, 'y', tgt.headY, k);
      props(P, name, t, moving);
      if (P.item) P.item.visible = moving || name === 'idle' || name === 'type' || name === 'wave';
    }

    function puff(x, z, color, n, up) {
      for (var k = 0; k < n; k++) {
        var m = new T.Mesh(up ? UNIT : sph(0.05, 6, 4), new T.MeshBasicMaterial({ color: Array.isArray(color) ? color[k % color.length] : color, transparent: true, opacity: 0.9, depthWrite: false }));
        if (up) m.scale.set(0.04, 0.04, 0.008);
        var a = (k / n) * Math.PI * 2;
        m.position.set(x, up ? 1.0 : 0.45, z);
        var v = up ? new T.Vector3((Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6) : new T.Vector3(Math.cos(a) * 0.9, 0.3, Math.sin(a) * 0.9);
        scene.add(m); fx.push({ m: m, v: v, life: up ? 1.6 : 0.7, max: up ? 1.6 : 0.7, up: up, spin: (Math.random() - 0.5) * 12 });
      }
    }

    // ================================================================ câmera: girar, aproximar, mover
    var cam = { theta: 0.62, phi: 0.9, dist: 26, target: CENTER.clone() };
    var home = { theta: 0.62, phi: 0.9, dist: 26, target: CENTER.clone() };
    var aspect = 1;
    function fitDist() {
      // distância para caber o prédio inteiro (26 × 15) na tela
      var halfW = 14, halfH = 9.5, fov = camera.fov * Math.PI / 180;
      var dv = halfH / Math.tan(fov / 2), dh = halfW / (Math.tan(fov / 2) * aspect);
      return Math.max(14, Math.min(60, Math.max(dv, dh) * 1.02));
    }
    function updateCamera() {
      var sp = Math.sin(cam.phi);
      camera.position.set(cam.target.x + cam.dist * sp * Math.sin(cam.theta), cam.target.y + cam.dist * Math.cos(cam.phi), cam.target.z + cam.dist * sp * Math.cos(cam.theta));
      camera.lookAt(cam.target);
    }
    function resize() {
      var w = stage.clientWidth || 300, h = stage.clientHeight || 200;
      renderer.setSize(w, h, false);
      cvs.style.width = '100%'; cvs.style.height = '100%';
      aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix();
      people.forEach(function (P) { [P.icon, P.label, P.say].forEach(function (sp) { if (sp) fitSprite(sp); }); });
      var fd = fitDist();
      if (Math.abs(cam.dist - home.dist) < 0.01) cam.dist = fd;
      home.dist = fd;
      updateCamera();
    }
    window.addEventListener('resize', resize);

    var ptrs = new Map(), gest = null, ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
    function ndc(e) { var r = cvs.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
    function groundAt(v2) { ray.setFromCamera(v2, camera); var p = new T.Vector3(); return ray.ray.intersectPlane(ground, p) ? p : null; }
    function pan(dx, dy) {
      var k = cam.dist / (cvs.clientHeight || 400) * 0.9;
      var fwd = new T.Vector3(-Math.sin(cam.theta), 0, -Math.cos(cam.theta)), right = new T.Vector3(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
      cam.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
      cam.target.x = Math.max(-2, Math.min(26, cam.target.x)); cam.target.z = Math.max(-2, Math.min(16, cam.target.z));
    }
    cvs.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cvs.addEventListener('pointerdown', function (e) {
      try { cvs.setPointerCapture(e.pointerId); } catch (er) { /* nada */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) gest = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, panMode: e.button === 2 || e.shiftKey, ev: e };
      else if (ptrs.size === 2) { var v = Array.from(ptrs.values()); gest = { pinch: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y), dist: cam.dist, mx: (v[0].x + v[1].x) / 2, my: (v[0].y + v[1].y) / 2, moved: true }; }
      if (o.onInteract) o.onInteract();
    });
    cvs.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId) || !gest) return;
      var prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2 && gest.pinch) {
        var v = Array.from(ptrs.values()), d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
        cam.dist = Math.max(5, Math.min(70, gest.dist * gest.pinch / Math.max(20, d)));
        var mx = (v[0].x + v[1].x) / 2, my = (v[0].y + v[1].y) / 2; pan(mx - gest.mx, my - gest.my); gest.mx = mx; gest.my = my;
      } else if (ptrs.size === 1) {
        var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.hypot(e.clientX - gest.x, e.clientY - gest.y) > 6) gest.moved = true;
        if (!gest.moved) return;
        if (gest.panMode) pan(dx, dy);
        else { cam.theta -= dx * 0.006; cam.phi = Math.max(0.3, Math.min(1.32, cam.phi - dy * 0.005)); }
      }
      updateCamera();
    });
    function endP(e) {
      var g = gest; ptrs.delete(e.pointerId);
      if (!ptrs.size) {
        if (g && !g.pinch && !g.moved && performance.now() - g.t < 450) {
          var p = groundAt(ndc(e));
          if (o.onTap) o.onTap(p ? p.x : -99, p ? p.z : -99);
        }
        gest = null;
      }
    }
    cvs.addEventListener('pointerup', endP);
    cvs.addEventListener('pointercancel', function (e) { ptrs.delete(e.pointerId); gest = null; });
    cvs.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = e.deltaY < 0 ? 0.88 : 1 / 0.88, nd = Math.max(5, Math.min(70, cam.dist * f));
      // aproxima na direção do cursor
      var p = groundAt(ndc(e));
      if (p && nd < cam.dist) { var k = 1 - nd / cam.dist; cam.target.x += (p.x - cam.target.x) * k; cam.target.z += (p.z - cam.target.z) * k; }
      cam.dist = nd; updateCamera();
    }, { passive: false });
    cvs.addEventListener('dblclick', function () { resetView(); });
    function resetView() { cam.theta = home.theta; cam.phi = home.phi; cam.dist = home.dist; cam.target.copy(home.target); updateCamera(); }
    // teclado (controle remoto da TV): setas giram, +/- aproximam, 0 volta
    window.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') cam.theta += 0.12; else if (k === 'ArrowRight') cam.theta -= 0.12;
      else if (k === 'ArrowUp') cam.phi = Math.max(0.3, cam.phi - 0.08); else if (k === 'ArrowDown') cam.phi = Math.min(1.32, cam.phi + 0.08);
      else if (k === '+' || k === '=') cam.dist = Math.max(5, cam.dist * 0.88); else if (k === '-') cam.dist = Math.min(70, cam.dist / 0.88);
      else if (k === '0') { resetView(); return; } else return;
      updateCamera();
    });

    // ================================================================ quadro a quadro
    var tmpV = new T.Vector3();
    function skyLight(sk, t) {
      var day = sk.day, dusk = sk.dusk;
      var top = new T.Color().setRGB(0.05 + 0.5 * day + 0.25 * dusk, 0.07 + 0.65 * day + 0.08 * dusk, 0.15 + 0.75 * day);
      scene.background.copy(top); scene.fog.color.copy(top);
      hemi.intensity = 0.5 + 0.4 * day;
      hemi.color.setRGB(0.75 + 0.2 * day, 0.8 + 0.15 * day, 1);
      sun.intensity = 0.18 + 0.75 * day;
      sun.color.setRGB(1, 0.86 + 0.12 * day - 0.15 * dusk, 0.72 + 0.25 * day - 0.25 * dusk);
      // posição: nasce no leste (+x), se põe no oeste; à noite a "luz" vira a lua
      var isSun = sk.h >= 6 && sk.h < 18.5;
      var u = isSun ? (sk.h - 6) / 12.5 : ((sk.h + 24 - 18.5) % 24) / 11.5;
      var ang = u * Math.PI;
      tmpV.set(Math.cos(ang) * 30, 8 + Math.sin(ang) * 26, 14);
      sun.position.copy(CENTER).add(tmpV);
      sunBall.visible = isSun; moonBall.visible = !isSun;
      var far = tmpV.clone().normalize().multiplyScalar(80);
      sunBall.position.copy(CENTER).add(far); moonBall.position.copy(CENTER).add(far);
      starMat.opacity = Math.max(0, 0.9 - day * 1.6) * (0.75 + 0.25 * Math.sin(t * 1.3));
      skyGlass.color.copy(top).lerp(new T.Color('#ffffff'), 0.25 * day);
    }

    var lastSky = -99, lastName = new Map();
    function draw(st) {
      // st: { t, dt, sprites, agentList, sk, light, litRooms, busySeats, hotIdx, waiting, poseOf, roomIdx, camFollow }
      var t = st.t, dt = st.dt;
      if (t - lastSky > 5 || lastSky < 0) { lastSky = t; skyLight(st.sk, t); }
      var night = 1 - st.sk.day;
      codeTex.offset.y = (t * 0.15) % 1;
      // salas: luz e animações
      var playing = false;
      st.sprites.forEach(function (s) { if (s.game && s.leisure && s.leisure.pose === 'play' && !(s.path && s.path.length)) playing = true; });
      rooms.forEach(function (R, i) {
        var L = st.light[i];
        var lit = st.litRooms.has(i), hot = i === st.hotIdx;
        var b = 0.62 + 0.38 * Math.min(1, Math.max(0, (L - 0.78) / 0.3));
        R.floorMat.color.copy(R.floorBase).multiplyScalar(b);
        R.wallMat.color.copy(R.wallBase).multiplyScalar(0.8 + 0.2 * b);
        R.featMat.color.copy(R.featBase).multiplyScalar(0.8 + 0.2 * b);
        var em = hot ? 0.18 + 0.12 * Math.sin(t * 6) : (L > 0.9 ? 0.34 * night : 0.04 * night);
        R.floorMat.emissive.setRGB(em * (hot ? 1 : 1), em * (hot ? 0.45 : 0.85), em * (hot ? 0.1 : 0.55));
        R.wallMat.emissive.setRGB(em * 0.6, em * 0.5, em * 0.35); R.featMat.emissive.copy(R.wallMat.emissive);
        var rst = { lit: lit, waiting: st.waiting && hot, playing: playing };
        for (var a = 0; a < R.anim.length; a++) R.anim[a](t, rst);
        R.busyLed = L > 0.9 || hot;
      });
      leds.forEach(function (L) {
        var R2 = L.room >= 0 ? rooms[L.room] : null, on = !R2 || R2.busyLed;
        var pulse = 0.92 + 0.08 * Math.sin(t * 2.2 + L.ph);
        L.dots.opacity = (on ? 1 : 0.78) * pulse;
        L.glow.opacity = (on ? 0.06 + 0.34 * night : 0.02 + 0.16 * night) * pulse;
      });
      monitors.forEach(function (m) { m.mesh.material = st.litRooms.has(m.room) && (st.busySeats.get(m.room) || 0) > m.k ? screenOn : screenOff; });

      // pessoas
      var seen = new Set();
      st.sprites.forEach(function (s, id) {
        if (!s.data) return;
        seen.add(id);
        var P = people.get(id);
        if (!P || P.shirt !== s.shirt) {
          if (P) actors.remove(P.root);
          var fresh = !P;
          P = makePerson(s); people.set(id, P); actors.add(P.root);
          P.root.position.set(s.x, 0, s.y);
          if (fresh && s.data.kind === 'sub') puff(s.x, s.y, '#c9d1d9', 10, false);
        }
        var a = s.data, moving = !!(s.path && s.path.length);
        var pz = st.poseOf(s, t);
        // posição (sentado na mesa: encosta na cadeira, de frente para o monitor)
        var x = s.x, z = s.y;
        var ri = st.roomIdx(s.effRoom || a.room), og = cfg.roomOrigin(ri);
        if (pz === 'sit' && s.k < cfg.WORKSTATIONS.length) {
          var w = cfg.WORKSTATIONS[s.k]; x = og.gx + w.desk[0] + w.desk[2] / 2; z = og.gy + w.desk[1] + 0.6 + 0.3;
        }
        var dx = x - P.root.position.x, dz = z - P.root.position.z;
        P.root.position.x += dx * Math.min(1, dt * 14); P.root.position.z += dz * Math.min(1, dt * 14);
        // para onde olha
        var head = P.heading;
        if (moving && s.path.length) {
          var nx = s.path[0][0] - s.x, nz = s.path[0][1] - s.y;
          if (Math.abs(nx) + Math.abs(nz) > 0.001) head = Math.atan2(nx, nz);
        } else if (pz === 'sit' || pz === 'type') head = Math.PI;                         // olha para o monitor (norte)
        else if (s.leisure && pz === s.leisure.pose) {
          var f = focusFor(s.effRoom, s.leisure); head = Math.atan2(og.gx + f[0] - x, og.gy + f[1] - z);
        } else head = cam.theta;                                                                     // olha para você
        P.heading += angDiff(P.heading, head) * Math.min(1, dt * 8);
        P.root.rotation.y = P.heading;
        if (moving) P.walk += dt * 9.5;
        if (s.jump > 0.85 && !P.celebrated) { P.celebrated = true; puff(x, z, ['#3fb950', '#e3b341', '#4f8cff', '#f778ba', '#ff7b72', '#a371f7'], 26, true); }
        if (s.jump <= 0) P.celebrated = false;
        P.jump = s.jump || 0;
        pose(P, moving ? 'walk' : pz, t, dt, moving);
        // aparece e some
        var want = s.alpha > 0.01 ? Math.min(1, s.alpha) : 0;
        P.scale += (want - P.scale) * Math.min(1, dt * 6);
        var sc = Math.max(0.001, P.scale);
        P.root.scale.setScalar(sc);
        // aro, ícone, nome, balão
        P.ring.material = ringMat(a.status);
        P.ring.scale.setScalar(a.status === 'aguardando' ? 1 + 0.15 * Math.sin(t * 8) : 1);
        var leisure = !moving && s.leisure && pz === s.leisure.pose;
        var sayAge = t - (s.sayT || -99);
        var saying = s.say && sayAge < 2.8;
        P.icon.material = statusIcon(a.status);
        P.icon.visible = !leisure && !saying;
        P.icon.center.y = -0.25 - Math.sin(t * 3 + P.h) * 0.08;
        var label = s.game && !moving ? 'Na pausa' : (a.role || a.name || '');
        label = label.length > 20 ? label.slice(0, 19) + '…' : label;
        var showName = !leisure;
        if (P.labelText !== label) {
          if (P.label) { P.root.remove(P.label); P.label.material.map.dispose(); P.label.material.dispose(); }
          P.label = textSprite(label + (a.tag ? ' ' + a.tag : ''), { size: 28, bg: a.kind === 'sub' ? 'rgba(88,48,160,.85)' : 'rgba(13,17,23,.8)' });
          P.label.position.y = 0.02; P.label.center.set(0.5, 1.25); P.root.add(P.label); P.labelText = label;
        }
        P.label.visible = showName;
        if (saying && P.sayText !== s.say) {
          if (P.say) { P.root.remove(P.say); P.say.material.map.dispose(); P.say.material.dispose(); }
          var txt = s.say.length > 30 ? s.say.slice(0, 29) + '…' : s.say;
          P.say = textSprite(txt, { size: 28, bg: '#f6f8fa', color: '#1b1f24', tail: true });
          P.say.position.y = 1.0; P.say.center.set(0.5, -0.15); P.root.add(P.say); P.sayText = s.say;
        }
        if (P.say) P.say.visible = !!saying;
        P.label.center.y = 1.25 + ((s.k || 0) % 2) * 1.1;
      });
      people.forEach(function (P, id) { if (!seen.has(id)) { actors.remove(P.root); people.delete(id); var L = links.get(id); if (L) { scene.remove(L.line); scene.remove(L.dot); links.delete(id); } } });

      // linhas de delegação (chefe → subagente) com um "pacote" andando
      st.sprites.forEach(function (s, id) {
        var a = s.data;
        var L = links.get(id);
        var par = a && a.parent && people.get(a.parent), me = people.get(id);
        var on = !!(par && me && !s.leaving && (a.status === 'trabalhando' || a.status === 'delegando' || a.status === 'aguardando'));
        if (!on) { if (L) { L.line.visible = false; L.dot.visible = false; } return; }
        if (!L) {
          var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(17 * 3), 3));
          L = { line: new T.Line(geo, new T.LineBasicMaterial({ color: '#a371f7', transparent: true, opacity: 0.8 })), dot: new T.Mesh(sph(0.05, 8, 6), new T.MeshBasicMaterial({ color: '#d2a8ff' })) };
          scene.add(L.line); scene.add(L.dot); links.set(id, L);
        }
        L.line.visible = true; L.dot.visible = true;
        var p0 = par.root.position, p1 = me.root.position, pos = L.line.geometry.attributes.position;
        var hgt = 1.0 + Math.min(2.5, p0.distanceTo(p1) * 0.25);
        for (var k = 0; k <= 16; k++) {
          var u = k / 16;
          pos.setXYZ(k, p0.x + (p1.x - p0.x) * u, 0.95 + (hgt) * 4 * u * (1 - u) * 0.6, p0.z + (p1.z - p0.z) * u);
        }
        pos.needsUpdate = true; L.line.geometry.computeBoundingSphere();
        var uu = (t * 0.6 + (hash(id) % 100) / 100) % 1;
        L.dot.position.set(p0.x + (p1.x - p0.x) * uu, 0.95 + hgt * 4 * uu * (1 - uu) * 0.6, p0.z + (p1.z - p0.z) * uu);
      });

      // partículas
      for (var fi = fx.length - 1; fi >= 0; fi--) {
        var f = fx[fi]; f.life -= dt;
        if (f.life <= 0) { scene.remove(f.m); f.m.material.dispose(); fx.splice(fi, 1); continue; }
        f.m.position.addScaledVector(f.v, dt);
        if (f.up) { f.v.y -= 3.2 * dt; f.m.rotation.x += f.spin * dt; f.m.rotation.z += f.spin * 0.7 * dt; }
        else f.m.scale.setScalar(1 + (1 - f.life / f.max) * 2.5);
        f.m.material.opacity = Math.min(1, f.life / f.max * 1.4);
      }
      renderer.render(scene, camera);
    }

    buildRooms();
    resize();
    setTimeout(loadModels, 50);
    return { draw: draw, rebuild: buildRooms, resize: resize, resetView: resetView, canvas: cvs };
  }
})();
