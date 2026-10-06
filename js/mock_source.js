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
  const flip = pt => [pt[0] + SHIFT[0], -pt[1] + SHIFT[1], pt[2]];

  const VERSIONS = { policy: 'POL-가상-0.3', ruleset: 'RULESET-가상-0.1' };

  // 가상 버티포트 (위치 임의)
  const VERTIPORTS = [
    { id: 'VP-A', e: -2500, n: 600 },
    { id: 'VP-B', e: 2800, n: -900 },
  ].map(v => {
    const e = v.e + SHIFT[0], n = -v.n + SHIFT[1];
    return { ...v, e, n, ll: toLL(e, n) };
  });

  // 가상 예시 절차. 경로점 [동(m), 북(m), 고도(ft)]. 구간 i = 경로점 i → i+1.
  const PROCS = [
    { id: 'PRC-B-DEP', ver: '0.1', kind: '출발', vp: 'VP-B', pts: [[2800, -900, 0], [3800, -1800, 500], [5200, -3500, 1200], [6000, 500, 1500]] },
    { id: 'PRC-A-ARR', ver: '0.1', kind: '접근', vp: 'VP-A', pts: [[4000, 4200, 1500], [1500, 3000, 1200], [-1000, 1800, 800], [-2000, 1000, 400], [-2500, 600, 0]] },
    { id: 'PRC-A-DEP', ver: '0.1', kind: '출발', vp: 'VP-A', pts: [[-2500, 600, 0], [-3200, 1500, 500], [-4000, 3200, 1200], [-2000, 5000, 1500]] },
    { id: 'PRC-B-ARR', ver: '0.1', kind: '접근', vp: 'VP-B', pts: [[-4500, -3500, 1500], [-1500, -2800, 1100], [1200, -1600, 700], [2300, -1100, 300], [2800, -900, 0]] },
  ].map(p => {
    const pts = p.pts.map(flip);
    return { ...p, pts, ll: pts.map(pt => toLL(pt[0], pt[1])), segCount: pts.length - 1 };
  });

  // 순환 경로 구성: 출발 → (이동) → 접근 → 지상 대기 → 출발 ...
  const speedFor = alt => (alt >= 1200 ? 90 : alt >= 700 ? 75 : alt >= 300 ? 55 : 25);
  const nodes = [];
  PROCS.forEach((p, pi) => {
    const next = PROCS[(pi + 1) % PROCS.length];
    p.pts.forEach((pt, i) => {
      const last = i === p.pts.length - 1;
      if (!last) {
        nodes.push({ e: pt[0], n: pt[1], alt: pt[2], proc: p, seg: i, dwell: i === 0 && pt[2] === 0 ? 25 : 0 });
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
  const PERIOD = T;

  function routeAt(tau) {
    tau = ((tau % PERIOD) + PERIOD) % PERIOD;
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

  // 실증기 1대 + 가상기체 6대 (가상)
  const AIRCRAFT = ['R01', 'V01', 'V02', 'V03', 'V04', 'V05', 'V06'].map((id, i) => ({
    id, virtual: id[0] === 'V', type: id[0] === 'V' ? '가상기체' : '실증기(유인)', phase: i * PERIOD / 7,
  }));
  const byId = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));

  // 시연 각본 (가상). 240초 주기로 반복. a~b: 주기 내 시각(초)
  const D = 240;
  const SCRIPT = {
    R01: [{ a: 20, b: 35, kind: 'tlm_loss' }, { a: 130, b: 150, kind: 'adsb_mismatch' }],
    V01: [{ a: 60, b: 100, kind: 'lateral' }],
    V02: [{ a: 170, b: 182, kind: 'loss' }],
    V03: [{ a: 100, b: 118, kind: 'descent' }],
    V04: [{ a: 200, b: 225, kind: 'speed' }],
  };
  function activeEvent(id, t) {
    const list = SCRIPT[id];
    if (!list) return null;
    const c = (((t / 1000) % D) + D) % D;
    for (const ev of list) {
      if (c >= ev.a && c < ev.b) {
        const start = Math.round((t - (c - ev.a) * 1000) / C.TICK_MS) * C.TICK_MS;
        return { ...ev, u: c - ev.a, dur: ev.b - ev.a, start };
      }
    }
    return null;
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
    const r = routeAt(t / 1000 + ac.phase);
    const ev = activeEvent(ac.id, t);
    const off = ev && ev.kind === 'lateral' ? 320 * Math.sin(Math.PI * ev.u / ev.dur) : 0;
    const e = r.e + r.nd.un * off, n = r.n - r.nd.ue * off;
    const vs = ev && ev.kind === 'descent' && !r.ground ? -1500 : r.vs;
    const gs = ev && ev.kind === 'speed' && !r.ground ? r.gs + 30 : r.gs;
    return { ...r, e, n, off, vs, gs, ev };
  }

  const mismatchM = ev => 450 * Math.min(1, ev.u / 2);

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
    if (ev && ev.kind === 'descent' && !k.ground) ds = ev.u < 4 || ev.u >= 14 ? 'warning' : 'emergency';
    set('descent', ds, `${k.vs.toFixed(0)} fpm`);
    set('separation', 'normal', nearestM == null ? '—' : `${(nearestM / 1000).toFixed(2)} km`);
    let ls = 'normal', lv = '두 경로 정상';
    if (ev && ev.kind === 'tlm_loss') { ls = 'caution'; lv = '텔레메트리 두절, ADS-B 단독 감시'; }
    if (ev && ev.kind === 'adsb_mismatch') { ls = 'warning'; lv = `경로 간 위치 차 ${mismatchM(ev).toFixed(0)} m`; }
    set('link', ls, lv);
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

    // 두 입력 경로 (텔레메트리 0.2초, ADS-B 0.5초 갱신 가정)
    let tlm;
    if (ev && ev.kind === 'tlm_loss') {
      const kl = kin(ac, ev.start);
      const ll = toLL(kl.e, kl.n);
      tlm = { state: 'lost', t_last: ev.start, lat: ll[0], lon: ll[1], alt_ft: kl.alt };
    } else {
      tlm = { state: 'ok', t_last: t, lat, lon, alt_ft: k.alt };
    }
    const ta = Math.floor(t / 500) * 500;
    const ka = kin(ac, ta);
    let ae = ka.e, an = ka.n;
    if (ev && ev.kind === 'adsb_mismatch') { const m = mismatchM(ev); ae += m * 0.8; an += m * 0.6; }
    const all = toLL(ae, an);
    const adsb = { state: 'ok', t_last: ta, lat: all[0], lon: all[1], alt_ft: ka.alt };
    let fusion;
    if (ev && ev.kind === 'adsb_mismatch') fusion = { flag: 'mismatch', diff_m: mismatchM(ev) };
    else if (tlm.state !== 'ok') fusion = { flag: 'single', diff_m: null };
    else fusion = { flag: 'ok', diff_m: 5 + 3 * Math.sin(t / 3000 + ac.phase) };

    let proc;
    if (k.ground) proc = { id: null, label: `${k.nd.proc.vp} 지상 대기` };
    else if (k.nd.proc) proc = { id: k.nd.proc.id, ver: k.nd.proc.ver, kind: k.nd.proc.kind, vp: k.nd.proc.vp, seg: k.nd.seg, segCount: k.nd.proc.segCount, segFrac: k.f, label: `${k.nd.proc.id} · S${k.nd.seg + 1}` };
    else proc = { id: null, label: '이동 구간(절차 외)' };

    const sigBad = ov && ov.sig && inWin(ov.sig[ac.id], t);
    return {
      id: ac.id, virtual: ac.virtual, type: ac.type, t, info_state: 'valid',
      status: j.status, cause: j.cause, items: j.items,
      fused: { lat, lon, alt_ft: k.alt, gs_kt: k.gs, vs_fpm: k.vs, hdg: k.hdg, ground: k.ground },
      paths: { adsb, tlm }, fusion, proc,
      versions: { procedure: proc.id ? `${proc.id} v${proc.ver}` : '—', policy: VERSIONS.policy, ruleset: VERSIONS.ruleset },
      sig: sigBad ? 'mock-tampered' : 'mock-valid',
    };
  }

  // 최신 판정 결과 조회 (조회 API 모사)
  function sample(t, ov) {
    if (ov && ov.feedDown) return { ok: false, t };
    return {
      ok: true, t,
      receivers: { adsb: 'ok', lora: 'ok' },
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

  TMS.mock = { AIRCRAFT, PROCS, VERTIPORTS, VERSIONS, ITEM_DEFS, sample, events, track, verify, toLL, PERIOD };
})();
