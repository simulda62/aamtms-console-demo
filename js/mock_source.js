// AAM TMS 내부 관제 화면 시안 - 가상 데이터 공급원
//
// 이 파일은 조회 API(판정 결과·이력 조회)를 대신하는 시안 전용 모사임.
// - 절차·버티포트·좌표·한계값·시나리오는 모두 가상 예시이며 실제 절차가 아님.
// - 판정 결과(status, items)는 판정 엔진 출력을 흉내 낸 각본 값임. 화면 코드는 이 값을 표시만 함.
// - 시각에 대한 결정적 함수로 계산하므로, 여러 창(멀티모니터)이 각자 계산해도 같은 결과가 나옴.
// 운영 단계에서는 이 파일을 조회 API 연결부로 교체함. 화면 코드의 나머지는 바꾸지 않는 것을 목표로 함.
(function () {
  const C = TMS.config;
  const LAT0 = C.MAP_CENTER[0], LON0 = C.MAP_CENTER[1];
  const M_LAT = 111320, M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
  const KT = 0.514444; // m/s
  // 가상 경로는 기준점 남쪽(육지) 위주로 배치함(북쪽 좌표를 뒤집음)
  const toLL = (e, n) => [LAT0 + n / M_LAT, LON0 + e / M_LON];
  const SHIFT = (TMS.LOCATION && TMS.LOCATION.shift) || [0, 0];
  // 기본 노선은 7대가 이착륙 간격을 지킬 수 있도록 1.15배로 늘려 배치함
  const GEN_SCALE = 1.15;
  const flip = pt => [pt[0] * GEN_SCALE + SHIFT[0], -pt[1] * GEN_SCALE + SHIFT[1], pt[2]];

  const VERSIONS = { policy: 'POL-가상-0.3', ruleset: 'RULESET-가상-0.1' };

  const mkProc = p => ({ ...p, ll: p.pts.map(pt => toLL(pt[0], pt[1])), segCount: p.pts.length - 1 });
  const speedFor = alt => (alt >= 1200 ? 90 : alt >= 700 ? 75 : alt >= 300 ? 55 : 25);

  // 순환 경로 구성: 출발 → (이동) → 접근 → 지상 대기 → 출발 ...
  // dwellOf(vpId): 해당 버티포트 지상 대기(초). 기본 60초.
  function buildLoop(procs, dwellOf) {
    const nodes = [];
    procs.forEach((p, pi) => {
      const next = procs[(pi + 1) % procs.length];
      p.pts.forEach((pt, i) => {
        const last = i === p.pts.length - 1;
        if (!last) {
          nodes.push({ e: pt[0], n: pt[1], alt: pt[2], proc: p, seg: i, dwell: i === 0 && pt[2] === 0 ? (dwellOf ? dwellOf(p.vp) : 60) : 0 });
          return;
        }
        const nx = next.pts[0];
        if (nx[0] !== pt[0] || nx[1] !== pt[1]) nodes.push({ e: pt[0], n: pt[1], alt: pt[2], proc: null, seg: -1, dwell: 0 });
      });
    });
    let T = 0;
    nodes.forEach((nd, i) => {
      const nx = nodes[(i + 1) % nodes.length];
      const len = Math.hypot(nx.e - nd.e, nx.n - nd.n);
      const v0 = speedFor(nd.alt) * KT, v1 = speedFor(nx.alt) * KT;
      Object.assign(nd, {
        t0: T, len, v0, v1, nx, dur: len / ((v0 + v1) / 2),
        ue: (nx.e - nd.e) / len, un: (nx.n - nd.n) / len,
        hdg: (Math.atan2(nx.e - nd.e, nx.n - nd.n) * 180 / Math.PI + 360) % 360,
      });
      T += nd.dwell + nd.dur;
    });
    const period = T;
    // 버티포트 정차 구간. 지상 대기 구간을 입항(착륙)·출항(이륙)으로 봄.
    const stops = [];
    nodes.forEach((nd, i) => {
      if (!nd.dwell) return;
      let j = i;
      do { j = (j - 1 + nodes.length) % nodes.length; } while (!(nodes[j].proc && nodes[j].proc.kind === '접근' && nodes[j].seg === 0));
      let k = i;
      do { k = (k + 1) % nodes.length; } while (nodes[k].proc === nd.proc);
      const fin = nodes[(j + nodes[j].proc.segCount - 1) % nodes.length]; // 최종 접근 구간 시작
      const up = nodes[(i + 1) % nodes.length];                            // 첫 상승 구간 끝
      stops.push({
        vp: nd.proc.vp, arrProc: nodes[j].proc, depProc: nd.proc,
        tArr: nd.t0, dwell: nd.dwell,
        appDur: ((nd.t0 - nodes[j].t0) % period + period) % period,
        depDur: ((nodes[k].t0 - (nd.t0 + nd.dwell)) % period + period) % period,
        landDur: ((nd.t0 - fin.t0) % period + period) % period,             // 착륙 움직임 길이
        toDur: ((up.t0 - (nd.t0 + nd.dwell)) % period + period) % period,   // 이륙 움직임 길이
      });
    });
    stops.forEach((st, i) => {
      st.from = stops[(i - 1 + stops.length) % stops.length].vp;
      st.to = stops[(i + 1) % stops.length].vp;
    });
    return { nodes, period, stops };
  }

  let VERTIPORTS, PROCS, LOOPS;
  let HOLDS = [];
  let HOLD_AREAS = [];
  let VFR_POINTS = [];
  // 공중대기 경로(경주로형, 오른쪽 선회). 기점 F에서 접근 방향 u로 들어와 선회 → 바깥 직선 → 선회 → 안쪽 직선으로 F에 돌아옴.
  const HR = C.HOLD_TURN_RADIUS_M, HL = C.HOLD_LEG_M;
  const HOLD_LAP_M = 2 * Math.PI * HR + 2 * HL;
  const HOLD_V = C.HOLD_SPEED_KT * KT;
  const HOLD_LAP_SEC = HOLD_LAP_M / HOLD_V;
  function holdPos(h, s) {
    s = ((s % HOLD_LAP_M) + HOLD_LAP_M) % HOLD_LAP_M;
    const tw = h.turn || 1; // 1 오른쪽 선회, -1 왼쪽 선회
    const u = [h.ux, h.uy], r = [h.uy * tw, -h.ux * tw], F = [h.e, h.n];
    const C1 = [F[0] + HR * r[0], F[1] + HR * r[1]];
    const arc = Math.PI * HR;
    const pt = (x, y, dx, dy) => ({ e: x, n: y, hdg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 });
    if (s < arc) {
      const p = s / HR;
      return pt(C1[0] + HR * (-r[0] * Math.cos(p) + u[0] * Math.sin(p)), C1[1] + HR * (-r[1] * Math.cos(p) + u[1] * Math.sin(p)),
        r[0] * Math.sin(p) + u[0] * Math.cos(p), r[1] * Math.sin(p) + u[1] * Math.cos(p));
    }
    s -= arc;
    const P2 = [F[0] + 2 * HR * r[0], F[1] + 2 * HR * r[1]];
    if (s < HL) return pt(P2[0] - u[0] * s, P2[1] - u[1] * s, -u[0], -u[1]);
    s -= HL;
    const C2 = [C1[0] - u[0] * HL, C1[1] - u[1] * HL];
    if (s < arc) {
      const p = s / HR;
      return pt(C2[0] + HR * (r[0] * Math.cos(p) - u[0] * Math.sin(p)), C2[1] + HR * (r[1] * Math.cos(p) - u[1] * Math.sin(p)),
        -r[0] * Math.sin(p) - u[0] * Math.cos(p), -r[1] * Math.sin(p) - u[1] * Math.cos(p));
    }
    s -= arc;
    const P4 = [F[0] - u[0] * HL, F[1] - u[1] * HL];
    return pt(P4[0] + u[0] * s, P4[1] + u[1] * s, u[0], u[1]);
  }
  const NET = TMS.LOCATION && TMS.LOCATION.network;
  if (NET) {
    // 기준 위치에 정의된 노선망(가상): 중심 버티포트와 주변 섬 버티포트 간 왕복 노선
    VERTIPORTS = NET.vertiports.map(v => {
      const e = (v.ll[1] - LON0) * M_LON, n = (v.ll[0] - LAT0) * M_LAT;
      return { id: v.id, name: v.name, e, n, ll: v.ll.slice() };
    });
    const vp = Object.fromEntries(VERTIPORTS.map(v => [v.id, v]));
    PROCS = [];
    // 한 방향 노선: 출발 절차(2구간) + 접근 절차(3구간). 진행 방향 오른쪽으로 250m 띄워 왕복 경로가 겹치지 않게 함.
    // 공중대기 공역: 중심 버티포트 기준 방위·거리로 기점을 두고, 접근 방향(기점→중심)을 대기 경로의 안쪽 방향으로 씀
    const hubV = vp[NET.hub];
    // ---- 중심 버티포트 시계비행 국지절차(가상) ----
    const V = NET.vfr;
    const H0 = [hubV.e, hubV.n];
    const polar = (bearing, dist) => { const b = bearing * Math.PI / 180; return [H0[0] + Math.sin(b) * dist, H0[1] + Math.cos(b) * dist]; };
    VFR_POINTS = Object.entries(V.points).map(([id, p]) => { const q = polar(p.bearing, p.dist); return { id, e: q[0], n: q[1], ll: toLL(q[0], q[1]) }; });
    const pt = id => VFR_POINTS.find(x => x.id === id);
    const unit = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    // 출항 절차: 버티포트 → 상승 지점(1km, 500ft) → 보고점(출항 고도)
    const depProcs = {};
    Object.entries(V.departures).forEach(([id, vrp]) => {
      const P = pt(vrp), u = unit(H0, [P.e, P.n]);
      depProcs[id] = mkProc({ id, ver: '0.1', kind: '출발', vp: NET.hub, gate: vrp,
        pts: [[H0[0], H0[1], 0], [H0[0] + u[0] * V.gateDist, H0[1] + u[1] * V.gateDist, 500], [P.e, P.n, V.depAlt]] });
      PROCS.push(depProcs[id]);
    });
    // 공중대기점: 대기 경로 안쪽 방향은 버티포트 쪽, 경로는 바깥쪽으로 뻗음
    HOLDS = Object.entries(V.holds).map(([id, h]) => {
      const q = polar(h.bearing, h.dist), u0 = unit(q, H0);
      // 대기 경로 방향: 버티포트를 향하는 방향에서 rotate(도, 시계 방향 +)만큼 돌림
      const hd = Math.atan2(u0[0], u0[1]) + (h.rotate || 0) * Math.PI / 180;
      const u = [Math.sin(hd), Math.cos(hd)];
      const hold = { id, turn: h.turn === 'L' ? -1 : 1, e: q[0], n: q[1], ux: u[0], uy: u[1], ll: toLL(q[0], q[1]), alts: [] };
      const pat = [];
      for (let s2 = 0; s2 <= HOLD_LAP_M; s2 += 100) { const r2 = holdPos(hold, s2); pat.push(toLL(r2.e, r2.n)); }
      hold.pattern = pat;
      return hold;
    });
    // 입항 절차: 대기점 → 보고점(입항 고도) → 최종 접근점(1km, 300ft) → 착륙
    const arrDefs = {};
    Object.entries(V.arrivals).forEach(([id, a]) => {
      const P = pt(a.vrp), g = unit([P.e, P.n], H0);
      arrDefs[id] = { hold: HOLDS.find(h => h.id === a.hold), vrp: P, final: [H0[0] - g[0] * V.gateDist, H0[1] - g[1] * V.gateDist] };
    });
    const arrCache = {};
    const hubArr = (id, alt) => {
      const k = `${id}@${alt}`;
      if (arrCache[k]) return arrCache[k];
      const d = arrDefs[id];
      if (!d.hold.alts.includes(alt)) d.hold.alts.push(alt);
      const p = mkProc({ id, ver: '0.1', kind: '접근', vp: NET.hub, hold: d.hold.id, gate: d.vrp.id,
        pts: [[d.hold.e, d.hold.n, alt], [d.vrp.e, d.vrp.n, V.arrAlt], [d.final[0], d.final[1], 300], [H0[0], H0[1], 0]] });
      if (!Object.keys(arrCache).some(x => x.startsWith(`${id}@`))) PROCS.push(p); // 지도에는 절차당 한 번만 그림
      arrCache[k] = p;
      return p;
    };
    // 섬 방향 노선: 출항 보고점 → 섬 접근(섬은 단순 접근), 섬 출발 → 입항 대기점
    const islandArr = (x, from) => {
      const X = vp[x];
      const L = Math.hypot(X.e - from[0], X.n - from[1]), ux = (X.e - from[0]) / L, uy = (X.n - from[1]) / L;
      const at = d => [from[0] + ux * d, from[1] + uy * d];
      const p = mkProc({ id: `ARR-${x}`, ver: '0.1', kind: '접근', vp: x,
        pts: [[from[0], from[1], 1500], [...at(L - 2500), 800], [...at(L - 1000), 300], [X.e, X.n, 0]] });
      PROCS.push(p);
      return p;
    };
    const islandDep = (x, to, toAlt) => {
      const X = vp[x];
      const L = Math.hypot(to[0] - X.e, to[1] - X.n), ux = (to[0] - X.e) / L, uy = (to[1] - X.n) / L;
      const at = d => [X.e + ux * d, X.n + uy * d];
      const p = mkProc({ id: `DEP-${x}`, ver: '0.1', kind: '출발', vp: x,
        pts: [[X.e, X.n, 0], [...at(1200), 500], [...at(L * 0.5), 1000], [to[0], to[1], toAlt]] });
      PROCS.push(p);
      return p;
    };
    const legs = NET.destinations.map(x => {
      const r = V.routes[x];
      const dep = depProcs[r.dep];
      const vrp = dep.pts[dep.pts.length - 1];
      const arrHub = hubArr(r.arr, r.holdAlt);
      return [dep, islandArr(x, vrp), islandDep(x, [arrHub.pts[0][0], arrHub.pts[0][1]], r.holdAlt), arrHub];
    });
    // 운항 주기를 모든 노선에 같게 맞춤(중심 지상 대기 고정, 남는 시간은 섬 지상 대기)
    const hubDwell = C.HUB_TURNAROUND_SEC, islandMin = C.ISLAND_MIN_TURNAROUND_SEC;
    const base = legs.map(procs => buildLoop(procs, v => (v === NET.hub ? hubDwell : islandMin)).period);
    const cycle = Math.max(C.NETWORK_CYCLE_SEC, Math.ceil(Math.max(...base) / 60) * 60 + 120);
    LOOPS = legs.map((procs, i) => buildLoop(procs, v => (v === NET.hub ? hubDwell : islandMin + (cycle - base[i]))));
  } else {
    // 가상 버티포트 (위치 임의)
    VERTIPORTS = [
      { id: 'VP-A', e: -2500, n: 600 },
      { id: 'VP-B', e: 2800, n: -900 },
    ].map(v => {
      const e = v.e * GEN_SCALE + SHIFT[0], n = -v.n * GEN_SCALE + SHIFT[1];
      return { ...v, e, n, ll: toLL(e, n) };
    });
    // 가상 예시 절차. 경로점 [동(m), 북(m), 고도(ft)]. 구간 i = 경로점 i → i+1.
    PROCS = [
      { id: 'PRC-B-DEP', ver: '0.1', kind: '출발', vp: 'VP-B', pts: [[2800, -900, 0], [3800, -1800, 500], [5200, -3500, 1200], [6000, 500, 1500]] },
      { id: 'PRC-A-ARR', ver: '0.1', kind: '접근', vp: 'VP-A', pts: [[4000, 4200, 1500], [1500, 3000, 1200], [-1000, 1800, 800], [-2000, 1000, 400], [-2500, 600, 0]] },
      { id: 'PRC-A-DEP', ver: '0.1', kind: '출발', vp: 'VP-A', pts: [[-2500, 600, 0], [-3200, 1500, 500], [-4000, 3200, 1200], [-2000, 5000, 1500]] },
      { id: 'PRC-B-ARR', ver: '0.1', kind: '접근', vp: 'VP-B', pts: [[-4500, -3500, 1500], [-1500, -2800, 1100], [1200, -1600, 700], [2300, -1100, 300], [2800, -900, 0]] },
    ].map(p => mkProc({ ...p, pts: p.pts.map(flip) }));
    LOOPS = [buildLoop(PROCS, () => 25)];
  }
  const vpName = id => { const v = VERTIPORTS.find(x => x.id === id); return v && v.name ? v.name : id; };

  function routeAt(loop, tau) {
    const P = loop.period, nodes = loop.nodes;
    tau = ((tau % P) + P) % P;
    let nd = nodes[nodes.length - 1];
    for (let i = 0; i < nodes.length; i++) {
      if (tau < nodes[i].t0 + nodes[i].dwell + nodes[i].dur) { nd = nodes[i]; break; }
    }
    const lt = tau - nd.t0;
    if (lt < nd.dwell) return { e: nd.e, n: nd.n, alt: 0, gs: 0, vs: 0, hdg: nd.hdg, nd, ground: true, f: 0 };
    const t = lt - nd.dwell;
    const a = (nd.v1 - nd.v0) / nd.dur;
    const f = Math.min(1, (nd.v0 * t + 0.5 * a * t * t) / nd.len);
    return {
      e: nd.e + (nd.nx.e - nd.e) * f, n: nd.n + (nd.nx.n - nd.n) * f,
      alt: nd.alt + (nd.nx.alt - nd.alt) * f, gs: (nd.v0 + a * t) / KT,
      vs: (nd.nx.alt - nd.alt) / nd.dur * 60, hdg: nd.hdg, nd, ground: false, f,
    };
  }

  // 실증기 1대 + 가상기체 6대 (가상). 노선(순환 경로)에 차례로 배정하고 같은 노선 안에서는 간격을 고르게 둠.
  const IDS = ['R01', 'V01', 'V02', 'V03', 'V04', 'V05', 'V06'];
  const perLoop = LOOPS.map(() => []);
  IDS.forEach((id, i) => perLoop[i % LOOPS.length].push(id));
  // 출발 시각(위상) 배정: 버티포트마다 착륙·이륙 움직임이 겹치지 않도록(간격 PAD_SEPARATION_SEC) 차례로 고름.
  // 모든 노선의 주기가 같으므로 한 주기 안에서 겹치지 않으면 계속 겹치지 않음.
  const occupied = {}; // vp → [[시작, 끝], ...] (주기 내 시각)
  const SEP = C.PAD_SEPARATION_SEC;
  const movesOf = (loop, phase) => {
    const P = loop.period, m = x => ((x % P) + P) % P;
    return loop.stops.flatMap(st => [
      { vp: st.vp, s: m(st.tArr - st.landDur - phase), d: st.landDur, ac: loop },
      { vp: st.vp, s: m(st.tArr + st.dwell - phase), d: st.toDur, ac: loop },
    ]);
  };
  const clash = (a, b, P) => {
    // 원형 시간축(길이 P)에서 두 구간이 겹치지 않으면 앞뒤 빈틈의 합 + 두 길이 = P. 빈틈이 SEP보다 작으면 충돌.
    const gap1 = ((b.s - (a.s + a.d)) % P + P) % P;
    const gap2 = ((a.s - (b.s + b.d)) % P + P) % P;
    const disjoint = Math.abs(gap1 + gap2 + a.d + b.d - P) < 1e-6;
    return !disjoint || gap1 < SEP || gap2 < SEP;
  };
  const fits = (moves, P) => moves.every(mv => (occupied[mv.vp] || []).every(o => !clash(mv, o, P)));
  // 기준 순서: 중심 버티포트(노선망) 또는 첫 정차지의 착륙 시작을 주기를 기체 수로 나눈 시각에 맞추고,
  // 다른 버티포트에서 겹치면 앞뒤로 5초씩 옮겨 가며 찾음.
  const hubId = NET ? NET.hub : LOOPS[0].stops[0].vp;
  const AIRCRAFT = IDS.map((id, i) => {
    const li = i % LOOPS.length, loop = LOOPS[li], P = loop.period;
    const hs = loop.stops.find(st => st.vp === hubId) || loop.stops[0];
    const ideal = (hs.tArr - hs.landDur) - i * P / IDS.length;
    let phase = ideal;
    for (let k = 0; k < P / 5; k++) {
      const cand = ideal + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 5;
      if (fits(movesOf(loop, cand), P)) { phase = cand; break; }
    }
    movesOf(loop, phase).forEach(mv => (occupied[mv.vp] = occupied[mv.vp] || []).push({ ...mv, ac: id }));
    return { id, virtual: id[0] === 'V', type: id[0] === 'V' ? '가상기체' : '실증기(유인)', loop, phase };
  });
  const byId = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));

  // ---- 공중대기 ----
  // 기체가 섬에서 일찍 출발해 중심 버티포트 착륙 시각보다 먼저 도착하면 대기 기점에서 공중대기 후 정해진 시각에 착륙함.
  // 착륙 시각은 바뀌지 않으므로 이착륙 분리가 유지됨. 섬 이륙이 앞당겨지는 범위는 다른 기체와 겹치지 않게 제한함.
  AIRCRAFT.forEach(ac => {
    const lp = ac.loop;
    const n = lp.nodes;
    const fixIdx = n.findIndex(nd => nd.proc && nd.proc.hold && nd.seg === 0);
    if (fixIdx < 0) return;
    const island = lp.stops.find(st => st.vp !== n[fixIdx].proc.vp);
    const fixNode = n[fixIdx];
    ac.hold = {
      ref: HOLDS.find(h => h.id === fixNode.proc.hold), alt: fixNode.alt, fixNode,
      tauD: island.tArr + island.dwell, tauF: fixNode.t0, island, maxLaps: 0,
    };
  });
  (function assignMaxLaps() {
    const P = AIRCRAFT[0].loop.period;
    const occ2 = {};
    Object.entries(occupied).forEach(([vp, list]) => { occ2[vp] = list.map(x => ({ ...x })); });
    AIRCRAFT.forEach(ac => {
      if (!ac.hold) return;
      const st = ac.hold.island;
      const s0 = ((st.tArr + st.dwell - ac.phase) % P + P) % P;
      const list = occ2[st.vp] || [];
      const mine = list.find(x => x.ac === ac.id && Math.abs(x.s - s0) < 1e-6);
      const others = list.filter(x => x !== mine);
      for (let laps = 2; laps >= 0; laps--) {
        const H = laps * HOLD_LAP_SEC;
        const win = { s: ((s0 - H) % P + P) % P, d: st.toDur + H, ac: ac.id };
        if (laps === 0 || others.every(o => !clash(win, o, P))) {
          ac.hold.maxLaps = laps;
          if (mine) Object.assign(mine, win);
          break;
        }
      }
    });
  })();
  // 회차(m)별 공중대기 바퀴 수. 기체마다 10회차 묶음 안에서 2바퀴·1바퀴 횟수를 확률에 맞춰 고정하고 순서만 무작위로 섞음
  // (순수 무작위로 하면 짧은 시간대에 공중대기가 몰릴 수 있음). 결정적이라 모든 화면에서 같음.
  function holdLaps(ac, m) {
    if (!ac.hold || !ac.hold.maxLaps) return 0;
    const B = 10, blk = Math.floor(m / B), idx = ((m % B) + B) % B, ai = AC_INDEX[ac.id];
    const slots = Array.from({ length: B }, (_, i) => i);
    for (let i = B - 1; i > 0; i--) { const j = Math.floor(rnd(blk, ai, 20 + i) * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    const n2 = ac.hold.maxLaps >= 2 ? Math.round(C.HOLD_PROB_2 * B) : 0;
    const n1 = Math.round(C.HOLD_PROB_1 * B) + (ac.hold.maxLaps >= 2 ? 0 : Math.round(C.HOLD_PROB_2 * B));
    const rank = slots.indexOf(idx);
    return rank < n2 ? 2 : rank < n2 + n1 ? 1 : 0;
  }
  // 기체 위치(공중대기 반영)
  function routeWithHold(ac, t) {
    const P = ac.loop.period;
    const tau = t / 1000 + ac.phase;
    const m = Math.floor(tau / P);
    const x = tau - m * P;
    const h = ac.hold;
    const laps = h ? holdLaps(ac, m) : 0;
    if (laps) {
      const H = laps * HOLD_LAP_SEC;
      if (x >= h.tauD - H && x < h.tauF - H) return { ...routeAt(ac.loop, x + H), holdEdge: (h.tauF - H) - x };
      if (x >= h.tauF - H && x < h.tauF) {
        const el = x - (h.tauF - H);
        const q = holdPos(h.ref, el * HOLD_V);
        const nd = h.fixNode;
        return {
          e: q.e, n: q.n, alt: h.alt, gs: C.HOLD_SPEED_KT, vs: 0, hdg: q.hdg, nd, ground: false, f: 0,
          holding: { fix: h.ref.id, lap: Math.min(laps, Math.floor(el / HOLD_LAP_SEC) + 1), laps, until: (m * P + h.tauF - ac.phase) * 1000 },
        };
      }
    }
    const r0 = routeAt(ac.loop, x);
    if (laps && x >= h.tauF) r0.holdEdge = x - h.tauF;
    return r0;
  }

  // 시연 상황(가상). 기체마다 SCENARIO_SLOT_SEC 단위로 발생 여부·종류·지속 시간·시작 시점을 무작위로 정함.
  // 시각에 대한 결정적 난수라서 여러 창·여러 사람이 같은 시각에 같은 상황을 봄.
  // [종류, 비중, 최소 지속(초), 최대 지속(초)]
  const KINDS = [
    ['tlm_loss', 3, 15, 25],
    ['link_loss', 2.5, 20, 40], // 텔레메트리 링크 하나 두절(이중 구성은 남은 링크로 수신 유지)
    ['speed', 3, 20, 30],
    ['lateral', 2, 30, 40],
    ['adsb_mismatch', 1.5, 15, 25],
    ['loss', 1, 10, 16],
    ['descent', 0.5, 14, 14],
  ];
  const WSUM = KINDS.reduce((a, k) => a + k[1], 0);
  const AC_INDEX = Object.fromEntries(IDS.map((id, i) => [id, i]));
  function rnd(a, b, c) {
    let h = Math.imul(a, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 7, 2246822519) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function activeEvent(id, t) {
    const SLOT = C.SCENARIO_SLOT_SEC;
    const sec = t / 1000;
    const slot = Math.floor(sec / SLOT);
    const ai = AC_INDEX[id];
    if (rnd(slot, ai, 1) >= C.SCENARIO_EVENT_PROB) return null;
    let r = rnd(slot, ai, 2) * WSUM;
    let kind = KINDS[0];
    for (const k of KINDS) { if ((r -= k[1]) < 0) { kind = k; break; } }
    const dur = Math.round(kind[2] + rnd(slot, ai, 3) * (kind[3] - kind[2]));
    const a = Math.floor(rnd(slot, ai, 4) * (SLOT - dur));
    const u = sec - slot * SLOT - a;
    if (u < 0 || u >= dur) return null;
    return { kind: kind[0], u, dur, start: (slot * SLOT + a) * 1000, pick: rnd(slot, ai, 6) };
  }
  const inWin = (w, t) => w && t >= w.from && t < w.to;

  // 수신 두절 시작 시각(두절 중이 아니면 null)
  function lossStart(id, t, ov) {
    const ev = activeEvent(id, t);
    if (ev && ev.kind === 'loss') return ev.start;
    const w = ov && ov.loss && ov.loss[id];
    if (inWin(w, t)) return w.from;
    return null;
  }

  function kin(ac, t) {
    const r = routeWithHold(ac, t);
    const ev = activeEvent(ac.id, t);
    // 경로 이탈 폭은 저고도(700ft 미만)에서 줄어 착륙·지상에서는 0이 됨
    const lowFade = Math.max(0, Math.min(1, (r.alt - 700) / 400));
    // 공중대기 중에는 경로 이탈 없음. 대기 진입 전·후 20초 동안 이탈 폭을 서서히 줄이고 늘림
    const holdFade = r.holdEdge == null ? 1 : Math.max(0, Math.min(1, r.holdEdge / 20));
    // 경로가 꺾이는 경로점 앞뒤 400m에서는 이탈 폭을 줄여 모퉁이에서 위치가 튀지 않게 함
    const cornerFade = r.holding || r.ground ? 0 : Math.max(0, Math.min(1, Math.min(r.f * r.nd.len, (1 - r.f) * r.nd.len) / 400));
    const off = ev && ev.kind === 'lateral' && !r.holding ? 320 * Math.sin(Math.PI * ev.u / ev.dur) * lowFade * holdFade * cornerFade : 0;
    const e = r.e + r.nd.un * off, n = r.n - r.nd.ue * off;
    const vs = ev && ev.kind === 'descent' && !r.ground ? -1500 : r.vs;
    const gs = ev && ev.kind === 'speed' && !r.ground ? r.gs + 30 : r.gs;
    return { ...r, e, n, off, vs, gs, ev };
  }

  const mismatchM = ev => 450 * Math.min(1, ev.u / 2);

  // 텔레메트리 링크 상태: 구성(이중/단일)과 두절된 링크
  const linksOf = ac => (C.TLM_LINKS && C.TLM_LINKS[ac.id]) || ['LORA'];
  const linkLabel = name => (C.TLM_LINK_LABEL && C.TLM_LINK_LABEL[name]) || name;
  function tlmState(ac, ev) {
    const links = linksOf(ac);
    let lost = [];
    if (ev && ev.kind === 'tlm_loss') lost = links.slice();
    if (ev && ev.kind === 'link_loss') lost = [links[Math.min(links.length - 1, Math.floor(ev.pick * links.length))]];
    return { links, lost, allLost: lost.length === links.length, dual: links.length > 1 };
  }

  // 판정 항목 (기획서 7장 판정 항목).
  // 규칙 이름은 interfaces/rule_catalog.toml, 요구사항 번호는 docs/requirements.md(가안)를 따름.
  // 규칙이 아직 없는 항목은 '미등록'으로 두며 결과는 '미적용'으로 표시함.
  const ITEM_DEFS = [
    ['lateral', '경로 이탈', 'cross_track', 'REQ-ENG-010'],
    ['altitude', '고도 편차', 'altitude_deviation', 'REQ-ENG-011'],
    ['speed', '속도 범위', 'ground_speed', 'REQ-ENG-012'],
    ['descent', '강하율', 'vertical_speed', 'REQ-ENG-013'],
    ['separation', '기체 간 간격', 'horizontal_separation', 'REQ-ENG-014'],
    ['link', '통신·데이터 상태', 'POLICY_RULE_MISMATCH / SINGLE_SOURCE', 'REQ-ENG-007'],
    ['schedule', '일정 준수', '미등록', '—'],
    ['weather', '환경 조건', '미등록', '—'],
    ['pad', '착륙장 상태', '미등록', '—'],
    ['transition', '중단접근·전환 수행', '미등록', '—'],
  ];

  function evalItems(ac, t, k, nearestM) {
    const ev = k.ev;
    const r = {};
    const set = (key, status, value) => { r[key] = { status, value }; };
    const off = Math.abs(k.off);
    set('lateral', ev && ev.kind === 'lateral' ? (off < 80 ? 'normal' : off < 180 ? 'caution' : 'warning') : 'normal', `${off.toFixed(0)} m`);
    const altDev = 12 * Math.sin(t / 7000 + ac.phase);
    set('altitude', 'normal', `${altDev >= 0 ? '+' : ''}${altDev.toFixed(0)} ft`);
    set('speed', ev && ev.kind === 'speed' && !k.ground ? 'caution' : 'normal', `${k.gs.toFixed(0)} kt`);
    let ds = 'normal';
    if (ev && ev.kind === 'descent' && !k.ground) ds = ev.u < 4 ? 'warning' : 'emergency';
    set('descent', ds, `${k.vs.toFixed(0)} fpm`);
    set('separation', 'normal', nearestM == null ? '—' : `${(nearestM / 1000).toFixed(2)} km`);
    let ls = 'normal', lv = '두 경로 정상';
    const ts = tlmState(ac, ev);
    if (ts.allLost) { ls = 'caution'; lv = '텔레메트리 두절, ADS-B 단독 감시'; }
    else if (ts.lost.length) { ls = 'caution'; lv = `${linkLabel(ts.lost[0])} 두절, ${linkLabel(ts.links.find(l => !ts.lost.includes(l)))} 단독(이중화 상실)`; }
    if (ev && ev.kind === 'adsb_mismatch') { ls = 'warning'; lv = `경로 간 위치 차 ${mismatchM(ev).toFixed(0)} m`; }
    set('link', ls, lv);
    // 이중화 상실은 판정 엔진의 정책 규칙 POLICY_RULE_LINK_REDUNDANCY로 옴(수준은 정책값 link_redundancy_level, 시안은 주의)
    if (ts.lost.length && !ts.allLost && !(ev && ev.kind === 'adsb_mismatch')) r.link.rule = 'POLICY_RULE_LINK_REDUNDANCY';
    set('schedule', 'na', '대응표 미입력');
    set('weather', 'na', '대응표 미입력');
    set('pad', 'na', '대응표 미입력');
    set('transition', 'na', '대응표 미입력');

    let status = 'normal', cause = null;
    const items = ITEM_DEFS.map(([key, label, rule, req]) => {
      const it = { key, label, rule, req, ...r[key] };
      if (it.status !== 'na' && TMS.STATUS[it.status].rank < TMS.STATUS[status].rank) { status = it.status; cause = label; }
      return it;
    });
    return { status, cause, items };
  }

  function buildRecord(ac, t, ov) {
    const k = kin(ac, t);
    const [lat, lon] = toLL(k.e, k.n);
    let nearest = Infinity;
    AIRCRAFT.forEach(o => {
      if (o === ac) return;
      const ko = kin(o, t);
      nearest = Math.min(nearest, Math.hypot(ko.e - k.e, ko.n - k.n));
    });
    const j = evalItems(ac, t, k, nearest);
    const ev = k.ev;

    // 입력 경로 (텔레메트리 0.2초, ADS-B 0.5초 갱신 가정)
    // 경로·링크 이름은 조회 API 상태 JSON(interfaces/api_format.md)을 따름:
    //   paths 키 ADSB·TELEMETRY/LORA·TELEMETRY/MANET, fused.links.LORA·MANET {age_ms, missed_cycles}(받은 적 없으면 null),
    //   이중화 상실은 판정 사유 LINK_REDUNDANCY_LOST
    // 끊긴 링크는 마지막 수신 위치를 유지함
    const ts = tlmState(ac, ev);
    const tlmPaths = {};
    const links = { LORA: null, MANET: null };
    ts.links.forEach(name => {
      const lost = ts.lost.includes(name);
      const tl = lost ? ev.start : t;
      const kl = lost ? kin(ac, ev.start) : k;
      const ll = lost ? toLL(kl.e, kl.n) : [lat, lon];
      tlmPaths[`TELEMETRY/${name}`] = { state: lost ? 'lost' : 'ok', t_last: tl, lat: ll[0], lon: ll[1], alt_ft: kl.alt };
      links[name] = { age_ms: t - tl, missed_cycles: Math.floor((t - tl) / 200) };
    });
    const reasons = ts.dual && ts.lost.length && !ts.allLost ? ['LINK_REDUNDANCY_LOST'] : [];
    const ta = Math.floor(t / 500) * 500;
    const ka = kin(ac, ta);
    let ae = ka.e, an = ka.n;
    if (ev && ev.kind === 'adsb_mismatch') { const m = mismatchM(ev); ae += m * 0.8; an += m * 0.6; }
    const all = toLL(ae, an);
    const adsb = { state: 'ok', t_last: ta, lat: all[0], lon: all[1], alt_ft: ka.alt };
    let fusion;
    if (ev && ev.kind === 'adsb_mismatch') fusion = { flag: 'mismatch', diff_m: mismatchM(ev) };
    else if (ts.allLost) fusion = { flag: 'single', diff_m: null };
    else fusion = { flag: 'ok', diff_m: 5 + 3 * Math.sin(t / 3000 + ac.phase) };

    let proc;
    if (k.holding) proc = { id: k.nd.proc.id, ver: k.nd.proc.ver, kind: '공중대기', vp: k.nd.proc.vp, seg: k.nd.seg, segCount: k.nd.proc.segCount, segFrac: 0, hold: k.holding, label: `공중대기 ${k.holding.fix} (${k.holding.lap}/${k.holding.laps}바퀴)` };
    else if (k.ground) proc = { id: null, label: `${k.nd.proc.vp} 지상 대기` };
    else if (k.nd.proc) proc = { id: k.nd.proc.id, ver: k.nd.proc.ver, kind: k.nd.proc.kind, vp: k.nd.proc.vp, seg: k.nd.seg, segCount: k.nd.proc.segCount, segFrac: k.f, label: `${k.nd.proc.id} · S${k.nd.seg + 1}` };
    else proc = { id: null, label: '이동 구간(절차 외)' };

    const sigBad = ov && ov.sig && inWin(ov.sig[ac.id], t);
    return {
      id: ac.id, virtual: ac.virtual, type: ac.type, t, info_state: 'valid',
      status: j.status, cause: j.cause, items: j.items, reasons,
      fused: { lat, lon, alt_ft: k.alt, gs_kt: k.gs, vs_fpm: k.vs, hdg: k.hdg, ground: k.ground, links },
      paths: { ADSB: adsb, ...tlmPaths }, fusion, proc,
      // 기체별 텔레메트리 구성: 배정 tlm_links·운항계획 telemetryLinks에 있으나 조회 API 상태 JSON에는 아직 없음(화면 요청 항목)
      telemetry_links: ts.links,
      versions: { procedure: proc.id ? `${proc.id} v${proc.ver}` : '—', policy: VERSIONS.policy, ruleset: VERSIONS.ruleset },
      sig: sigBad ? 'mock-tampered' : 'mock-valid',
    };
  }

  // 최신 판정 결과 조회 (조회 API 모사)
  function sample(t, ov) {
    if (ov && ov.feedDown) return { ok: false, t };
    return {
      ok: true, t,
      receivers: { adsb: 'ok', lora: 'ok', manet: 'ok' },
      records: AIRCRAFT.map(ac => {
        const s = lossStart(ac.id, t, ov);
        if (s == null) return buildRecord(ac, t, ov);
        // 두절 직후에는 새 판정이 없고(마지막 판정 유지), 기준 주기 수를 넘으면 판정 엔진이 정보 없음(NO_INFO)을 냄
        if (!TMS.isStale(t - s)) return buildRecord(ac, s, ov);
        return { id: ac.id, virtual: ac.virtual, type: ac.type, t, info_state: 'no_info', status: null, sig: 'mock-valid' };
      }),
    };
  }

  // 판정 상태 (이력 계산용). 수신 두절이 정보 없음 기준을 넘으면 nodata.
  function statusOf(id, t, ov) {
    const ac = byId[id];
    const s = lossStart(id, t, ov);
    if (s != null && TMS.isStale(t - s)) return { status: 'nodata', cause: '수신 두절' };
    const tt = s != null ? s : t;
    const j = evalItems(ac, tt, kin(ac, tt), null);
    return { status: j.status, cause: j.cause };
  }

  // 상태 전환 이력 조회 (기록 조회 모사). (t0, t1] 구간
  function events(t0, t1, ov) {
    const out = [];
    const step = C.TICK_MS;
    const start = Math.floor(t0 / step) * step;
    AIRCRAFT.forEach(ac => {
      let prev = statusOf(ac.id, start, ov).status;
      for (let t = start + step; t <= t1; t += step) {
        const cur = statusOf(ac.id, t, ov);
        if (cur.status !== prev) {
          out.push({ id: `${ac.id}@${t}@${cur.status}`, t, ac: ac.id, virtual: ac.virtual, from: prev, to: cur.status, cause: cur.status === 'normal' ? '해제' : cur.cause });
          prev = cur.status;
        }
      }
    });
    return out.sort((a, b) => a.t - b.t);
  }

  // 항적 조회 (기록 조회 모사)
  function track(id, t0, t1, step, ov) {
    const ac = byId[id];
    const out = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      if (lossStart(id, t, ov) != null) continue;
      const k = kin(ac, t);
      const ll = toLL(k.e, k.n);
      out.push([t, ll[0], ll[1]]);
    }
    return out;
  }

  // 서명 검증 (시안: 모사 값 비교). 운영에서는 게이트웨이·조회 API 서명 방식 확정 후 교체.
  function verify(rec) { return rec.sig === 'mock-valid'; }

  // 버티포트 운항일정 조회(가상). [t0, t1] 구간의 입항·출항.
  // 계획 시각은 각본상 지연(0~3분, 일부 조기)을 뺀 분 단위 값이며, 예상·실제 시각은 모사 비행 시각임.
  const DELAYS = [0, 0, 60, 0, 120, -60, 0, 180];
  function schedule(vp, t0, t1) {
    const arrivals = [], departures = [];
    AIRCRAFT.forEach((ac, ai) => {
      const P = ac.loop.period;
      ac.loop.stops.forEach((st, si) => {
        if (st.vp !== vp) return;
        const base = st.tArr - ac.phase;
        const m0 = Math.floor((t0 / 1000 - base - P) / P);
        const m1 = Math.ceil((t1 / 1000 - base + P) / P);
        for (let m = m0; m <= m1; m++) {
          const tArr = (base + m * P) * 1000;
          const tDep = tArr + st.dwell * 1000;
          const key = (ai * 31 + si * 7 + ((m % 97) + 97)) % DELAYS.length;
          const off = DELAYS[key] * 1000;
          const plan = t => Math.round((t - off) / 60000) * 60000;
          // 공중대기: 중심 착륙(이 회차 시작 시각 = 직전 회차 귀환)과 섬 출발(이 회차)에 반영
          const hd = ac.hold;
          const isHub = hd && st.arrProc.hold;
          const lapsArr = isHub ? holdLaps(ac, m - 1) : 0;
          const lapsDep = hd && st === hd.island ? holdLaps(ac, m) : 0;
          if (tArr >= t0 && tArr <= t1) {
            const H = lapsArr * HOLD_LAP_SEC * 1000;
            const fixAt = isHub ? tArr - (P - hd.tauF) * 1000 : null;
            arrivals.push({ id: `${ac.id}@A${tArr}`, ac: ac.id, virtual: ac.virtual, vp, from: st.from, proc: st.arrProc.id,
              plan: plan(tArr), tStart: tArr - st.appDur * 1000, tEvent: tArr, landMs: st.landDur * 1000,
              hold: lapsArr ? { fix: st.arrProc.hold, laps: lapsArr, start: fixAt - H, end: fixAt, lapMs: HOLD_LAP_SEC * 1000 } : null });
          }
          const tDepAct = tDep - lapsDep * HOLD_LAP_SEC * 1000;
          if (tDepAct >= t0 && tDepAct <= t1) {
            departures.push({ id: `${ac.id}@D${tDep}`, ac: ac.id, virtual: ac.virtual, vp, to: st.to, proc: st.depProc.id,
              plan: plan(tDep), tPad: tArr, tEvent: tDepAct, tEnd: tDepAct + st.depDur * 1000, toMs: st.toDur * 1000, early: lapsDep > 0 });
          }
        }
      });
    });
    const by = (a, b) => a.tEvent - b.tEvent;
    return { arrivals: arrivals.sort(by), departures: departures.sort(by) };
  }

  // 검증용: 버티포트별 이착륙 움직임 목록(주기 내 시각)과 최소 간격
  function padCheck() {
    const out = {};
    Object.entries(occupied).forEach(([vp, list]) => {
      const P = AIRCRAFT[0].loop.period;
      const xs = list.slice().sort((a, b) => a.s - b.s);
      let minGap = Infinity;
      // 서로 다른 기체 사이의 간격만 봄(같은 기체의 착륙→이륙은 동시에 일어날 수 없음)
      xs.forEach((a, i) => { const b = xs[(i + 1) % xs.length]; if (a.ac === b.ac) return; const g = ((b.s - (a.s + a.d)) % P + P) % P; minGap = Math.min(minGap, g); });
      out[vp] = { moves: xs.length, minGapSec: Math.round(minGap) };
    });
    return out;
  }

  TMS.mock = { AIRCRAFT, PROCS, VERTIPORTS, HOLDS, HOLD_AREAS, VFR_POINTS, HOLD_LAP_SEC, VERSIONS, ITEM_DEFS, sample, events, track, verify, toLL, schedule, vpName, padCheck };
})();
