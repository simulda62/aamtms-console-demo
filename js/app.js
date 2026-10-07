// AAM TMS 내부 관제 화면 시안 - 초기화, 멀티모니터 구성, 시안 제어, 단축키
(function () {
  const C = TMS.config, S = TMS.state, M = TMS.mock, ST = TMS.STATUS;
  const $ = sel => document.querySelector(sel);

  // ---------- 멀티모니터 구성 ----------
  const mm = { count: 3, screens: null, assign: [], note: '' };
  function urlFor(view, i, n) {
    const p = new URLSearchParams({ view, screen: String(i + 1), of: String(n), lang: TMS.i18n.lang });
    return `${location.pathname}?${p}`;
  }
  function featuresFor(scr) {
    if (!scr) return 'popup,width=1440,height=900';
    return `popup,left=${scr.availLeft},top=${scr.availTop},width=${scr.availWidth},height=${scr.availHeight}`;
  }
  function resetAssign() {
    const preset = TMS.LAYOUT_PRESETS[mm.count];
    mm.assign = preset.map((view, i) => ({ view, screen: mm.screens && mm.screens[i] ? i : null }));
  }
  function renderMulti() {
    const box = $('#multi-body');
    const scrOpts = sel => ['<option value="">수동 배치</option>']
      .concat((mm.screens || []).map((s, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>모니터 ${i + 1}${s.isPrimary ? '(주)' : ''} · ${s.width}×${s.height}${s.label ? ` · ${s.label}` : ''}</option>`)).join('');
    const viewOpts = sel => Object.entries(TMS.VIEWS).filter(([k]) => k !== 'main')
      .map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v.label}</option>`).join('');
    box.innerHTML = `
      <div class="seg-ctrl">${Object.keys(TMS.LAYOUT_PRESETS).map(Number).map(n => `<button type="button" data-count="${n}" class="${mm.count === n ? 'is-on' : ''}">모니터 ${n}대</button>`).join('')}</div>
      <div class="mm-preview">${mm.assign.map((a, i) => `<div class="mm-screen"><small>화면 ${i + 1}${i === 0 ? ' (이 창)' : ''}</small><b>${TMS.VIEWS[a.view].label}</b></div>`).join('')}</div>
      <table class="tbl mm-table"><thead><tr><th>화면</th><th>역할</th><th>모니터</th><th></th></tr></thead><tbody>
      ${mm.assign.map((a, i) => `<tr><td>화면 ${i + 1}${i === 0 ? '<small>이 창</small>' : ''}</td>
        <td><select data-role="${i}">${viewOpts(a.view)}</select></td>
        <td><select data-scr="${i}"${mm.screens ? '' : ' disabled'}>${scrOpts(a.screen)}</select></td>
        <td>${i === 0 ? '' : `<button type="button" data-open="${i}">이 화면만 열기</button>`}</td></tr>`).join('')}
      </tbody></table>
      <div class="mm-detect"><button type="button" id="mm-detect">모니터 정보 가져오기</button><span>${mm.note || (mm.screens ? `모니터 ${mm.screens.length}대 감지` : '모니터 배치 정보 없음: 창을 연 뒤 각 모니터로 옮기고 "전체 화면"을 누를 것')}</span></div>
      <p class="hint">선택 기체, 재생 시점, 경보 확인, 병행 운용 기록은 모든 창에 동기화됨. 브라우저가 팝업을 막으면 주소창에서 팝업을 허용하거나 "이 화면만 열기"를 화면별로 누를 것.</p>`;
    box.querySelectorAll('[data-count]').forEach(b => b.addEventListener('click', () => { mm.count = Number(b.dataset.count); resetAssign(); renderMulti(); }));
    box.querySelectorAll('[data-role]').forEach(s => s.addEventListener('change', () => { mm.assign[Number(s.dataset.role)].view = s.value; renderMulti(); }));
    box.querySelectorAll('[data-scr]').forEach(s => s.addEventListener('change', () => { mm.assign[Number(s.dataset.scr)].screen = s.value === '' ? null : Number(s.value); }));
    box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openOne(Number(b.dataset.open))));
    $('#mm-detect').addEventListener('click', detectScreens);
  }
  async function detectScreens() {
    if (!('getScreenDetails' in window)) {
      mm.note = '이 브라우저는 화면 배치 기능을 지원하지 않음(Chromium 계열 필요). 창을 연 뒤 수동으로 옮길 것.';
      renderMulti();
      return;
    }
    try {
      const d = await window.getScreenDetails();
      mm.screens = d.screens;
      mm.note = '';
      resetAssign();
    } catch (e) {
      mm.note = '모니터 정보 접근이 허용되지 않음. 수동 배치로 진행함.';
    }
    renderMulti();
  }
  function openOne(i) {
    const a = mm.assign[i];
    const scr = a.screen != null && mm.screens ? mm.screens[a.screen] : null;
    return window.open(urlFor(a.view, i, mm.assign.length), `aamtms-screen-${i + 1}`, featuresFor(scr));
  }
  function openAll() {
    let blocked = 0;
    for (let i = 1; i < mm.assign.length; i++) if (!openOne(i)) blocked++;
    if (blocked) {
      mm.note = `팝업 ${blocked}개가 차단됨. 팝업을 허용하거나 "이 화면만 열기"로 하나씩 열 것. 모두 연 뒤 "이 창 전환"을 누를 것.`;
      renderMulti();
      $('#mm-open').textContent = '이 창 전환';
      $('#mm-open').onclick = () => { location.href = urlFor(mm.assign[0].view, 0, mm.assign.length); };
      return;
    }
    location.href = urlFor(mm.assign[0].view, 0, mm.assign.length);
  }
  function initMulti() {
    const modal = $('#modal-multi');
    $('#btn-multi').addEventListener('click', () => {
      mm.note = '';
      resetAssign();
      renderMulti();
      $('#mm-open').textContent = '창 열기';
      $('#mm-open').onclick = openAll;
      $('#mm-close-all').hidden = !S.screenNo && !Object.keys(S.peers).length;
      modal.hidden = false;
    });
    $('#mm-cancel').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
    $('#mm-close-all').addEventListener('click', () => {
      S.closeAll();
      location.href = `${location.pathname}?view=main&lang=${TMS.i18n.lang}`;
    });
  }

  // ---------- 시안 제어 ----------
  function initDemo() {
    const panel = $('#demo-panel');
    $('#btn-demo').addEventListener('click', () => { panel.hidden = !panel.hidden; });
    $('#demo-close').addEventListener('click', () => { panel.hidden = true; });
    const sel = $('#demo-ac');
    sel.innerHTML = M.AIRCRAFT.map(a => `<option value="${a.id}">${a.id}${a.virtual ? ' (가상)' : ''}</option>`).join('');
    $('#demo-feed').addEventListener('change', e => S.setFeedDown(e.target.checked));
    // 시안 전용 일괄 소거(상태줄 구석 단추와 시안 제어). 묻고 나서 모든 연동 창에 적용함
    // 브라우저 확인 창(confirm)은 내장 브라우저·전체 화면 등에서 막혀 바로 '취소'가 되므로, 화면 안에서 두 번 눌러 실행함
    // 첫 번째 누름: "한 번 더 누르면 소거"로 바뀜(4초 안에 다시 누르면 실행, 지나면 원래대로)
    const bulkBtns = ['#btn-ack-all', '#demo-ack-all'].map(s => $(s));
    let armTimer = null;
    const disarm = () => { clearTimeout(armTimer); bulkBtns.forEach(b => b.classList.remove('is-armed')); };
    const ackAll = e => {
      const btn = e.currentTarget;
      if (!S.unacked().length) { disarm(); TMS.panels.toast('미확인 경보 없음'); return; }
      if (!btn.classList.contains('is-armed')) {
        disarm();
        btn.classList.add('is-armed');
        armTimer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      TMS.panels.toast(`일괄 소거 완료: 미확인 경보 ${S.ackAll()}건`);
    };
    bulkBtns.forEach(b => b.addEventListener('click', ackAll));
    $('#demo-loss').addEventListener('click', () => { S.simLoss(sel.value); TMS.panels.toast(`${sel.value} 수신 두절 10초 모사`); });
    $('#demo-sig').addEventListener('click', () => { S.simSigFail(sel.value); TMS.panels.toast(`${sel.value} 서명 검증 실패 10초 모사`); });
    S.on(() => {
      if (panel.hidden) return;
      $('#demo-feed').checked = !!S.overrides.feedDown;
      const live = S.mode === 'live';
      ['#demo-feed', '#demo-loss', '#demo-sig'].forEach(s => { $(s).disabled = !live; });
      if (S.selected && document.activeElement !== sel && sel.dataset.last !== S.selected) { sel.value = S.selected; sel.dataset.last = S.selected; }
    });
  }

  // ---------- 단축키 ----------
  function sortedIds() {
    return M.AIRCRAFT.map(a => ({ a, st: S.displayStatus(a.id) }))
      .sort((x, y) => ST[x.st].rank - ST[y.st].rank || x.a.virtual - y.a.virtual || x.a.id.localeCompare(y.a.id))
      .map(o => o.a.id);
  }
  function initKeys() {
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        const s = $('#asset-search');
        if (s && s.offsetParent) { s.focus(); e.preventDefault(); } else if (TMS.ontology.focusSearch()) e.preventDefault();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ids = sortedIds();
        const i = ids.indexOf(S.selected);
        const n = e.key === 'ArrowDown' ? (i + 1) % ids.length : (i <= 0 ? ids.length - 1 : i - 1);
        S.select(ids[n]);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (!$('#modal-multi').hidden) $('#modal-multi').hidden = true;
        else if (S.view === 'ontology') TMS.ontology.clear();
        else S.select(null);
      } else if (e.key === 'f' || e.key === 'F') {
        S.setFollow(!S.follow);
      } else if (e.key === ' ') {
        if (S.mode === 'replay') { S.togglePause(); e.preventDefault(); }
      } else if (e.key === 'l' || e.key === 'L') {
        S.goLive();
      }
    });
  }

  // 지도는 지도 영역이 보일 때 처음 만들고, 화면 역할이 바뀌면 크기를 다시 맞춤
  let lastView = null;
  let lastAssets = null;
  function syncMap() {
    const closed = document.body.classList.contains('assets-closed');
    if (S.view === lastView && closed === lastAssets) return;
    lastView = S.view;
    lastAssets = closed;
    document.title = TMS.i18n.t(`AAM TMS 관제 · ${TMS.VIEWS[S.view].label} (데모)`);
    const pane = $('#pane-map');
    if (pane && pane.offsetParent !== null) TMS.mapView.ensure($('#map'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.view = S.view;
    TMS.i18n.start();
    document.querySelectorAll('#lang-toggle [data-lang]').forEach(b => {
      b.classList.toggle('is-on', b.dataset.lang === TMS.i18n.lang);
      b.addEventListener('click', () => { if (b.dataset.lang !== TMS.i18n.lang) TMS.i18n.setLang(b.dataset.lang); });
    });
    TMS.panels.init();
    S.on(() => { TMS.panels.update(); syncMap(); TMS.mapView.update(); TMS.ontology.update(); });
    initMulti();
    initDemo();
    initKeys();
    $('#btn-fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
    });
    S.init();
    registerOffline();
    showOfflineDownload();
  });

  // 오프라인 파일(.zip) 받기 단추: 공개 사이트처럼 압축 파일이 있을 때만 보임(로컬 서버·파일로 연 경우에는 숨김)
  function showOfflineDownload() {
    const box = $('#demo-offline');
    if (!box || !/^https?:$/.test(location.protocol)) return;
    fetch('aamtms-console-offline.zip', { method: 'HEAD', cache: 'no-store' }).then(r => { box.hidden = !r.ok; }).catch(() => {});
  }

  // 오프라인 보관: 한 번 열면 그다음부터 인터넷 없이도 열리게 함(sw.js). 파일로 직접 연 경우(file://)는 쓰지 않음
  function registerOffline() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
      // 서비스 워커가 관여하기 전에 받은 화면 파일도 보관하도록 목록을 넘김
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin));
      if (reg.active) reg.active.postMessage({ type: 'precache', page: location.href, urls: [location.href, ...urls] });
    }).catch(() => {});
  }
})();
