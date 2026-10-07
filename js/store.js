// AAM TMS 내부 관제 화면 시안 - 화면 상태와 창 간 연동
//
// 화면이 직접 수행하는 처리는 아래로 한정함(판정은 하지 않음).
// - 서명 검증 실패 메시지 폐기
// - 마지막 유효 수신 후 기준 시간 경과 시 "정보 없음" 표시
// - 선택·재생·경보 확인·병행 운용 기록의 창 간 동기화
(function () {
  const C = TMS.config, M = TMS.mock;
  const params = new URLSearchParams(location.search);
  const VIEW_ALIAS = { schedule: 'flightplan' }; // 예전 주소 호환
  const reqView = VIEW_ALIAS[params.get('view')] || params.get('view');
  const view = TMS.VIEWS[reqView] ? reqView : 'main';
  const HISTORY_MS = 15 * 60 * 1000;
  const FAR = Number.MAX_SAFE_INTEGER;

  const S = TMS.state = {
    view,
    winId: Math.random().toString(36).slice(2, 8),
    screenNo: Number(params.get('screen')) || null,
    screenCount: Number(params.get('of')) || null,
    mode: 'live',
    replay: { t0: 0, anchor: 0, speed: 1, paused: false },
    now: 0,
    feed: { ok: true, lastOk: 0 },
    receivers: null,
    recs: {},
    noInfo: {},
    lastSeenT: {},
    sigFail: {},
    sigCount: { ok: 0, fail: 0, lastFail: null },
    trails: {},
    events: [], evLastT: 0, evVersion: 0,
    acks: {}, ackFloor: Date.now(),
    opRecords: [], opVersion: 0,
    selected: null,
    overrides: { feedDown: false, loss: {}, sig: {} },
    peers: {},
    follow: false,
  };

  let channel = null;
  const listeners = [];
  const send = msg => { if (channel) channel.postMessage({ ...msg, from: S.winId }); };

  S.on = fn => listeners.push(fn);
  const emit = () => listeners.forEach(fn => fn());

  S.clock = function () {
    const now = Date.now();
    if (S.mode === 'live') return now;
    const r = S.replay;
    const t = r.paused ? r.t0 : r.t0 + (now - r.anchor) * r.speed;
    return Math.min(t, now);
  };
  const quant = t => Math.floor(t / C.TICK_MS) * C.TICK_MS;
  const liveOv = () => (S.mode === 'live' ? S.overrides : null);

  S.displayStatus = function (id) {
    // 정보 없음: 판정 엔진의 NO_INFO 판정 또는 화면 측 수신 경과 기준 중 하나라도 해당하면 적용
    const r = S.recs[id];
    if (!r || TMS.isStale(S.now - r.t)) return 'nodata';
    if (S.noInfo[id] && S.noInfo[id] > r.t) return 'nodata';
    return r.status;
  };
  S.isFresh = id => S.displayStatus(id) !== 'nodata';
  S.feedStale = () => TMS.isStale(S.now - S.feed.lastOk) || !S.feed.ok;
  S.needsAck = ev => C.ACK_REQUIRED.includes(ev.to) && ev.t >= S.ackFloor && !S.acks[ev.id];
  S.unacked = () => S.events.filter(S.needsAck);

  function pushTrail(r) {
    const arr = S.trails[r.id] || (S.trails[r.id] = []);
    arr.push([r.t, r.fused.lat, r.fused.lon]);
    const lim = r.t - C.TRAIL_SEC * 1000;
    while (arr.length && arr[0][0] < lim) arr.shift();
  }

  // 시점 변경(시작, 재생 이동) 시 이력·항적을 다시 조회함
  function rebuild(t) {
    const ov = liveOv();
    S.now = t;
    S.recs = {};
    S.noInfo = {};
    S.lastSeenT = {};
    S.trails = {};
    M.AIRCRAFT.forEach(a => { S.trails[a.id] = M.track(a.id, t - C.TRAIL_SEC * 1000, t - C.TICK_MS, C.TICK_MS * 5, ov); });
    S.events = M.events(t - HISTORY_MS, t, ov);
    S.evLastT = t;
    S.evVersion++;
  }

  S.tick = function () {
    const t = quant(S.clock());
    if (t < S.evLastT) rebuild(t);
    S.now = t;
    const ov = liveOv();
    const snap = M.sample(t, ov);
    if (snap.ok) {
      S.feed.ok = true;
      S.feed.lastOk = t;
      S.receivers = snap.receivers;
      snap.records.forEach(r => {
        const isNew = S.lastSeenT[r.id] !== r.t;
        S.lastSeenT[r.id] = r.t;
        if (!M.verify(r)) {
          // 서명 검증 실패: 표시하지 않고 폐기. 마지막 유효 값은 그대로 두며 기준 시간 경과 후 정보 없음으로 전환됨.
          if (isNew) { S.sigCount.fail++; S.sigCount.lastFail = t; }
          S.sigFail[r.id] = t;
          return;
        }
        if (isNew && r.info_state === 'no_info') {
          // 정보 없음 판정은 값을 갖지 않으므로 마지막 유효 판정은 그대로 두고 시각만 남김
          S.sigCount.ok++;
          S.noInfo[r.id] = r.t;
          return;
        }
        if (isNew) {
          S.sigCount.ok++;
          pushTrail(r);
          S.recs[r.id] = r;
        }
      });
      if (t > S.evLastT) {
        const evs = M.events(S.evLastT, t, ov);
        if (evs.length) { S.events.push(...evs); S.evVersion++; }
        S.evLastT = t;
      }
    } else {
      S.feed.ok = false;
    }
    // 연동 창 만료
    const wall = Date.now();
    Object.keys(S.peers).forEach(k => { if (wall - S.peers[k].seen > C.PEER_EXPIRE_MS) delete S.peers[k]; });
    emit();
  };

  // ---- 조작 ----
  S.select = function (id, fromPeer) {
    if (S.selected === id) return;
    S.selected = id;
    if (!fromPeer) send({ type: 'select', id });
    emit();
  };
  S.ack = function (evId, fromPeer, ack) {
    if (S.acks[evId]) return;
    S.acks[evId] = ack || { t: Date.now(), by: C.OPERATOR, win: S.view };
    S.evVersion++;
    if (!fromPeer) send({ type: 'ack', evId, ack: S.acks[evId] });
    emit();
  };
  // 시안 전용 일괄 소거: 미확인 경보를 한꺼번에 확인 처리함(장시간 시연용). 운영 제품에는 두지 않음(설계서: 경보 일괄 확인 없음)
  S.ackAll = function (ids, fromPeer, ack) {
    ids = ids || S.unacked().map(ev => ev.id);
    ack = ack || { t: Date.now(), by: C.OPERATOR, win: S.view, bulk: true };
    let n = 0;
    ids.forEach(id => { if (!S.acks[id]) { S.acks[id] = ack; n++; } });
    if (!n) return 0;
    S.evVersion++;
    if (!fromPeer) send({ type: 'ackAll', ids, ack });
    emit();
    return n;
  };
  S.addOp = function (rec, fromPeer) {
    if (S.opRecords.some(r => r.id === rec.id)) return;
    S.opRecords.push(rec);
    S.opRecords.sort((a, b) => a.wall - b.wall);
    S.opVersion++;
    if (!fromPeer) send({ type: 'op', rec });
    emit();
  };
  function applyReplay(mode, replay, fromPeer) {
    S.mode = mode;
    S.replay = { ...replay };
    rebuild(quant(S.clock()));
    if (!fromPeer) send({ type: 'replay', mode: S.mode, replay: S.replay });
    S.tick();
  }
  S.goLive = () => applyReplay('live', S.replay);
  S.goReplay = t => {
    const now = Date.now();
    const lo = now - C.REPLAY_WINDOW_SEC * 1000;
    t = Math.max(lo, Math.min(t, now));
    applyReplay('replay', { t0: t, anchor: now, speed: S.mode === 'replay' ? S.replay.speed : 1, paused: S.mode === 'replay' ? S.replay.paused : false });
  };
  S.setSpeed = speed => applyReplay(S.mode, { t0: S.clock(), anchor: Date.now(), speed, paused: S.replay.paused });
  S.togglePause = () => {
    if (S.mode !== 'replay') return;
    applyReplay('replay', { t0: S.clock(), anchor: Date.now(), speed: S.replay.speed, paused: !S.replay.paused });
  };
  S.setOverrides = function (ov, fromPeer) {
    S.overrides = ov;
    if (!fromPeer) send({ type: 'ov', ov });
    emit();
  };
  S.simLoss = id => { const now = Date.now(); S.setOverrides({ ...S.overrides, loss: { ...S.overrides.loss, [id]: { from: quant(now), to: quant(now) + 10000 } } }); };
  S.simSigFail = id => { const now = Date.now(); S.setOverrides({ ...S.overrides, sig: { ...S.overrides.sig, [id]: { from: quant(now), to: quant(now) + 10000 } } }); };
  S.setFeedDown = on => S.setOverrides({ ...S.overrides, feedDown: on });
  S.closeAll = () => send({ type: 'close-all' });
  // 기준 위치 변경 등 다시 불러와야 하는 설정을 연동 창 전체에 적용함
  S.reloadAll = () => { send({ type: 'reload' }); location.reload(); };
  S.setFollow = on => { S.follow = on; emit(); };
  S.pauseAt = t => {
    const now = Date.now();
    t = Math.max(now - C.REPLAY_WINDOW_SEC * 1000, Math.min(t, now));
    applyReplay('replay', { t0: t, anchor: now, speed: S.replay.speed || 1, paused: true });
  };
  // 이 창의 화면 역할 전환(창별 설정이며 동기화하지 않음)
  S.setView = v => {
    if (!TMS.VIEWS[v] || v === S.view) return;
    S.view = v;
    const p = new URLSearchParams(location.search);
    p.set('view', v);
    history.replaceState(null, '', `${location.pathname}?${p}`);
    emit();
  };

  // ---- 창 간 연동 ----
  function onMessage(m) {
    if (!m || m.from === S.winId) return;
    if (m.from) S.peers[m.from] = { ...(S.peers[m.from] || {}), seen: Date.now(), view: m.view || (S.peers[m.from] || {}).view, screenNo: m.screenNo ?? (S.peers[m.from] || {}).screenNo };
    switch (m.type) {
      case 'hello':
        send({ type: 'state', to: m.from, view: S.view, screenNo: S.screenNo, acks: S.acks, ackFloor: S.ackFloor, opRecords: S.opRecords, overrides: S.overrides, selected: S.selected, mode: S.mode, replay: S.replay });
        break;
      case 'state':
        if (m.to !== S.winId) break;
        Object.entries(m.acks || {}).forEach(([k, v]) => { if (!S.acks[k]) S.acks[k] = v; });
        S.ackFloor = Math.min(S.ackFloor, m.ackFloor || S.ackFloor);
        (m.opRecords || []).forEach(r => S.addOp(r, true));
        if (m.selected && !S.selected) S.selected = m.selected;
        S.overrides = m.overrides || S.overrides;
        if (m.mode !== S.mode || m.mode === 'replay') applyReplay(m.mode, m.replay, true);
        else rebuild(quant(S.clock()));
        S.evVersion++;
        emit();
        break;
      case 'hb': break;
      case 'bye': delete S.peers[m.from]; break;
      case 'select': S.select(m.id, true); break;
      case 'ack': S.ack(m.evId, true, m.ack); break;
      case 'ackAll': S.ackAll(m.ids, true, m.ack); break;
      case 'op': S.addOp(m.rec, true); break;
      case 'replay': applyReplay(m.mode, m.replay, true); break;
      case 'ov': S.setOverrides(m.ov, true); break;
      case 'reload': location.reload(); break;
      case 'close-all': window.close(); setTimeout(() => { document.body.classList.add('is-closed'); }, 200); break;
      default: break;
    }
  }

  S.init = function () {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(C.CHANNEL);
      channel.onmessage = e => onMessage(e.data);
      send({ type: 'hello', view: S.view, screenNo: S.screenNo });
      setInterval(() => send({ type: 'hb', view: S.view, screenNo: S.screenNo }), C.PEER_HB_MS);
      window.addEventListener('beforeunload', () => send({ type: 'bye' }));
    }
    rebuild(quant(S.clock()));
    S.tick();
    setInterval(S.tick, C.TICK_MS);
  };

  S.FAR = FAR;
})();
