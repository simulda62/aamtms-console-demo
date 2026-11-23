// AAM TMS 관제 화면 시안 - 상단 탭·상태 표시, 기체 목록, 기체 상세, 경보·이벤트, 시스템, 재생 막대, 지도 위 표시
(function () {
  const C = TMS.config, S = TMS.state, M = TMS.mock, F = TMS.fmt, ST = TMS.STATUS;
  const $ = sel => document.querySelector(sel);
  // 기체 목록은 제어 모드에서 수신에 따라 늘고 줄어듦(데모 각본은 고정)
  const acOf = id => M.AIRCRAFT.find(a => a.id === id) || null;
  // 제어 모드(ABFAP 항적): 판정 없음(외부 항적), 단위 m·m/s, 출처(X-Plane·ABSim·재생) 구분
  const CTL = !!M.control;
  const SRC = M.SOURCES || {};
  const fmtM = v => (v == null ? '—' : `${Math.round(v).toLocaleString()} m`);
  const fmtMps = v => (v == null ? '—' : `${v.toFixed(1)} m/s`);
  const fmtDeg = v => (v == null ? '—' : `${Math.round(v)}°`);
  const srcTag = a => (a && SRC[a.source] ? `<em class="tag tag--src tag--src-${a.source}">${SRC[a.source].label}</em>` : '');
  const ST_KEYS = CTL ? ['nodata', 'external'] : ['emergency', 'warning', 'nodata', 'caution', 'normal'];
  const CTL_PHASE = {
    ok: ['ok', '정상'], nodata: ['nodata', '수신 이력 없음'], silent: ['warn', 'ABFAP 전송 없음'],
    lost: ['bad', '연결 끊김'], none: ['nodata', '수신기 없음'], connecting: ['nodata', '연결 중'],
  };
  const ctlStatus = () => (CTL ? M.status() : null);
  const kst = ms => F.time(ms + 9 * 3600 * 1000, true);
  const kstMs = ms => `${kst(ms)}.${Math.floor(new Date(ms).getMilliseconds() / 100)}`;
  const ago = ms => F.age(ms).replace(' 전', '');
  const SIG_RECENT_MS = 10000;
  // 텔레메트리 링크: 구성(telemetry_links)과 링크별 경로(paths['TELEMETRY/LORA'] 등)
  // 구성에 있으나 경로가 없으면 '수신 이력 없음'(state 'none'). 구성 미지정([])이면 받은 경로만 보임
  const tlmLinks = r => {
    if (!r || !r.paths) return [];
    const got = Object.keys(r.paths).filter(k => k.startsWith('TELEMETRY/')).map(k => k.slice(10));
    const names = r.telemetry_links && r.telemetry_links.length ? r.telemetry_links : got;
    return names.map(name => ({ name, label: (TMS.config.TLM_LINK_LABEL || {})[name] || name, ...(r.paths[`TELEMETRY/${name}`] || { state: 'none' }) }));
  };
  const linkStateText = l => (l.state === 'ok' ? '수신' : l.state === 'none' ? '수신 이력 없음' : '두절');
  const tlmOk = r => tlmLinks(r).some(l => l.state === 'ok');
  const stText = st => `<span class="st-text st-text--${st}">${ST[st].label}</span>`;
  const stTag = st => `<span class="st-tag st-tag--${st}">${ST[st].label}</span>`;
  const sigRecent = id => S.mode === 'live' && S.sigFail[id] && S.now - S.sigFail[id] < SIG_RECENT_MS;
  const diamond = cls => `<svg class="dia ${cls}" viewBox="-10 -10 20 20"><rect x="-5.5" y="-5.5" width="11" height="11" transform="rotate(45)"/><circle r="1.8"/></svg>`;
  const kv = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  function counts() {
    const c = { emergency: 0, warning: 0, nodata: 0, caution: 0, normal: 0, external: 0 };
    M.AIRCRAFT.forEach(a => { c[S.displayStatus(a.id)]++; });
    return c;
  }
  function sortedAircraft() {
    return M.AIRCRAFT.map(ac => ({ ac, st: S.displayStatus(ac.id) }))
      .sort((a, b) => ST[a.st].rank - ST[b.st].rank || a.ac.virtual - b.ac.virtual || a.ac.id.localeCompare(b.ac.id));
  }

  // ---------- 상단 탭·상태 표시 ----------
  function buildTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = Object.entries(TMS.VIEWS)
      .filter(([k, v]) => v.tab || k === S.view)
      .map(([k, v]) => `<button type="button" data-view="${k}">${v.label}${k === 'events' ? '<span class="tab-badge" id="tab-badge" hidden></span>' : ''}</button>`).join('');
    tabs.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => S.setView(b.dataset.view)));
  }
  function setChip(id, state, text) {
    const el = document.getElementById(id);
    el.className = `chip chip--${state}`;
    el.querySelector('b').textContent = text;
  }
  function updateChrome() {
    document.body.dataset.view = S.view;
    document.querySelectorAll('#tabs [data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === S.view));
    document.querySelectorAll('#rail [data-rail]').forEach(b => b.classList.toggle('is-on',
      b.dataset.rail === 'assets' ? !document.body.classList.contains('assets-closed') : b.dataset.rail === S.view));
    const un = S.unacked().length;
    ['#tab-badge', '#rail-badge'].forEach(s => { const el = $(s); if (el) { el.hidden = !un; el.textContent = un; } });
    const bulk = $('#btn-ack-all');
    if (bulk) { bulk.hidden = !un; $('#ack-all-n').textContent = un; }
    const pos = $('#screen-pos');
    pos.hidden = !S.screenNo;
    if (S.screenNo) pos.textContent = `화면 ${S.screenNo}/${S.screenCount}`;
    document.body.classList.toggle('is-replay', S.mode === 'replay');

    $('#clock-kst').textContent = kst(Date.now());
    $('#clock-utc').textContent = F.time(Date.now(), true);
    $('#foot-clock').textContent = `${F.time(Date.now(), true)} UTC`;
    const mb = $('#mode-badge');
    if (S.mode === 'live') { mb.className = 'mode-badge mode--live'; mb.innerHTML = '<i></i>실시간'; }
    else {
      mb.className = 'mode-badge mode--replay';
      mb.innerHTML = `<i></i>${S.replay.paused ? '재생 일시정지' : `재생 ×${S.replay.speed}`} · ${kst(S.now)} KST`;
    }
    const bad = S.feedStale();
    const rx = S.receivers || {};
    const sig = S.mode === 'live' && S.sigCount.lastFail && Date.now() - S.sigCount.lastFail < SIG_RECENT_MS;
    const sb = $('#src-badge');
    sb.className = `src-badge ${CTL ? 'src--control' : 'src--demo'}`;
    sb.textContent = CTL ? '제어 모드 · ABFAP 항적' : '데모 · 가상 각본';
    const flag = $('#src-flag').lastChild, flagText = CTL ? 'ABFAP TRACKS' : 'DEMO DATA';
    if (flag.nodeValue !== flagText) flag.nodeValue = flagText;
    if (CTL) {
      // 제어 모드: 판정 결과 대신 ABFAP 수신기 연결 상태. 수신기·판정 엔진 관련 칩은 숨김(console.css)
      const cs = ctlStatus();
      const [cls, txt] = CTL_PHASE[cs.phase] || CTL_PHASE.none;
      const chip = $('#chip-feed');
      const label = TMS.i18n.t('ABFAP 수신기');
      if (chip.firstChild.nodeType === 3 && chip.firstChild.nodeValue !== label) chip.firstChild.nodeValue = label;
      setChip('chip-feed', cls, txt);
      const n = cs.snap ? cs.snap.counts : null;
      chip.title = TMS.i18n.t(`ABFAP 항적 전송 수신기(같은 출처 ${C.CONTROL_SNAPSHOT_URL})${n ? ` · 마지막 스냅샷 X-Plane ${n.xplane} · ABSim ${n.absim} · 재생 ${n.replay}` : ''}`);
    } else setChip('chip-feed', bad ? 'bad' : 'ok', bad ? '두절' : '정상');
    setChip('chip-adsb', bad ? 'nodata' : rx.adsb === 'ok' ? 'ok' : 'bad', bad ? '정보 없음' : rx.adsb === 'ok' ? '정상' : '이상');
    setChip('chip-lora', bad ? 'nodata' : rx.lora === 'ok' ? 'ok' : 'bad', bad ? '정보 없음' : rx.lora === 'ok' ? '정상' : '이상');
    setChip('chip-manet', bad ? 'nodata' : rx.manet === 'ok' ? 'ok' : 'bad', bad ? '정보 없음' : rx.manet === 'ok' ? '정상' : '이상');
    setChip('chip-sig', sig ? 'warn' : 'ok', sig ? '실패 발생' : '정상');
    setChip('chip-peers', 'info', `${Object.keys(S.peers).length + 1}개`);
    // 서버 시각 동기: 판단은 에이전트가 하고 화면은 표시만 함. 판정 결과 수신이 끊기면 정보 없음
    const ck = bad ? null : S.timeSync;
    const CK = { OK: ['ok', '정상'], ATTENTION: ['warn', '주의'], NO_REPORT: ['warn', '보고 없음'], NO_INFO: ['nodata', '정보 없음'] };
    const [ckCls, ckLabel] = ck && CK[ck.state] ? CK[ck.state] : ['nodata', '정보 없음'];
    const fmtMs = v => { if (v == null) return '—'; const x = Math.round(Number(v) * 10) / 10 || 0; return `${x > 0 ? '+' : ''}${x.toFixed(1)} ms`; };
    setChip('chip-clock', ckCls, !ck ? ckLabel : ck.state === 'OK' || ck.state === 'ATTENTION' ? `${ckLabel} ${fmtMs(ck.offset_ms)}` : ck.state === 'NO_REPORT' && ck.age_s != null ? `${ckLabel} ${ck.age_s}초` : ckLabel);
    // 서버 정기 백업: 평소(정상)에는 칩을 숨기고 주의·보고 없음·정보 없음일 때만 보임
    const bk = bad ? null : S.backup;
    const bkState = bk ? bk.state : 'NO_INFO';
    const bkEl = $('#chip-backup');
    bkEl.hidden = bkState === 'OK';
    if (bkState !== 'OK') {
      const why = !bk ? '' : bk.state !== 'ATTENTION' ? '' : bk.last_run_ok === false ? ' · 실행 실패' : bk.set == null ? ' · 성공 없음' : ' · 오래됨';
      setChip('chip-backup', bkState === 'NO_INFO' ? 'nodata' : 'warn', `${({ ATTENTION: '주의', NO_REPORT: '보고 없음', NO_INFO: '정보 없음' })[bkState] || '정보 없음'}${why}`);
      bkEl.title = TMS.i18n.t(bk ? `서버 정기 백업 · 마지막 실행 ${bk.last_run_ok == null ? '—' : bk.last_run_ok ? '성공' : '실패'} · 마지막 성공 후 ${F.dur(bk.age_s)} · 백업 묶음 ${bk.set || '—'}` : '서버 정기 백업 · 정보 없음');
    }
    $('#chip-clock').title = TMS.i18n.t(ck ? `서버 시각 동기 · ${ck.synced ? '동기됨' : '동기 안 됨'} · 계층 ${ck.stratum ?? '—'} · 시각 오차 ${fmtMs(ck.offset_ms)} · 최대 오차 추정 ${ck.error_ms == null ? '—' : `${Number(ck.error_ms).toFixed(1)} ms`} · 기준 원천 ${ck.ref || '—'} · 보고 나이 ${ck.age_s == null ? '—' : `${ck.age_s}초 전`}` : '서버 시각 동기 · 정보 없음');

    const cs = $('#conn-state');
    if (cs) {
      let txt, cls;
      if (S.mode === 'replay') { txt = `재생 중 · 실시간 아님 · ${kst(S.now)} KST`; cls = 'is-replay'; }
      else if (bad) { txt = CTL ? `ABFAP 수신기 연결 끊김 · 마지막 ${S.feed.lastOk ? `${kst(S.feed.lastOk)} KST` : '—'}` : `판정 결과 수신 두절 · 마지막 ${kst(S.feed.lastOk)} KST`; cls = 'is-bad'; }
      else { txt = CTL ? 'ABFAP 항적 수신 중 · 판정 없음' : '실시간 연결'; cls = 'is-ok'; }
      cs.className = `map-bar__right ${cls}`;
      cs.textContent = txt;
    }
  }

  // ---------- 재생 막대 ----------
  function Player(el) {
    el.innerHTML = `<div class="player">
      <div class="player__ctl">
        <button type="button" data-p="back" title="30초 뒤로"><svg viewBox="0 0 16 16"><path d="M3 3v10M13 3L6 8l7 5z"/></svg></button>
        <button type="button" data-p="pause" title="일시정지·재개 (Space)"><svg viewBox="0 0 16 16"><path class="i-pause" d="M5.5 3v10M10.5 3v10"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button>
        <button type="button" data-p="live" title="실시간 (L)"><svg viewBox="0 0 16 16"><path d="M3 3l7 5-7 5zM13 3v10"/></svg></button>
        <button type="button" data-p="speed" class="player__speed" title="재생 배속">×1</button>
      </div>
      <div class="player__track">
        <div class="player__marks"></div>
        <input type="range" class="player__range" min="0" max="${C.REPLAY_WINDOW_SEC}" step="1" aria-label="재생 시점(최근 30분)">
        <div class="player__scale"><span>-30분</span><span>-20분</span><span>-10분</span><span>현재</span></div>
      </div>
      <span class="player__state"></span>
    </div>`;
    const range = el.querySelector('.player__range');
    let dragging = false, marksAt = 0;
    range.addEventListener('pointerdown', () => { dragging = true; });
    range.addEventListener('input', () => {
      dragging = true;
      el.querySelector('.player__state').textContent = `${kst(Date.now() - (C.REPLAY_WINDOW_SEC - Number(range.value)) * 1000)} KST로 이동`;
    });
    range.addEventListener('change', () => {
      dragging = false;
      const v = Number(range.value);
      if (v >= C.REPLAY_WINDOW_SEC - 1) S.goLive(); else S.goReplay(Date.now() - (C.REPLAY_WINDOW_SEC - v) * 1000);
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const a = b.dataset.p;
      if (a === 'back') S.goReplay(S.now - 30000);
      if (a === 'live') S.goLive();
      if (a === 'pause') { if (S.mode === 'live') S.pauseAt(Date.now()); else S.togglePause(); }
      if (a === 'speed' && S.mode === 'replay') { const sp = [1, 2, 4, 8]; S.setSpeed(sp[(sp.indexOf(S.replay.speed) + 1) % sp.length]); }
    });
    return {
      update() {
        const now = Date.now();
        const lo = now - C.REPLAY_WINDOW_SEC * 1000;
        const live = S.mode === 'live';
        if (!dragging) {
          range.value = live ? C.REPLAY_WINDOW_SEC : Math.round((S.now - lo) / 1000);
          el.querySelector('.player__state').innerHTML = live
            ? `<b class="live">실시간</b><span class="mono">${kst(S.now)} KST</span>`
            : `<b class="replay">${S.replay.paused ? '일시정지' : `재생 ×${S.replay.speed}`}</b><span class="mono">${kst(S.now)} KST · ${ago(now - S.now)} 전</span>`;
        }
        const p = el.querySelector('.player');
        p.classList.toggle('is-replay', !live);
        p.classList.toggle('is-paused', !live && S.replay.paused);
        const spd = el.querySelector('.player__speed');
        spd.textContent = `×${S.replay.speed}`;
        spd.disabled = live;
        if (now - marksAt > 1000) {
          marksAt = now;
          el.querySelector('.player__marks').innerHTML = S.events.filter(e => e.t >= lo && e.to !== 'normal')
            .map(e => `<i class="pm pm--${e.to}" style="left:${((e.t - lo) / (C.REPLAY_WINDOW_SEC * 10)).toFixed(2)}%"></i>`).join('');
        }
      },
    };
  }

  // ---------- 기체 목록 ----------
  const rows = {};
  let listOrder = '';
  let listFilter = 'all';
  let query = '';
  function addRow(ac) {
    const body = $('#list-body');
    {
      const row = document.createElement('div');
      row.className = 'asset';
      row.dataset.id = ac.id;
      row.innerHTML = `<span class="asset__icon">${diamond(ac.virtual ? 'dia--virtual' : ac.replay ? 'dia--replay' : '')}</span>
        <span class="asset__body">
          <span class="asset__name"><b>${F.esc(ac.id)}</b>${CTL ? srcTag(ac) : ac.virtual ? '<em class="tag tag--virtual">가상</em>' : '<em class="tag tag--real">실기체</em>'}</span>
          <small class="asset__st"></small>
          <small class="asset__proc"></small>
          <small class="asset__note"></small>
        </span>
        <span class="asset__nums"><span class="n-alt"></span><span class="n-gs"></span><span class="n-vs x"></span></span>
        <span class="asset__paths x"></span>
        <span class="asset__dot"></span>`;
      row.addEventListener('click', () => S.select(S.selected === ac.id ? null : ac.id));
      rows[ac.id] = row;
      body.appendChild(row);
    }
  }
  // 제어 모드: 수신으로 새로 생긴 기체는 줄을 더하고, 내려간 기체는 줄을 뺌
  let listAcVer = -1;
  function syncRows() {
    if (listAcVer === M.acVersion) return;
    listAcVer = M.acVersion;
    const ids = new Set(M.AIRCRAFT.map(a => a.id));
    Object.keys(rows).forEach(id => { if (!ids.has(id)) { rows[id].remove(); delete rows[id]; } });
    M.AIRCRAFT.forEach(a => { if (!rows[a.id]) addRow(a); });
    listOrder = '';
  }
  function buildList() {
    syncRows();
    if (CTL) {
      // 제어 모드: 실기체·가상기체 구분 대신 실시간(X-Plane·ABSim)·재생 구분
      const fb = f => document.querySelector(`#list-filter [data-f="${f}"]`);
      fb('real').textContent = '실시간';
      fb('virtual').textContent = '재생';
    }
    $('#asset-search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); });
    document.querySelectorAll('#list-filter button').forEach(b => b.addEventListener('click', () => {
      listFilter = b.dataset.f;
      document.querySelectorAll('#list-filter button').forEach(x => x.classList.toggle('is-on', x === b));
    }));
    $('#assets-collapse').addEventListener('click', () => document.body.classList.add('assets-closed'));
    $('#btn-assets').addEventListener('click', () => document.body.classList.toggle('assets-closed'));
  }
  function updateList() {
    syncRows();
    const order = sortedAircraft();
    let shown = 0;
    order.forEach(({ ac, st }) => {
      const row = rows[ac.id];
      const r = S.recs[ac.id];
      const fresh = st !== 'nodata';
      row.className = `asset asset--${st}${ac.id === S.selected ? ' is-selected' : ''}`;
      const stEl = row.querySelector('.asset__st');
      stEl.className = `asset__st st-text--${st}`;
      stEl.textContent = fresh && st !== 'normal' && r.cause ? `${ST[st].label} · ${r.cause}` : ST[st].label;
      const notes = [];
      if (!fresh) notes.push(r ? `마지막 수신 ${kst(r.t)} (${F.age(S.now - r.t)})` : '수신 이력 없음');
      if (sigRecent(ac.id)) notes.push('서명 검증 실패 메시지 폐기');
      if (CTL) {
        // 제어 모드: 출처·키 근거, 고도 m, 대지속도 m/s, 방위. 정보 없음이면 값을 숨김
        const x = r && r.ext;
        row.querySelector('.asset__proc').textContent = `${ac.type}${x ? ` · ${x.keyFrom === 'callsign' ? 'callsign' : 'model'} 키` : ''}`;
        if (fresh && x && x.udp_connected === false) notes.push('ABSim 텔레메트리 3초 넘게 미수신(udp_connected=false)');
        if (ac.replay) notes.push('재생 항적 · 실시간 기체 아님');
        row.querySelector('.asset__note').textContent = notes.join(' · ');
        row.querySelector('.n-alt').textContent = fresh ? fmtM(r.fused.alt_m) : '—';
        row.querySelector('.n-gs').textContent = fresh ? fmtMps(r.fused.gs_ms) : '—';
        row.querySelector('.n-vs').textContent = fresh ? fmtDeg(r.fused.hdg) : '—';
        row.querySelector('.asset__paths').innerHTML = `<span class="path path--${fresh ? 'ok' : 'nodata'}" title="ABFAP ${ac.source ? SRC[ac.source].label : ''}">${ac.source ? SRC[ac.source].short : '?'}</span>`;
        row.classList.toggle('asset--replay', !!ac.replay);
        const hay = `${ac.id} ${ac.type} ${ac.model || ''} ${ac.source ? SRC[ac.source].label : ''}`.toLowerCase();
        row.hidden = (listFilter === 'real' && ac.replay) || (listFilter === 'virtual' && !ac.replay) || (!!query && !hay.includes(query));
        if (!row.hidden) shown++;
        return;
      }
      row.querySelector('.asset__proc').textContent = `${ac.type} · ${fresh ? r.proc.label : '—'}`;
      row.querySelector('.asset__note').textContent = notes.join(' · ');
      row.querySelector('.n-alt').textContent = fresh ? `${Math.round(r.fused.alt_ft)} ft` : '—';
      row.querySelector('.n-gs').textContent = fresh ? `${Math.round(r.fused.gs_kt)} kt` : '—';
      row.querySelector('.n-vs').textContent = fresh ? `${Math.round(r.fused.vs_fpm)} fpm` : '—';
      row.querySelector('.asset__paths').innerHTML = fresh
        ? `<span class="path path--${r.paths.ADSB.state}" title="ADS-B">A</span>`
          + tlmLinks(r).map(l => `<span class="path path--${l.state === 'none' ? 'nodata' : l.state}" title="텔레메트리 ${l.label} ${linkStateText(l)}">${l.label[0]}</span>`).join('')
          + (r.fusion.flag === 'mismatch' ? '<span class="path path--mismatch" title="경로 간 불일치">≠</span>' : '')
        : '<span class="path path--nodata">A</span>' + tlmLinks(r).map(l => `<span class="path path--nodata">${l.label[0]}</span>`).join('');
      const hay = `${ac.id} ${ac.type} ${r ? r.proc.label : ''} ${ac.virtual ? '가상' : '실기체'}`.toLowerCase();
      row.hidden = (listFilter === 'real' && ac.virtual) || (listFilter === 'virtual' && !ac.virtual) || (!!query && !hay.includes(query));
      if (!row.hidden) shown++;
    });
    const key = order.map(o => o.ac.id).join(',');
    if (key !== listOrder) { order.forEach(o => $('#list-body').appendChild(rows[o.ac.id])); listOrder = key; }
    $('#asset-count').textContent = shown;
    const c = counts();
    const bad = S.feedStale();
    $('#list-summary').innerHTML = `<span class="sum-state"><i class="dot ${bad ? 'dot--bad' : 'dot--live'}"></i>${bad ? '수신 두절' : '수신 중'}</span>`
      + ST_KEYS.map(k => `<span class="sum${c[k] ? '' : ' is-zero'}"><span class="st-text--${k}">${ST[k].label}</span> <b>${c[k]}</b></span>`).join('');
  }

  // ---------- 기체 상세 ----------
  let forId;
  let builtMissing = false; // 선택 기체가 목록에 없을 때 만든 상세(수신되면 다시 만듦)
  let showStale = false;
  let opChoice = null;
  let opRendered = -1;
  const open = new Set(['ov', 'data', 'tel', 'items', 'paths', 'proc', 'ver', 'op']);
  const q = k => document.querySelector(`#detail [data-k="${k}"]`);
  const section = (key, title, body) => `<section class="sec${open.has(key) ? ' is-open' : ''}" data-sec="${key}">
    <button type="button" class="sec__head">${title}<i></i></button><div class="sec__body">${body}</div></section>`;

  function bindDetail() {
    const root = $('#detail');
    root.addEventListener('click', e => {
      const head = e.target.closest('.sec__head');
      if (head) {
        const sec = head.parentElement;
        sec.classList.toggle('is-open');
        if (sec.classList.contains('is-open')) open.add(sec.dataset.sec); else open.delete(sec.dataset.sec);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'stale') showStale = !showStale;
      if (a === 'events') filterEvents('selected');
      if (a === 'follow') { S.setFollow(!S.follow); TMS.mapView.focus(forId); }
      if (a === 'unselect') S.select(null);
      if (a === 'op') {
        opChoice = b.dataset.op;
        root.querySelectorAll('[data-act="op"]').forEach(x => x.classList.toggle('is-on', x === b));
        q('op-save').disabled = S.mode !== 'live';
      }
      if (a === 'op-save' && opChoice && S.mode === 'live') {
        const r = S.recs[forId];
        S.addOp({
          id: `${S.winId}-${Date.now()}`, wall: Date.now(), t: S.now, ac: forId,
          sys: S.displayStatus(forId), sysVersions: r ? r.versions : null,
          op: opChoice, note: q('op-note').value.trim(), by: C.OPERATOR,
        });
        q('op-note').value = '';
        opChoice = null;
        root.querySelectorAll('[data-act="op"]').forEach(x => x.classList.remove('is-on'));
        q('op-save').disabled = true;
        toast('병행 운용 판단을 기록함(데모: 화면 메모리에만 저장).');
      }
    });
  }

  function buildDetail() {
    const root = $('#detail');
    forId = S.selected;
    showStale = false;
    opChoice = null;
    opRendered = -1;
    if (!forId && CTL) {
      root.innerHTML = `<div class="d-head">
          <div class="eyebrow">상황 개요 · 제어 모드</div>
          <h1>항적 <span data-k="ov-n"></span>건</h1>
          <div class="d-status" data-k="ov-status"></div>
          <div class="d-meta" data-k="ov-meta"></div>
        </div>
        <div class="d-body">${section('ov', '수신 요약', '<dl class="kv2" data-k="ov-body"></dl>')}
        <p class="d-hint">ABFAP가 보낸 외부 항적을 표시함. 판정 결과가 아니므로 판정 단계 없이 '판정 없음(외부 항적)'으로 구분함. 기체 키는 callsign(없으면 model)임(ABFAP에는 ICAO 24비트 주소가 없음).</p></div>`;
      return;
    }
    if (!forId) {
      root.innerHTML = `<div class="d-head">
          <div class="eyebrow">상황 개요</div>
          <h1>기체 ${M.AIRCRAFT.length}대</h1>
          <div class="d-status" data-k="ov-status"></div>
          <div class="d-meta">실기체 <b>${M.AIRCRAFT.filter(a => !a.virtual).length}</b> · 가상기체 <b>${M.AIRCRAFT.filter(a => a.virtual).length}</b><br>정책 <b class="mono">${M.VERSIONS.policy}</b></div>
        </div>
        <div class="d-body">${section('ov', '운항 요약', '<dl class="kv2" data-k="ov-body"></dl>')}
        <p class="d-hint">목록·지도에서 기체를 선택하거나 ↑/↓ 키로 이동하면 판정 근거, 수신 경로, 절차·구간, 판정 버전, 병행 운용 기록을 표시함.</p></div>`;
      return;
    }
    const ac = acOf(forId);
    builtMissing = !ac;
    if (!ac) {
      // 제어 모드: 다른 창에서 고른 항적이 이 창에 아직 수신되지 않았거나, 오래 수신되지 않아 목록에서 내려간 경우
      root.innerHTML = `<div class="d-head"><div class="eyebrow">선택 항적</div><h1>${F.esc(forId)}</h1>
        <div class="d-meta">이 창의 목록에 없음(아직 수신되지 않았거나 ${C.CONTROL_DROP_SEC}초 넘게 수신되지 않아 내려감)</div>
        <div class="d-actions"><button type="button" class="btn btn--sm" data-act="unselect">선택 해제</button></div></div>`;
      return;
    }
    if (CTL) {
      root.innerHTML = `<div class="d-head">
          <div class="eyebrow">ABFAP 외부 항적</div>
          <h1>${F.esc(ac.id)}</h1>
          <div class="d-status" data-k="status"></div>
          <div class="d-meta" data-k="meta"></div>
          <div class="d-paths" data-k="pathicon"></div>
          <div class="d-actions"><button type="button" class="btn btn--sm" data-act="follow" data-k="follow">지도에서 따라가기</button><button type="button" class="btn btn--sm" data-act="unselect">선택 해제</button></div>
        </div>
        <div class="d-body">
          ${section('data', '항적 데이터 <small>ABFAP 값을 m·m/s로 변환</small>', '<dl class="kv2" data-k="data"></dl>')}
          ${section('tel', '상세 텔레메트리 <small>온톨로지 변환 규칙 적용 · 표시 전용</small>', '<div data-k="tel"></div>')}
          ${section('telraw', '텔레메트리 원본 <small>ABFAP telemetry 그대로 · 공통 파라미터 대응</small>', '<div data-k="telraw"></div>')}
          ${section('items', '판정 <small>판정 엔진 결과 아님</small>', `<div class="ext-note"><b>판정 없음(외부 항적)</b><p>ABFAP 항적은 판정 결과가 아니므로 판정 단계(정상·주의·경고·비상)를 붙이지 않고 위치·속도만 표시함. 마지막 유효 수신 후 ${(TMS.staleMs() / 1000).toFixed(0)}초가 지나면 정보 없음으로 바꾸고 위치를 숨김.</p></div>`)}
          ${section('paths', 'ABFAP 전송 정보 <small>수신기 X-API-Key 검증</small>', '<dl class="kv2" data-k="abfap"></dl>')}
          <p class="d-hint">기체 키는 callsign(없으면 model)임. ABFAP 항적에는 ICAO 24비트 주소가 없음. 판정이 없는 외부 항적이므로 병행 운용 판단 기록은 두지 않음.</p>
        </div>
        <button type="button" class="d-foot" data-act="events">이 항적의 이력 보기 <span>↗</span></button>`;
      return;
    }
    root.innerHTML = `<div class="d-head">
        <div class="eyebrow">${ac.virtual ? '가상기체' : '실증기 · 유인'}</div>
        <h1>${ac.id}</h1>
        <div class="d-status" data-k="status"></div>
        <div class="d-meta" data-k="meta"></div>
        <div class="d-paths" data-k="pathicon"></div>
        <div class="d-actions"><button type="button" class="btn btn--sm" data-act="follow" data-k="follow">지도에서 따라가기</button><button type="button" class="btn btn--sm" data-act="unselect">선택 해제</button></div>
      </div>
      <div class="d-body">
        ${section('data', '기체 데이터', '<dl class="kv2" data-k="data"></dl>')}
        ${section('items', '판정 근거 <small>판정 엔진 결과 표시 · 한계값은 절차·정책 데이터</small>', `<div class="stale-note" data-k="stale-note" hidden><p><b>정보 없음</b> 마지막 유효 수신 후 <span data-k="stale-age"></span> 경과함. 오래된 값을 최신처럼 보이지 않도록 판정 값을 숨김.</p><button type="button" class="btn btn--sm" data-act="stale" data-k="stale-btn">마지막 수신 값 보기(참고)</button></div><div data-k="items"></div>`)}
        ${section('paths', '수신 경로 대조 <small>ADS-B는 저신뢰 입력</small>', '<div data-k="paths"></div>')}
        ${section('proc', '절차·구간', '<div data-k="proc"></div>')}
        ${section('ver', '판정 기록 버전·서명 <small>판정 재현용</small>', '<dl class="kv2" data-k="ver"></dl>')}
        ${section('op', '병행 운용 판단 기록 <small>시스템 판정과 나란히 기록</small>', `<div class="op-choices">${['normal', 'caution', 'warning', 'emergency'].map(k => `<button type="button" class="op-btn op-btn--${k}" data-act="op" data-op="${k}">${ST[k].label}</button>`).join('')}</div>
          <div class="op-row"><input type="text" data-k="op-note" maxlength="120" placeholder="메모(선택)"><button type="button" class="btn btn--primary btn--sm" data-act="op-save" data-k="op-save" disabled>기록</button></div>
          <p class="hint" data-k="op-hint"></p><div data-k="op-list"></div>`)}
      </div>
      <button type="button" class="d-foot" data-act="events">이 기체의 경보·이력 보기 <span>↗</span></button>`;
  }

  function itemsTable(r, stale) {
    return `<table class="tbl${stale ? ' is-stale' : ''}">
      ${stale ? `<caption>참고: ${kstMs(r.t)} KST 기준 값이며 최신이 아님</caption>` : ''}
      <thead><tr><th>항목 <small>규칙 · 요구사항</small></th><th>상태</th><th class="r">측정값</th></tr></thead>
      <tbody>${r.items.map(it => `<tr class="it--${it.status}">
        <td>${it.label}<small class="mono">${it.rule} · ${it.req}</small></td>
        <td>${stTag(it.status)}</td><td class="r num">${F.esc(it.value)}</td></tr>`).join('')}</tbody></table>`;
  }

  function updateDetail() {
    if (S.selected !== forId || !$('#detail').firstChild || (builtMissing && acOf(forId))) buildDetail();
    const id = forId;
    if (!id && CTL) {
      const c = counts();
      const cs = ctlStatus();
      const [cls, txt] = CTL_PHASE[cs.phase] || CTL_PHASE.none;
      const by = k => M.AIRCRAFT.filter(a => a.source === k).length;
      q('ov-n').textContent = M.AIRCRAFT.length;
      q('ov-status').innerHTML = `<span class="st-text st-text--${cls === 'ok' ? 'normal' : cls === 'bad' ? 'emergency' : cls === 'warn' ? 'caution' : 'nodata'}">ABFAP 수신기 ${txt}</span>`;
      q('ov-meta').innerHTML = `X-Plane <b>${by('xplane')}</b> · ABSim <b>${by('absim')}</b> · 재생 <b>${by('replay')}</b><br>정보 없음 기준 <b>${(TMS.staleMs() / 1000).toFixed(0)}초</b>(제어 모드)`;
      q('ov-body').innerHTML = kv(ST_KEYS.map(k => [ST[k].label, `<span class="${c[k] && k === 'nodata' ? 'st-text--nodata' : ''}">${c[k]}건</span>`]))
        + kv([['마지막 스냅샷', cs.snap ? `seq ${cs.snap.seq} · ${kstMs(cs.snap.t)} KST` : '—'], ['미확인 경보', `${S.unacked().length}건`]]);
      return;
    }
    if (!id) {
      const c = counts();
      const bad = S.feedStale();
      q('ov-status').innerHTML = bad ? '<span class="st-text st-text--emergency">판정 결과 두절</span>' : '<span class="st-text st-text--normal">수신 중</span>';
      q('ov-body').innerHTML = kv(['emergency', 'warning', 'nodata', 'caution', 'normal']
        .map(k => [ST[k].label, `<span class="${c[k] && k !== 'normal' ? `st-text--${k}` : ''}">${c[k]}대</span>`]))
        + kv([['미확인 경보', `${S.unacked().length}건`]]);
      return;
    }
    const r = S.recs[id];
    const st = S.displayStatus(id);
    const fresh = st !== 'nodata';
    if (!acOf(id) || builtMissing) return;
    if (CTL) { updateDetailControl(id, r, st, fresh); return; }
    q('follow').classList.toggle('is-on', S.follow);
    q('status').innerHTML = `${stText(st)}${fresh && st !== 'normal' && r.cause ? `<span class="d-cause">${r.cause}</span>` : ''}`;
    q('meta').innerHTML = !r ? '수신 이력 없음'
      : fresh ? `판정 시각 <b class="mono">${kstMs(r.t)}</b> KST · ${F.age(S.now - r.t)} 수신<br>ID <b>${id}</b> · ${acOf(id).type}`
        : `마지막 유효 수신 <b class="mono">${kstMs(r.t)}</b> KST · <span class="st-text--nodata">${ago(S.now - r.t)} 경과</span><br>ID <b>${id}</b> · ${acOf(id).type}`;
    const pa = r && fresh ? r.paths : null;
    q('pathicon').innerHTML = `<svg viewBox="0 0 20 20" class="halves"><path class="${pa && pa.ADSB.state === 'ok' ? 'on' : 'off'}" d="M10 2a8 8 0 0 0 0 16z"/><path class="${pa && tlmOk(r) ? 'on' : 'off'}" d="M10 2a8 8 0 0 1 0 16z"/></svg>
      <span>ADS-B ${pa ? (pa.ADSB.state === 'ok' ? '수신' : '두절') : '—'}${tlmLinks(r).map(l => ` · ${l.label} ${pa ? linkStateText(l) : '—'}`).join('')}${pa && r.fusion.flag === 'mismatch' ? ' · <b class="st-text--emergency">불일치</b>' : ''}</span>`;

    const dash = '—';
    q('data').innerHTML = r ? kv([
      ['고도', fresh ? `${Math.round(r.fused.alt_ft)} ft` : dash],
      ['속도', fresh ? `${Math.round(r.fused.gs_kt)} kt` : dash],
      ['수직속도', fresh ? `${Math.round(r.fused.vs_fpm)} fpm` : dash],
      ['진행 방향', fresh ? `${Math.round(r.fused.hdg)}°` : dash],
      ['위치', fresh ? `${r.fused.lat.toFixed(5)}°,<br>${r.fused.lon.toFixed(5)}°` : dash],
      ['마지막 수신', fresh ? ago(S.now - r.t) : `<span class="st-text--nodata">${ago(S.now - r.t)} 경과</span>`],
      ['데이터 출처', r.virtual ? '가상 주입' : `ADS-B · 텔레메트리(${tlmLinks(r).map(l => l.label).join('+')})`],
      ['절차·구간', fresh ? r.proc.label : dash],
    ]) : '<p class="muted">수신 이력 없음</p>';

    q('stale-note').hidden = fresh || !r;
    if (!fresh && r) q('stale-age').textContent = ago(S.now - r.t);
    q('stale-btn').textContent = showStale ? '마지막 수신 값 숨기기' : '마지막 수신 값 보기(참고)';
    q('items').innerHTML = r && (fresh || showStale) ? itemsTable(r, !fresh) : '';

    if (r) {
      const row = (name, note, p) => `<tr><td>${name}<small>${note}</small></td>
        <td>${!fresh ? '<span class="muted">정보 없음</span>' : p.state === 'ok' ? '<span class="st-text--normal">수신</span>' : p.state === 'none' ? '<span class="muted">수신 이력 없음</span>' : '<span class="st-text--warning">두절</span>'}</td>
        <td class="num">${p.t_last == null ? '—' : kstMs(p.t_last)}</td><td class="r num">${p.t_last == null ? '—' : ago(S.now - p.t_last)}</td>
        <td class="num">${fresh && p.state === 'ok' ? `${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}°<br>${Math.round(p.alt_ft)} ft` : '—'}</td></tr>`;
      let fus;
      if (!fresh) fus = '<span class="muted">정보 없음</span>';
      else if (r.fusion.flag === 'ok') fus = `<span class="st-text--normal">일치</span> · 경로 간 차 ${r.fusion.diff_m.toFixed(0)} m`;
      else if (r.fusion.flag === 'single') fus = '<span class="st-text--warning">단일 경로 감시</span> · 텔레메트리 두절, ADS-B로 감시 지속';
      else fus = `<span class="st-text--emergency">불일치</span> · 경로 간 차 ${r.fusion.diff_m.toFixed(0)} m · 데이터 이상`;
      q('paths').innerHTML = `<table class="tbl"><thead><tr><th>경로</th><th>상태</th><th>마지막 수신</th><th class="r">경과</th><th>위치·고도</th></tr></thead>
        <tbody>${row('ADS-B', '저신뢰', r.paths.ADSB)}${tlmLinks(r).map(l => row(`텔레메트리 ${l.label}`, l.name === 'LORA' ? 'LoRa 전용 링크' : 'MANET(이동 애드혹 망)', l)).join('')}</tbody></table>
        <p class="fusion">텔레메트리 구성 · ${!(r.telemetry_links || []).length ? '미지정(이중화 판정 안 함)' : tlmLinks(r).length > 1 ? `이중(${tlmLinks(r).map(l => l.label).join('+')})` : `단일(${tlmLinks(r).map(l => l.label).join('')})`}${fresh && (r.reasons || []).includes('LINK_REDUNDANCY_LOST') ? ' · <span class="st-text--warning">이중화 상실</span>' : ''}</p>
        <p class="fusion">위치 융합 · ${fus}</p>${r.virtual ? '<p class="hint">가상기체는 무선 구간을 거치지 않고 입력단에 같은 형식으로 주입됨.</p>' : ''}`;
    } else q('paths').innerHTML = '<p class="muted">수신 이력 없음</p>';

    if (r && fresh && r.proc.id) {
      const p = r.proc;
      const segs = Array.from({ length: p.segCount }, (_, i) => {
        const cls = i < p.seg ? 'done' : i === p.seg ? 'cur' : 'todo';
        const fill = i === p.seg ? Math.round(p.segFrac * 100) : i < p.seg ? 100 : 0;
        return `<div class="seg-step seg-step--${cls}"><span>S${i + 1}</span><div class="seg-step__bar"><div style="width:${fill}%"></div></div></div>`;
      }).join('');
      const hold = p.hold ? `<div class="hold-box"><b>공중대기 ${p.hold.fix}</b> ${p.hold.lap}/${p.hold.laps}바퀴 · 예상 접근 시각 <span class="mono">${kst(p.hold.until)}</span> KST (${ago(Math.max(0, p.hold.until - S.now))} 후)</div>` : '';
      q('proc').innerHTML = `${hold}<div class="proc-title"><b class="mono">${p.id}</b> v${p.ver} · ${p.kind} · ${M.vpName(p.vp)} <em class="tag tag--virtual">가상 예시 절차</em></div>
        <div class="seg-steps">${segs}</div><p class="hint">현재 구간은 판정 엔진이 절차의 전환 기준으로 판별한 결과임.</p>`;
    } else q('proc').innerHTML = r && fresh ? `<p>${r.proc.label}</p>` : '<p class="muted">정보 없음</p>';

    q('ver').innerHTML = r ? kv([
      ['절차', `<span class="mono">${r.versions.procedure}</span>`],
      ['정책', `<span class="mono">${r.versions.policy}</span>`],
      ['규칙 구성', `<span class="mono">${r.versions.ruleset}</span>`],
      ['서명 검증', sigRecent(id) ? `<span class="st-text--emergency">실패</span> · ${kst(S.sigFail[id])} 메시지 폐기` : '<span class="st-text--normal">통과</span> <small class="muted">(모사)</small>'],
    ]) : '';

    q('op-hint').textContent = S.mode === 'live' ? '기록 시점의 시스템 판정과 판정 버전을 함께 저장함.' : '재생 중에는 기록할 수 없음.';
    if (opRendered !== S.opVersion) {
      opRendered = S.opVersion;
      const list = S.opRecords.filter(o => o.ac === id).slice(-6).reverse();
      q('op-list').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>시각</th><th>시스템</th><th>관제 요원</th><th>비교</th></tr></thead><tbody>
        ${list.map(o => `<tr><td class="num">${kst(o.wall)}</td><td>${stTag(o.sys)}</td><td>${stTag(o.op)}</td><td>${o.sys === o.op ? '<span class="st-text--normal">일치</span>' : '<span class="st-text--warning">불일치</span>'}${o.note ? `<small>${F.esc(o.note)}</small>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">이 기체의 기록 없음</p>';
    }
  }

  // 상세 텔레메트리: 온톨로지(ontology.js)의 변환 규칙으로 바꾼 값을 관측 노드별로 표시함. 값이 없는 항목은 숨기고 개수만 알림
  function telEmpty(r, x, f) {
    if (!r) return '<p class="muted">수신 이력 없음</p>';
    if (!f) return '<p class="muted">정보 없음</p>';
    if (x.telDropped) return '<p class="muted">상세 텔레메트리는 최근 2분만 보관함(이 재생 시점의 값 없음)</p>';
    if (!x.telemetry) return '<p class="muted">상세 텔레메트리 없음(ABFAP가 telemetry를 보내지 않음)</p>';
    return null;
  }
  function telHtml(r, x, f, tv) {
    const e = telEmpty(r, x, f);
    if (e) return e;
    let hidden = 0;
    const html = tv.groups.map(g => {
      const rows = g.rows.filter(row => row.vals.length || (hidden++, false)).map(row => {
        const unit = row.unit === '—' ? '' : row.unit === 'deg' ? '°' : ` ${row.unit}`;
        const val = row.vals.map(v => `${v.n ? `<small class="muted">${v.n}:</small> ` : ''}${F.esc(v.out)}`).join(' · ');
        const raw = row.scaled && !row.idx ? ` <small class="muted">${row.vals[0].raw} ${row.srcUnit}</small>` : '';
        return [row.name, `${val}${unit}${raw}`];
      });
      return `<div class="tel-grp"><h4>${g.name} <small class="mono">${g.obs}</small></h4>${rows.length ? `<dl class="kv2">${kv(rows)}</dl>` : '<p class="muted">값 없음</p>'}</div>`;
    }).join('');
    return `${html}<p class="d-hint">변환식과 관계는 온톨로지 화면의 ABFAP 변환 규칙에 정의됨. 판정 입력이 아님.${hidden ? ` 값이 없는 항목 ${hidden}개는 숨김(X-Plane Data Output에서 켜지 않은 그룹이거나 해당 없음).` : ''}</p>`;
  }
  // 텔레메트리 원본: 받은 그룹·필드 전체. 공통 파라미터에 대응하는 필드는 대응 이름을 붙임. 이름 없는 슬롯(_dummy_)은 뺌
  function telRawHtml(r, x, f, tv) {
    const e = telEmpty(r, x, f);
    if (e) return e;
    const cell = v => (typeof v === 'number' ? (v <= tv.invalid ? '<span class="muted">해당 없음</span>' : (+v.toFixed(4)).toString()) : v == null ? '<span class="muted">null</span>' : F.esc(String(v)));
    const rows = [];
    Object.entries(x.telemetry).forEach(([g, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.entries(v).forEach(([k, val]) => { if (!k.startsWith('_')) rows.push([g, k, cell(val), tv.field[`${g}.${k}`]]); });
      } else if (Array.isArray(v)) rows.push([g, '[8]', v.map(cell).join(', '), null]);
      else rows.push(['—', g, cell(v), tv.field[g]]);
    });
    const mapped = rows.filter(row => row[3]).length;
    return `<p class="d-hint">필드 ${rows.length}개 · 공통 파라미터 대응 ${mapped}개</p><table class="tbl tbl--telraw"><thead><tr><th>그룹</th><th>필드</th><th class="r">값</th><th>공통 파라미터</th></tr></thead><tbody>
      ${rows.map(([g, k, v, p]) => `<tr${p ? ' class="is-mapped"' : ''}><td class="mono">${F.esc(g)}</td><td class="mono">${F.esc(k)}</td><td class="r mono">${v}</td><td class="mono">${p ? F.esc(p) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`;
  }

  // 제어 모드 기체 상세: ABFAP 값(단위 변환)과 전송 정보. 정보 없음이면 값을 숨김
  function updateDetailControl(id, r, st, fresh) {
    const ac = acOf(id);
    const x = r && r.ext;
    const f = r && fresh ? r.fused : null;
    const dash = '—';
    const esc = v => (v == null || v === '' ? dash : F.esc(v));
    const deg1 = v => (v == null ? dash : `${v.toFixed(1)}°`);
    q('follow').classList.toggle('is-on', S.follow);
    q('status').innerHTML = `${stText(st)}${ac.replay ? '<span class="d-cause">재생 항적 · 실시간 기체 아님</span>' : ''}`;
    q('meta').innerHTML = !r ? '수신 이력 없음'
      : `${fresh ? '수신기 수신' : '마지막 유효 수신'} <b class="mono">${kstMs(r.t)}</b> KST · ${fresh ? F.age(S.now - r.t) : `<span class="st-text--nodata">${ago(S.now - r.t)} 경과</span>`}<br>기체 키 <b>${F.esc(id)}</b> (${x.keyFrom === 'callsign' ? 'callsign' : 'model'}) · ${ac.type}`;
    q('pathicon').innerHTML = `${srcTag(ac)}${f && x.udp_connected === false ? ' <span class="st-text--caution">ABSim 텔레메트리 미수신</span>' : ''}`;
    const sub = (v, u) => (v == null ? '' : ` <small class="muted">${Math.round(v)} ${u}</small>`);
    q('data').innerHTML = r ? kv([
      ['고도(MSL)', f ? `${fmtM(f.alt_m)}${sub(f.alt_ft, 'ft')}` : dash],
      ['대지속도', f ? `${fmtMps(f.gs_ms)}${sub(f.gs_kt, 'kt')}` : dash],
      ['진대기속도', f ? `${fmtMps(f.tas_ms)}${sub(f.tas_kt, 'kt')}` : dash],
      [x.source === 'absim' ? '교정대기속도' : '지시대기속도', f ? (x.source === 'absim' ? `${fmtMps(f.cas_ms)}${sub(f.cas_kt, 'kt')}` : `${fmtMps(f.ias_ms)}${sub(f.ias_kt, 'kt')}`) : dash],
      ['방위', f ? fmtDeg(f.hdg) : dash],
      ['피치 · 롤', f ? `${deg1(f.pitch)} · ${deg1(f.roll)}` : dash],
      ['위치', f ? `${f.lat.toFixed(5)}°,<br>${f.lon.toFixed(5)}°` : dash],
      ['측정 시각', f && x.ts_ms != null ? `<span class="mono">${kstMs(x.ts_ms)}</span> KST` : dash],
      ['마지막 수신', fresh ? ago(S.now - r.t) : `<span class="st-text--nodata">${ago(S.now - r.t)} 경과</span>`],
    ]) : '<p class="muted">수신 이력 없음</p>';
    const tv = r && x.telemetry && TMS.ontology ? TMS.ontology.telemetryView(x.telemetry, x.source) : null;
    q('tel').innerHTML = telHtml(r, x, f, tv);
    if (q('telraw').closest('.sec').classList.contains('is-open')) q('telraw').innerHTML = telRawHtml(r, x, f, tv);
    const sent = x ? Date.parse(x.sent_at) : NaN;
    q('abfap').innerHTML = r ? kv([
      ['출처(source)', `${SRC[x.source].label} <small class="muted">${SRC[x.source].note}</small>`],
      ['callsign', esc(x.callsign)], ['model', esc(x.model)], ['gufi_id', `<span class="mono">${esc(x.gufi_id)}</span>`],
      ['udp_connected', x.udp_connected == null ? dash : x.udp_connected ? '연결' : '<span class="st-text--caution">끊김(3초 넘게 미수신)</span>'],
      ['ABFAP 세션', x.session_id == null ? dash : `<span class="mono">${x.session_id}</span>`],
      ['전송 순번(seq)', `<span class="mono">${x.seq}</span>`],
      ['전송 시각(sent_at)', isFinite(sent) ? `<span class="mono">${kstMs(sent)}</span> KST` : dash],
      ['키 검증', '<span class="st-text--normal">수신기 통과</span> <small class="muted">(X-API-Key · 메시지 서명 없음)</small>'],
    ]) : '';
  }

  // ---------- 경보·이벤트 ----------
  let evFilter = 'all';
  let evKey = '';
  function filterEvents(f) {
    evFilter = f;
    document.querySelectorAll('#events-filter button').forEach(x => x.classList.toggle('is-on', x.dataset.f === f));
    evKey = '';
  }
  function ackCell(ev) {
    if (S.needsAck(ev)) return `<button type="button" class="btn btn--sm btn--ack" data-ack="${ev.id}">확인</button>`;
    const a = S.acks[ev.id];
    if (a) return `<span class="muted">${a.bulk ? '일괄 소거' : '확인'} ${kst(a.t)}</span>`;
    if (C.ACK_REQUIRED.includes(ev.to)) return '<span class="muted">이전 이력</span>';
    return '<span class="muted">—</span>';
  }
  function updateEvents() {
    const un = S.unacked();
    const cnt = $('#events-unacked');
    cnt.textContent = un.length;
    cnt.classList.toggle('is-zero', !un.length);
    const key = `${S.evVersion}|${evFilter}|${S.selected}|${Math.floor(Date.now() / 10000)}`;
    if (key === evKey) return;
    evKey = key;
    let list = S.events.slice().reverse();
    if (evFilter === 'unacked') list = list.filter(S.needsAck);
    if (evFilter === 'selected') list = list.filter(e => e.ac === S.selected);
    list = list.slice(0, 300);
    $('#events-body').innerHTML = list.length ? `<table class="tbl tbl--events">
      <thead><tr><th>시각 (KST)</th><th>기체</th><th>상태 변화</th><th>원인 항목</th><th>확인</th></tr></thead>
      <tbody>${list.map(ev => `<tr data-ac="${ev.ac}" class="ev ev--${ev.to}${S.needsAck(ev) ? ' is-unacked' : ''}${ev.ac === S.selected ? ' is-selected' : ''}">
        <td class="num">${kstMs(ev.t)}</td>
        <td><span class="ev-ac">${diamond(`dia--${ev.to}${ev.virtual ? ' dia--virtual' : ''}`)}<b>${ev.ac}</b>${ev.virtual ? '<em class="tag tag--virtual">가상</em>' : ''}</span></td>
        <td>${stTag(ev.from)}<span class="arrow">→</span>${stTag(ev.to)}</td>
        <td>${F.esc(ev.cause || '')}</td><td>${ackCell(ev)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted pad">${evFilter === 'unacked' ? '미확인 경보 없음' : '표시할 이벤트 없음'}</p>`;
  }

  // ---------- 시스템·버전 ----------
  let sysLast = 0;
  function updateSystem() {
    if (Date.now() - sysLast < 1000) return;
    sysLast = Date.now();
    const bad = S.feedStale();
    const rx = S.receivers || {};
    const peers = Object.entries(S.peers);
    const ops = S.opRecords;
    const agree = ops.filter(o => o.sys === o.op).length;
    const okTxt = s => (bad ? '<span class="muted">정보 없음</span>' : s === 'ok' ? '<span class="st-text--normal">정상</span>' : '<span class="st-text--emergency">이상</span>');
    const card = (title, rows, extra = '') => `<section class="sec is-open"><div class="sec__head sec__head--static">${title}</div><div class="sec__body"><dl class="kv2">${kv(rows)}</dl>${extra}</div></section>`;
    if (CTL) {
      const cs = ctlStatus();
      const [cls, txt] = CTL_PHASE[cs.phase] || CTL_PHASE.none;
      const tone = { ok: 'normal', bad: 'emergency', warn: 'caution', nodata: 'nodata' }[cls];
      const st = cs.stats || {};
      const n = cs.snap ? cs.snap.counts : null;
      $('#system').innerHTML =
        card('ABFAP 수신', [
          ['수신기', `<span class="st-text--${tone}">${txt}</span>`],
          ['조회 주소', `<span class="mono">${F.esc(C.CONTROL_SNAPSHOT_URL)}</span> <small class="muted">같은 출처</small>`],
          ['마지막 조회 성공', cs.lastOk ? `<span class="mono">${kstMs(cs.lastOk)}</span>` : '—'],
          ['마지막 오류', cs.err ? F.esc(cs.err) : '—'],
          ['수신 키', cs.keyConfigured == null ? '—' : cs.keyConfigured ? '설정됨' : '<span class="st-text--caution">미설정(송신 거절)</span>'],
          ['마지막 스냅샷', cs.snap ? `seq <span class="mono">${cs.snap.seq}</span> · <span class="mono">${kstMs(cs.snap.t)}</span>` : '—'],
          ['스냅샷 항적', n ? `X-Plane ${n.xplane} · ABSim ${n.absim} · 재생 ${n.replay}` : '—'],
          ['받음 / 중복 / 역순', `${st.accepted ?? '—'} / ${st.duplicate ?? '—'} / ${st.out_of_order ?? '—'}`],
          ['재시작 수용', `${st.restart ?? '—'}`],
          ['키 거절 / 빈도 제한', `${st.auth_rejected ?? '—'} / ${st.rate_limited ?? '—'}`],
          ['형식 오류 · 버린 항적', `${st.bad_request ?? '—'} · ${st.tracks_dropped ?? '—'}`],
        ], '<p class="hint">수신기는 최신 스냅샷 1건만 메모리에 둠. 재생은 이 창이 연 뒤 받은 값(최근 30분)으로만 함.</p>')
        + card('연동 화면', [
          ['이 창', `${TMS.VIEWS[S.view].label}${S.screenNo ? ` · 화면 ${S.screenNo}/${S.screenCount}` : ''}`],
          ...peers.map(([, p]) => ['연동 창', `${p.view && TMS.VIEWS[p.view] ? TMS.VIEWS[p.view].label : '확인 중'}${p.screenNo ? ` · 화면 ${p.screenNo}` : ''} · ${F.age(Date.now() - p.seen)} 응답`]),
        ], peers.length ? '<p class="hint">제어 모드 창끼리만 연동됨(데모 창과 분리).</p>' : '<p class="hint">연동된 다른 제어 모드 창 없음</p>')
        + card('표시 규칙', [
          ['판정', '판정 없음(외부 항적)'],
          ['정보 없음 기준', `${(TMS.staleMs() / 1000).toFixed(0)}초 <small class="muted">(제어 모드, 전송 주기 1초)</small>`],
          ['목록에서 내림', `${C.CONTROL_DROP_SEC}초 미수신`],
          ['기체 키', 'callsign(없으면 model)'],
          ['단위', '고도 m · 속도 m/s · 시각 KST'],
          ['확인 필요 상태', C.ACK_REQUIRED.filter(k => k === 'nodata').map(k => ST[k].label).join(', ')],
        ]);
      return;
    }
    $('#system').innerHTML =
      card('데이터 연결', [
        ['판정 결과 수신', bad ? '<span class="st-text--emergency">두절</span>' : '<span class="st-text--normal">정상</span>'],
        ['마지막 수신', `<span class="mono">${kstMs(S.feed.lastOk)}</span>`],
        ['ADS-B 수신기', okTxt(rx.adsb)], ['LoRa 수신기', okTxt(rx.lora)], ['MANET 노드', okTxt(rx.manet)],
        ['서명 검증 통과', `${S.sigCount.ok.toLocaleString()}건`],
        ['서명 검증 실패', `${S.sigCount.fail}건${S.sigCount.lastFail ? ` (${kst(S.sigCount.lastFail)})` : ''}`],
      ])
      + card('시각 동기', (() => {
        const ck = bad ? null : S.timeSync;
        const CK = { OK: '<span class="st-text--normal">정상</span>', ATTENTION: '<span class="st-text--caution">주의</span>', NO_REPORT: '<span class="st-text--caution">보고 없음</span>', NO_INFO: '<span class="muted">정보 없음</span>' };
        const ms = v => { if (v == null) return '—'; const x = Math.round(Number(v) * 10) / 10 || 0; return `<span class="mono">${x > 0 ? '+' : ''}${x.toFixed(1)} ms</span>`; };
        return [
          ['상태', ck ? CK[ck.state] || CK.NO_INFO : CK.NO_INFO],
          ['동기 여부', ck && ck.synced != null ? (ck.synced ? '동기됨' : '동기 안 됨') : '—'],
          ['계층(stratum)', ck && ck.stratum != null ? ck.stratum : '—'],
          ['시각 오차', ms(ck && ck.offset_ms)],
          ['최대 오차 추정', ck && ck.error_ms != null ? `<span class="mono">${Number(ck.error_ms).toFixed(1)} ms</span>` : '—'],
          ['기준 원천', ck && ck.ref ? `<span class="mono">${F.esc(ck.ref)}</span>` : '—'],
          ['보고 나이', ck && ck.age_s != null ? `${ck.age_s}초 전` : '—'],
        ];
      })(), '<p class="hint">핵심 운영 서버의 시각 동기 상태(판단은 상태 수집 에이전트). 교통 판정에는 반영하지 않음.</p>')
      + card('정기 백업', (() => {
        const bk = bad ? null : S.backup;
        const BK = { OK: '<span class="st-text--normal">정상</span>', ATTENTION: '<span class="st-text--caution">주의</span>', NO_REPORT: '<span class="st-text--caution">보고 없음</span>', NO_INFO: '<span class="muted">정보 없음</span>' };
        return [
          ['상태', bk ? BK[bk.state] || BK.NO_INFO : BK.NO_INFO],
          ['마지막 실행', !bk || bk.last_run_ok == null ? '—' : bk.last_run_ok ? '성공' : '<span class="st-text--caution">실패</span>'],
          ['마지막 성공 후', bk && bk.age_s != null ? F.dur(bk.age_s) : '—'],
          ['백업 묶음', bk && bk.set ? `<span class="mono">${F.esc(bk.set)}</span>` : '—'],
        ];
      })(), '<p class="hint">핵심 운영 서버의 정기 백업(백업 → 대조 → 보관 정리) 결과. 판단은 상태 수집 에이전트. 교통 판정과 무관함.</p>')
      + card('연동 화면', [
        ['이 창', `${TMS.VIEWS[S.view].label}${S.screenNo ? ` · 화면 ${S.screenNo}/${S.screenCount}` : ''}`],
        ...peers.map(([, p]) => ['연동 창', `${p.view && TMS.VIEWS[p.view] ? TMS.VIEWS[p.view].label : '확인 중'}${p.screenNo ? ` · 화면 ${p.screenNo}` : ''} · ${F.age(Date.now() - p.seen)} 응답`]),
      ], peers.length ? '' : '<p class="hint">연동된 다른 창 없음</p>')
      + card('적용 버전', [
        ['정책', `<span class="mono">${M.VERSIONS.policy}</span>`], ['규칙 구성', `<span class="mono">${M.VERSIONS.ruleset}</span>`],
        ...M.PROCS.map(p => ['절차 (가상)', `<span class="mono">${p.id} v${p.ver}</span>`]),
      ])
      + card('표시 규칙', [
        ['정보 없음 기준', `${(TMS.staleMs() / 1000).toFixed(1)}초 (초기값)`], ['항적 길이', `${C.TRAIL_SEC}초`],
        ['확인 필요 상태', C.ACK_REQUIRED.map(k => ST[k].label).join(', ')],
      ])
      + card('병행 운용 기록', [['기록', `${ops.length}건`], ['일치 / 불일치', `${agree} / ${ops.length - agree}`]], '<p class="hint">일치율 평가는 기록 서비스에서 수행함.</p>');
  }

  // ---------- 버티포트 운항일정 ----------
  let schedVp = M.VERTIPORTS.length ? M.VERTIPORTS[0].id : null;
  let schedAt = 0;
  let schedSel;
  function bindSchedule() {
    const seg = $('#sched-vp');
    seg.innerHTML = M.VERTIPORTS.map(v => `<button type="button" data-vp="${v.id}">${M.vpName(v.id)}</button>`).join('') + ' <em class="tag tag--virtual">가상</em>';
    seg.addEventListener('click', e => { const b = e.target.closest('[data-vp]'); if (b) { schedVp = b.dataset.vp; schedAt = 0; } });
    ['#arr-body', '#dep-body'].forEach(s => $(s).addEventListener('click', e => {
      const tr = e.target.closest('tr[data-ac]');
      if (tr) S.select(tr.dataset.ac);
    }));
  }
  const hm = ms => kst(ms).slice(0, 5);
  function diffTag(plan, t) {
    const d = Math.round((t - plan) / 60000);
    if (!d) return '';
    return `<span class="t-diff t-diff--${d > 0 ? 'late' : 'early'}">${d > 0 ? '+' : ''}${d}분</span>`;
  }
  function updateSchedule() {
    if (CTL) {
      // 제어 모드: ABFAP 항적에는 운항 배정·버티포트 일정이 없음
      if ($('#arr-body').dataset.ctl) return;
      const note = '<p class="muted pad">제어 모드: ABFAP 항적에는 운항 배정·버티포트 일정이 없어 표시하지 않음.</p>';
      $('#arr-body').innerHTML = note;
      $('#dep-body').innerHTML = note;
      $('#arr-body').dataset.ctl = '1';
      $('#arr-count').textContent = '0';
      $('#dep-count').textContent = '0';
      $('#sched-sum').innerHTML = '';
      return;
    }
    document.querySelectorAll('#sched-vp [data-vp]').forEach(b => b.classList.toggle('is-on', b.dataset.vp === schedVp));
    if (Date.now() - schedAt < 1000 && schedSel === S.selected) return;
    schedAt = Date.now();
    schedSel = S.selected;
    const now = S.now;
    const { arrivals, departures } = M.schedule(schedVp, now - 20 * 60000, now + 60 * 60000);
    const nodata = id => S.displayStatus(id) === 'nodata';
    const segOf = (id, proc) => { const r = S.recs[id]; return r && r.proc.id === proc ? ` · S${r.proc.seg + 1}` : ''; };

    const arrState = r => {
      if (now >= r.tEvent) return { k: 'past', label: '착륙' };
      if (r.hold && now >= r.hold.start && now < r.hold.end) {
        if (nodata(r.ac)) return { k: 'nodata', label: '정보 없음' };
        const lap = Math.min(r.hold.laps, Math.floor((now - r.hold.start) / r.hold.lapMs) + 1);
        return { k: 'hold', label: `공중대기 ${r.hold.fix} (${lap}/${r.hold.laps}바퀴)` };
      }
      if (now >= r.tStart) return nodata(r.ac) ? { k: 'nodata', label: '정보 없음' } : { k: 'active', label: `접근 중${segOf(r.ac, r.proc)}` };
      return { k: 'future', label: '예정' };
    };
    const depState = r => {
      if (now >= r.tEnd) return { k: 'past', label: '출발 완료' };
      if (now >= r.tPad) {
        if (nodata(r.ac)) return { k: 'nodata', label: '정보 없음' };
        return now < r.tEvent ? { k: 'active', label: '패드 대기' } : { k: 'active', label: `출발 중${segOf(r.ac, r.proc)}` };
      }
      return { k: 'future', label: '예정' };
    };
    const table = (rows, stateOf, placeKey, placeLabel) => {
      let html = `<table class="tbl tbl--sched"><thead><tr><th>계획</th><th>예상·실제</th><th>기체</th><th>${placeLabel}</th><th>절차</th><th>상태</th><th>판정</th></tr></thead><tbody>`;
      let lined = false;
      rows.forEach(r => {
        if (!lined && r.tEvent >= now) { html += `<tr class="now-row"><td colspan="7"><div class="now-line">현재 ${kst(now)}</div></td></tr>`; lined = true; }
        const s = stateOf(r);
        const st = S.displayStatus(r.ac);
        const hideEst = s.k !== 'past' && nodata(r.ac);
        html += `<tr data-ac="${r.ac}" class="is-${s.k}${r.ac === S.selected ? ' is-selected' : ''}">
          <td class="t-plan">${hm(r.plan)}</td>
          <td>${hideEst ? '<span class="muted">—</span>' : `<span class="t-est">${hm(r.tEvent)}</span>${diffTag(r.plan, r.tEvent)}`}</td>
          <td><span class="ev-ac">${diamond(`dia--${s.k === 'past' ? 'normal' : st}${r.virtual ? ' dia--virtual' : ''}`)}<b>${r.ac}</b>${r.virtual ? '<em class="tag tag--virtual">가상</em>' : '<em class="tag tag--real">실기체</em>'}</span></td>
          <td>${M.vpName(r[placeKey])}</td>
          <td class="mono">${r.proc}</td>
          <td><span class="sched-st sched-st--${s.k}">${s.label}</span></td>
          <td>${s.k === 'active' || s.k === 'hold' || s.k === 'nodata' ? stTag(st) : '<span class="muted">—</span>'}</td></tr>`;
      });
      if (!lined) html += `<tr class="now-row"><td colspan="7"><div class="now-line">현재 ${kst(now)}</div></td></tr>`;
      return `${html}</tbody></table>`;
    };
    $('#arr-body').innerHTML = table(arrivals, arrState, 'from', '출발지');
    $('#dep-body').innerHTML = table(departures, depState, 'to', '도착지');
    $('#arr-count').textContent = arrivals.length;
    $('#dep-count').textContent = departures.length;

    const nextArr = arrivals.find(r => r.tEvent > now && arrState(r).k === 'future') || arrivals.find(r => r.tEvent > now);
    const nextDep = departures.find(r => r.tEvent > now);
    const approaching = arrivals.filter(r => arrState(r).k === 'active').length;
    const atPad = departures.filter(r => now >= r.tPad && now < r.tEvent && !nodata(r.ac)).length;
    $('#sched-sum').innerHTML = kv([
      ['다음 출항', nextDep ? `${nextDep.ac} ${hm(nextDep.tEvent)}` : '—'],
      ['패드 대기', `${atPad}`],
      ['접근 중', `${approaching}`],
      ['공중대기', `${arrivals.filter(r => arrState(r).k === 'hold').length}`],
      ['다음 입항', nextArr ? `${nextArr.ac} ${hm(nextArr.tEvent)}` : '—'],
    ]);
  }

  // ---------- 지도 위 경보·수신 표시 ----------
  function updateAlerts() {
    const el = $('#alert-strip');
    // 5분(설정)이 지난 미확인 경보는 띠에서 내림(확인 요구는 유지: 경보·이벤트 목록, 탭 숫자)
    const hideMs = (C.ALERT_STRIP_HIDE_SEC || 300) * 1000;
    const un = S.unacked().filter(ev => S.now - ev.t < hideMs);
    const bad = S.feedStale() && S.mode === 'live';
    const key = `${S.evVersion}|${un.map(ev => ev.id).join(',')}|${bad}|${CTL ? ctlStatus().phase : ''}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const top = un.slice().sort((a, b) => ST[a.to].rank - ST[b.to].rank || b.t - a.t).slice(0, 3);
    const feedMsg = CTL
      ? `<div class="alert alert--feed"><b>${({ none: 'ABFAP 수신기 없음', connecting: 'ABFAP 수신기 연결 중' })[ctlStatus().phase] || 'ABFAP 수신기 연결 끊김'}</b><span>모든 항적을 정보 없음으로 표시함. 화면의 값은 최신이 아님.</span></div>`
      : '<div class="alert alert--feed"><b>판정 결과 수신 두절</b><span>모든 기체를 정보 없음으로 표시함. 화면의 값은 최신이 아님.</span></div>';
    el.innerHTML = (bad ? feedMsg : '')
      + top.map(ev => `<div class="alert alert--${ev.to}" data-ac="${ev.ac}"><b>${ST[ev.to].label}</b><span>${ev.ac}${ev.virtual ? ' (가상)' : ''} · ${F.esc(ev.cause || '')} · ${kst(ev.t)}</span><button type="button" class="btn btn--sm btn--ack" data-ack="${ev.id}">확인</button></div>`).join('')
      + (un.length > 3 ? `<div class="alert alert--more">미확인 ${un.length - 3}건 더 있음</div>` : '');
  }
  function ring(pct, label) {
    const r = 13, c = 2 * Math.PI * r;
    const cls = pct == null ? 'nodata' : pct >= 100 ? 'ok' : pct >= 50 ? 'warn' : 'bad';
    return `<div class="gauge gauge--${cls}"><svg viewBox="0 0 32 32"><circle class="g-bg" cx="16" cy="16" r="${r}"/><circle class="g-fg" cx="16" cy="16" r="${r}" stroke-dasharray="${((pct || 0) / 100 * c).toFixed(1)} ${c.toFixed(1)}"/><text x="16" y="19.5">${label}</text></svg><b>${pct == null ? '—' : `${pct}%`}</b></div>`;
  }
  function updateGauges() {
    if (CTL) { $('#gauges').innerHTML = ''; return; } // 제어 모드: 수신 경로(ADS-B·텔레메트리) 비율 없음
    const fresh = M.AIRCRAFT.filter(a => S.isFresh(a.id));
    const share = ok => (S.feedStale() ? null : Math.round(fresh.filter(a => ok(S.recs[a.id])).length / M.AIRCRAFT.length * 100));
    const el = $('#gauges');
    // 링크별 비율은 해당 링크를 쓰는 기체(이중·단일 구성)만 분모로 함
    const linkPct = name => {
      if (S.feedStale()) return null;
      const users = M.AIRCRAFT.filter(a => (S.recs[a.id].telemetry_links || []).includes(name));
      if (!users.length) return null;
      return Math.round(users.filter(a => S.isFresh(a.id) && (S.recs[a.id].paths[`TELEMETRY/${name}`] || {}).state === 'ok').length / users.length * 100);
    };
    el.innerHTML = ring(share(r => r.paths.ADSB.state === 'ok'), 'A') + ring(share(tlmOk), 'T') + ring(linkPct('LORA'), 'L') + ring(linkPct('MANET'), 'M');
    el.title = '경로별 수신 기체 비율 · A: ADS-B · T: 텔레메트리 · L: LoRa · M: MANET(링크 사용 기체 기준)';
  }

  // ---------- 알림 ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  let player;
  const visible = id => { const el = document.getElementById(id); return el && el.offsetParent !== null; };
  function init() {
    buildTabs();
    buildList();
    bindDetail();
    bindSchedule();
    player = Player($('#timeline'));
    document.querySelectorAll('#rail [data-rail]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.rail === 'assets') document.body.classList.toggle('assets-closed');
      else S.setView(b.dataset.rail);
    }));
    const ackOrSelect = e => {
      const b = e.target.closest('[data-ack]');
      if (b) { e.stopPropagation(); S.ack(b.dataset.ack); return; }
      const a = e.target.closest('[data-ac]');
      if (a) { S.select(a.dataset.ac); TMS.mapView.focus(a.dataset.ac); }
    };
    $('#alert-strip').addEventListener('click', ackOrSelect);
    $('#events-body').addEventListener('click', ackOrSelect);
    document.querySelectorAll('#events-filter button').forEach(b => b.addEventListener('click', () => filterEvents(b.dataset.f)));
  }
  function update() {
    updateChrome();
    player.update();
    if (visible('pane-list')) updateList();
    if (visible('pane-detail')) updateDetail();
    if (visible('pane-events')) updateEvents();
    if (visible('pane-system')) updateSystem();
    if (S.view === 'flightplan') updateSchedule();
    if (visible('pane-map')) { updateAlerts(); updateGauges(); }
  }

  TMS.panels = { init, update, toast, filterEvents, rebuildTabs: buildTabs };
})();
