// AAM TMS 관제 화면 - 제어 모드 데이터 공급원(ABFAP 항적 전송 수신)
//
// 제어 모드(?mode=control)에서만 동작하며, 데모 각본(mock_source.js)과 같은 자리(TMS.mock)에 꽂혀 같은 조회 함수를 제공함.
// - 원천: ABFAP(AeroBalance-Flight-Dashboard) track_export가 수신기로 1초마다 보낸 최신 스냅샷. 화면은 같은 출처의
//   상대 경로(config CONTROL_SNAPSHOT_URL)로 조회하며 접속 정보(주소·키)는 화면 코드에 넣지 않음.
// - ABFAP 항적은 판정 결과가 아님: 판정 단계를 지어내지 않고 상태를 '판정 없음(외부 항적)'(external)으로 둠.
// - 정보 없음: 마지막으로 그 항적이 든 스냅샷을 수신기가 받은 뒤 CONTROL_STALE_MS가 지나면 정보 없음(위치 숨김).
//   수신기 연결이 끊기면 새 값이 오지 않으므로 모든 항적이 같은 기준으로 정보 없음이 됨.
// - 기체 키: ABFAP에는 ICAO 24비트 주소가 없으므로 callsign(없으면 model)을 기체 키로 씀.
// - 단위 변환: alt_ft→m, kt→m/s, Unix 초→표시 시각(온톨로지는 ns). 원래 값(ft·kt)도 함께 둠.
// - 재생: 수신기는 최신 1건만 두므로, 이 창이 연 뒤 받은 스냅샷을 창 메모리에 최근 30분까지 두고 재생에 씀.
(function () {
  if (!TMS.CONTROL) return;
  const C = TMS.config, DEMO = TMS.mock;
  const FT = 0.3048, KT = 1852 / 3600;
  const WINDOW_MS = C.REPLAY_WINDOW_SEC * 1000;

  // 출처(source) 구분. replay는 ABFAP가 저장된 비행을 현재 시각으로 옮겨 다시 보내는 재생 항적임
  const SOURCES = {
    xplane: { label: 'X-Plane', short: 'X', type: 'X-Plane 자기 항적', note: 'ABFAP 활성 비행 세션의 X-Plane 비행' },
    absim: { label: 'ABSim', short: 'A', type: 'ABSim 모델 항적', note: 'ABSim-Dashboard 모델(ABFAP 경유)' },
    replay: { label: '재생', short: 'R', type: 'ABFAP 재생 항적', note: '저장된 비행을 현재 시각으로 옮겨 다시 보내는 항적. 실시간 기체가 아님' },
  };

  const AIRCRAFT = [];
  const byId = {};
  let acVersion = 0;
  const timeline = []; // 조회 결과 {t, ok, snap, err, http}(최근 30분)
  const tracks = {};   // 기체 키 → [[수신 시각, 위도, 경도], ...]
  const lastIn = {};   // 기체 키 → 마지막으로 스냅샷에 든 수신 시각(화면 시계 기준)
  const log = [];      // 상태 전환 이력(정보 없음 ↔ 수신)
  const prevSt = {};
  let logT = 0;
  let lastSnap = null;
  const info = { tries: 0, okCount: 0, lastOk: 0, lastErr: null, http: null, keyConfigured: null, stats: null, seenData: false };

  // 기체 키: callsign(없으면 model). 화면 식별자로 쓰므로 영문·숫자·_.-만 남기고 32자로 자름
  const safeKey = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const mul = (v, k) => (v == null ? null : v * k);

  function ensureAc(id, tr) {
    let a = byId[id];
    if (!a) {
      a = { id, virtual: false };
      AIRCRAFT.push(a);
      byId[id] = a;
      acVersion++;
    }
    const src = SOURCES[tr.source];
    a.source = tr.source;
    a.replay = tr.source === 'replay';
    a.type = src.type;
    a.callsign = tr.callsign || null;
    a.model = tr.model || null;
    return a;
  }

  function toRecord(tr, id, t, snap) {
    const alt_ft = num(tr.alt_ft), gs_kt = num(tr.speed_kt), hdg = num(tr.heading);
    const tsMs = num(tr.ts) == null ? null : tr.ts * 1000;
    const keyFrom = tr.callsign ? 'callsign' : 'model';
    const v = {
      lat: tr.lat, lon: tr.lon, alt_ft, alt_m: mul(alt_ft, FT), gs_kt, gs_ms: mul(gs_kt, KT),
      tas_kt: num(tr.tas_kt), tas_ms: mul(num(tr.tas_kt), KT), ias_kt: num(tr.ias_kt), ias_ms: mul(num(tr.ias_kt), KT),
      cas_kt: num(tr.cas_kt), cas_ms: mul(num(tr.cas_kt), KT), hdg, pitch: num(tr.pitch), roll: num(tr.roll),
    };
    return {
      id, virtual: false, type: SOURCES[tr.source].type, t, info_state: 'valid',
      status: 'external', cause: null, items: [], reasons: [],
      ext: {
        source: tr.source, callsign: tr.callsign || null, model: tr.model || null, gufi_id: tr.gufi_id || null,
        udp_connected: typeof tr.udp_connected === 'boolean' ? tr.udp_connected : null, session_id: num(tr.session_id),
        ts_ms: tsMs, keyFrom, seq: snap.seq, sent_at: snap.sent_at, rx_id: snap.rx_id,
      },
      fused: { ...v, vs_fpm: null, ground: false, links: {} },
      // 온톨로지 데이터 미리보기용 원천 경로(공통 단위 값). t_last는 수신기 수신 시각(화면 시계 기준)
      paths: { ABFAP: { state: 'ok', t_last: t, ...v, ts_ms: tsMs, source: tr.source, callsign: tr.callsign || null, model: tr.model || null, keyFrom } },
      fusion: { flag: 'none', diff_m: null },
      proc: { id: null, label: '절차 정보 없음(외부 항적)' },
      telemetry_links: [],
      versions: { procedure: '—', policy: '—', ruleset: '—' },
      // 수신기가 X-API-Key를 검증한 스냅샷만 화면에 옴(메시지 서명은 없음)
      sig: 'receiver-key-checked',
    };
  }

  // 새 스냅샷을 기록으로 바꿈. tRx: 수신기가 받은 시각을 화면 시계로 옮긴 값
  function ingest(j, tRx) {
    const snap = { key: `${j.received_at}|${j.rx_id}`, t: tRx, seq: j.seq, sent_at: j.sent_at, rx_id: j.rx_id, recs: [], counts: { xplane: 0, absim: 0, replay: 0 }, dropped: j.tracks_dropped || 0, nokey: 0 };
    const used = {};
    (Array.isArray(j.tracks) ? j.tracks : []).forEach(tr => {
      if (!tr || !SOURCES[tr.source] || num(tr.lat) == null || num(tr.lon) == null) return;
      const raw = tr.callsign || tr.model;
      if (!raw) { snap.nokey++; return; }
      let id = safeKey(raw);
      if (used[id]) id = `${id.slice(0, 29)}~${++used[id]}`; else used[id] = 1;
      ensureAc(id, tr);
      const r = toRecord(tr, id, tRx, snap);
      snap.recs.push(r);
      snap.counts[tr.source]++;
      (tracks[id] = tracks[id] || []).push([tRx, tr.lat, tr.lon]);
      lastIn[id] = tRx;
    });
    return snap;
  }

  // ---- 수신기 조회 ----
  async function poll() {
    const t0 = Date.now();
    info.tries++;
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 2000) : null;
    let entry;
    try {
      const nonce = Math.random().toString(36).slice(2, 12);
      const res = await fetch(`${C.CONTROL_SNAPSHOT_URL}?n=${nonce}`, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
      const t1 = Date.now();
      info.http = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('수신기 응답 아님');
      const j = await res.json();
      if (!j || j.receiver !== 'abfap-track-receiver') throw new Error('수신기 응답 아님');
      // 일회값이 맞지 않으면 보관된 옛 응답(서비스 워커·중간 캐시)으로 보고 쓰지 않음
      if (j.nonce !== nonce) throw new Error('최신 응답 아님');
      info.keyConfigured = !!j.key_configured;
      info.stats = j.stats || null;
      let snap = null;
      if (j.has_data) {
        info.seenData = true;
        const key = `${j.received_at}|${j.rx_id}`;
        if (lastSnap && lastSnap.key === key) snap = lastSnap;
        else {
          // 수신기 시각 차이를 피하려고 수신기가 계산한 경과(age_ms)를 화면 시계에 옮김(조회 왕복의 가운데 기준)
          const tRx = Math.round((t0 + t1) / 2 - Math.max(0, Number(j.age_ms) || 0));
          snap = ingest(j, lastSnap ? Math.max(tRx, lastSnap.t + 1) : tRx);
          lastSnap = snap;
        }
      }
      entry = { t: t1, ok: true, snap };
      info.okCount++;
      info.lastOk = t1;
      info.lastErr = null;
    } catch (e) {
      entry = { t: Date.now(), ok: false, err: e && e.name === 'AbortError' ? '응답 시간 초과' : String((e && e.message) || e) };
      info.lastErr = entry.err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    timeline.push(entry);
    const lo = Date.now() - WINDOW_MS;
    while (timeline.length && timeline[0].t < lo) timeline.shift();
    Object.values(tracks).forEach(arr => { while (arr.length && arr[0][0] < lo) arr.shift(); });
    setTimeout(poll, Math.max(100, C.CONTROL_POLL_MS - (Date.now() - t0)));
  }

  // t 이전의 마지막 조회 결과
  function entryAt(t) {
    let lo = 0, hi = timeline.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].t <= t) { ans = timeline[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  const feedOkAt = t => { const e = entryAt(t); return !!(e && e.ok && t - e.t <= C.CONTROL_STALE_MS); };

  // 실시간 진행 중에만: 오래 빠진 기체 내리기, 상태 전환(수신 ↔ 정보 없음) 이력 남기기
  function housekeeping(t) {
    logT = t;
    const dropBefore = t - C.CONTROL_DROP_SEC * 1000;
    for (let i = AIRCRAFT.length - 1; i >= 0; i--) {
      const id = AIRCRAFT[i].id;
      if (lastIn[id] != null && lastIn[id] < dropBefore) {
        AIRCRAFT.splice(i, 1);
        delete byId[id];
        delete prevSt[id];
        acVersion++;
      }
    }
    const feedOk = feedOkAt(t);
    const e = entryAt(t);
    const snapFresh = !!(e && e.ok && e.snap && !TMS.isStale(t - e.snap.t));
    AIRCRAFT.forEach(a => {
      const li = lastIn[a.id];
      const st = li != null && !TMS.isStale(t - li) ? 'external' : 'nodata';
      const prev = prevSt[a.id] || 'nodata';
      if (st !== prev) {
        let cause;
        if (st === 'external') cause = prevSt[a.id] ? '수신 재개' : '수신 시작';
        else if (!feedOk) cause = '수신기 연결 끊김';
        else if (snapFresh) cause = 'ABFAP 전송 항적에서 빠짐';
        else cause = 'ABFAP 전송 없음';
        log.push({ id: `${a.id}@${t}@${st}`, t, ac: a.id, virtual: false, from: prev, to: st, cause, source: a.source });
      }
      prevSt[a.id] = st;
    });
    const lo = t - WINDOW_MS;
    while (log.length && log[0].t < lo) log.shift();
  }

  function sample(t) {
    if (t >= logT) housekeeping(t);
    const e = entryAt(t);
    if (!e || !e.ok || t - e.t > C.CONTROL_STALE_MS) return { ok: false, t };
    return { ok: true, t, receivers: null, clock: null, backup: null, records: e.snap ? e.snap.recs.filter(r => byId[r.id]) : [] };
  }
  const events = (t0, t1) => log.filter(ev => ev.t > t0 && ev.t <= t1);
  const track = (id, t0, t1) => (tracks[id] || []).filter(p => p[0] >= t0 && p[0] <= t1);
  const verify = rec => rec.sig === 'receiver-key-checked';

  // 수신기·ABFAP 연결 요약(상태 표시용)
  function status(now) {
    now = now || Date.now();
    const e = entryAt(now);
    const snap = e && e.ok ? e.snap : null;
    let phase;
    if (!e) phase = 'connecting';
    else if (!e.ok || now - e.t > C.CONTROL_STALE_MS) phase = info.okCount ? 'lost' : 'none';
    else if (!snap) phase = 'nodata';
    else if (TMS.isStale(now - snap.t)) phase = 'silent';
    else phase = 'ok';
    return { phase, http: info.http, err: info.lastErr, lastOk: info.lastOk, keyConfigured: info.keyConfigured, stats: info.stats, snap, seenData: info.seenData };
  }

  TMS.mock = {
    control: true, SOURCES, AIRCRAFT, get acVersion() { return acVersion; },
    PROCS: [], VERTIPORTS: [], HOLDS: [], HOLD_AREAS: [], VFR_POINTS: [], HOLD_LAP_SEC: DEMO.HOLD_LAP_SEC, ITEM_DEFS: [],
    VERSIONS: { policy: '—', ruleset: '—' },
    sample, events, track, verify, status, toLL: DEMO.toLL,
    schedule: () => ({ arrivals: [], departures: [] }), vpName: id => id, padCheck: () => [],
    units: { FT, KT },
  };
  poll();
})();
