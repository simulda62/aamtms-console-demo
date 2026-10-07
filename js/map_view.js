// AAM TMS 관제 화면 시안 - 상황 지도
// 시안은 외부 지도 타일을 사용함. 운영 환경(망 분리)에서는 자체 호스팅 오프라인 타일로 교체해야 함.
(function () {
  const C = TMS.config, S = TMS.state, M = TMS.mock, F = TMS.fmt;
  const COLORS = {
    proc: '#d4d4d4', procActive: '#f5f5f5', procSeg: '#2dd4bf', trail: '#e5e5e5', adsb: '#e879f9', tlm: '#a5f3fc',
  };
  const BASEMAPS = {
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opt: { maxZoom: 19, attribution: 'Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, GIS User Community' },
    },
    // 도로 지도: Esri World Street Map(키 불필요). CARTO는 공개 주소에서 API 키를 요구하여 교체함(2026-10-06).
    dark: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      opt: { maxZoom: 19, attribution: 'Tiles © Esri — Sources: Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS' },
    },
    grid: null,
  };

  let map = null, tile = null, basemap = 'satellite';
  // 공유 링크 판(외부 이미지 차단 환경)에서는 외부 지도 타일을 쓰지 않고 격자 배경만 씀
  const NO_EXTERNAL_TILES = !!(window.TMS_BUILD && window.TMS_BUILD.noExternalTiles);
  let procLayer, trailLayer, rawLayer, acLayer;
  const procSegs = {};
  const markers = {}, trails = {}, raws = {};
  let tileErrors = 0;


  // 인터넷 연결이 없으면 외부 지도 타일 대신 격자 배경을 쓰고, 연결이 돌아오면 고른 배경으로 되돌림
  let chosen = 'satellite';
  const offline = () => navigator.onLine === false;
  function setBasemap(key) {
    chosen = key in BASEMAPS ? key : 'satellite';
    basemap = chosen;
    if (NO_EXTERNAL_TILES || (offline() && BASEMAPS[basemap])) basemap = 'grid';
    if (tile) { map.removeLayer(tile); tile = null; }
    const el = map.getContainer();
    ['satellite', 'dark', 'grid'].forEach(k => el.classList.toggle(`map--${k}`, basemap === k));
    const b = BASEMAPS[basemap];
    if (b) {
      tile = L.tileLayer(b.url, b.opt);
      tileErrors = 0;
      tile.on('tileerror', () => {
        tileErrors++;
        if (tileErrors === 4) TMS.panels.toast('지도 타일을 불러오지 못함. 외부 연결이 없으면 배경을 "격자"로 바꿀 것.');
      });
      tile.addTo(map);
    }
    document.querySelectorAll('input[name="basemap"]').forEach(r => { r.checked = r.value === basemap; });
  }

  // 마름모 표식: 상태 색, 진행 방향 눈금, 가운데 점
  function acIcon(ac) {
    return L.divIcon({
      className: 'mk-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      html: `<div class="mk${ac.virtual ? ' mk--virtual' : ''}">
        <svg class="mk__svg" viewBox="-16 -16 32 32">
          <rect class="mk__halo" x="-12" y="-12" width="24" height="24" transform="rotate(45)"/>
          <g class="mk__hdg"><line x1="0" y1="-9" x2="0" y2="-15"/></g>
          <rect class="mk__dia" x="-7.5" y="-7.5" width="15" height="15" transform="rotate(45)"/>
          <circle class="mk__ring" r="4"/>
          <circle class="mk__dot" r="1.6"/>
        </svg>
        <div class="mk__label"><div class="mk__l1"><span class="mk__id">${ac.id}</span><span class="mk__st"></span></div><div class="mk__l2"></div></div>
      </div>`,
    });
  }

  function init(el) {
    map = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 9, zoomSnap: 0.25 }).setView(C.MAP_CENTER, C.MAP_ZOOM);
    // 넓게 볼 때는 절차 이름을 숨겨 겹침을 줄임
    const syncZoomClass = () => {
      map.getContainer().classList.toggle('zoom-far', map.getZoom() < 12.5);
      map.getContainer().classList.toggle('zoom-mid', map.getZoom() < 14);
    };
    map.on('zoomend', syncZoomClass);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
    map.attributionControl.setPrefix('Leaflet');

    procLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);
    rawLayer = L.layerGroup().addTo(map);
    acLayer = L.layerGroup().addTo(map);

    // 가상 예시 절차
    M.PROCS.forEach(p => {
      procSegs[p.id] = [];
      for (let i = 0; i < p.segCount; i++) {
        procSegs[p.id].push(L.polyline([p.ll[i], p.ll[i + 1]], { color: COLORS.proc, weight: 1.5, opacity: 0.45, dashArray: '5 6', interactive: false }).addTo(procLayer));
      }
      p.ll.slice(1, -1).forEach(ll => {
        L.circleMarker(ll, { radius: 2.5, color: COLORS.proc, weight: 1, opacity: 0.6, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(procLayer);
      });
      // 절차 이름은 가장 긴 구간의 가운데에 둠(대기 기점·버티포트 근처 겹침 방지)
      let li = 0, best = -1;
      for (let i = 0; i < p.segCount; i++) {
        const d = Math.hypot(p.pts[i + 1][0] - p.pts[i][0], p.pts[i + 1][1] - p.pts[i][1]);
        if (d > best) { best = d; li = i; }
      }
      const mid = [(p.ll[li][0] + p.ll[li + 1][0]) / 2, (p.ll[li][1] + p.ll[li + 1][1]) / 2];
      // 국지절차(중심 버티포트 출입항) 이름은 더 확대했을 때만 표시
      const local = !!p.gate;
      L.marker(mid, { interactive: false, icon: L.divIcon({ className: `proc-label${local ? ' proc-label--local' : ''}`, html: `${p.id} <i>가상</i>`, iconSize: [0, 0] }) }).addTo(procLayer);
    });
    // 공중대기 공역(가상): 대기 경로와 기점
    (M.HOLDS || []).forEach(h => {
      L.polyline(h.pattern, { color: '#c4b5fd', weight: 2, opacity: 0.9, dashArray: '4 4', interactive: false }).addTo(procLayer);
      // 대기 기점 표식: 보라 마름모 + 경로 식별자·대기 고도
      L.marker(h.ll, { interactive: false, icon: L.divIcon({ className: 'hold-fix', html: `<span class="hold-fix__mk"></span><span class="hold-fix__txt">${h.id} 공중대기 · ${(h.alts || [h.alt]).slice().sort((a, b) => a - b).join('/')}ft</span>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(procLayer);
    });
    // 시계비행 보고점(가상): 삼각형 표식
    (M.VFR_POINTS || []).forEach(p => {
      L.marker(p.ll, { interactive: false, icon: L.divIcon({ className: 'vrp', html: `<span class="vrp__mk"></span><span class="vrp__txt">${p.id}</span>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(procLayer);
    });
    (M.HOLD_AREAS || []).forEach(a => {
      L.marker(a.ll, { interactive: false, icon: L.divIcon({ className: 'hold-label', html: `${a.id} 공중대기 <i>가상</i>`, iconSize: [0, 0] }) }).addTo(procLayer);
    });
    M.VERTIPORTS.forEach(v => {
      L.marker(v.ll, { interactive: false, icon: L.divIcon({ className: 'vp-icon', html: `<div class="vp">H</div><div class="vp__label">${v.name || v.id} <i>가상</i></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(procLayer);
    });

    M.AIRCRAFT.forEach(ac => {
      trails[ac.id] = L.polyline([], { color: COLORS.trail, weight: 1.5, opacity: 0.4, interactive: false, className: ac.virtual ? 'trail trail--virtual' : 'trail' }).addTo(trailLayer);
      const mk = L.marker(M.toLL(0, 0), { icon: acIcon(ac), keyboard: false, riseOnHover: true }).addTo(acLayer);
      mk.on('click', () => S.select(ac.id));
      markers[ac.id] = mk;
      raws[ac.id] = {
        adsb: L.marker(M.toLL(0, 0), { interactive: false, icon: L.divIcon({ className: 'raw raw--adsb', iconSize: [8, 8], iconAnchor: [4, 4], html: '' }) }),
        tlm: L.circleMarker(M.toLL(0, 0), { radius: 4, color: COLORS.tlm, weight: 1.5, fillOpacity: 0, interactive: false }),
        link: L.polyline([], { color: COLORS.adsb, weight: 1.5, dashArray: '3 4', interactive: false }),
      };
    });

    // 배경 지도는 열 때마다 위성으로 시작함(이전 선택을 기억하지 않음)
    setBasemap('satellite');
    if (offline() && !NO_EXTERNAL_TILES) TMS.panels.toast('인터넷 연결 없음: 지도 배경을 격자로 표시함. 연결되면 위성 배경으로 돌아감.');
    window.addEventListener('offline', () => {
      if (NO_EXTERNAL_TILES || !BASEMAPS[chosen]) return;
      setBasemap(chosen);
      TMS.panels.toast('인터넷 연결 끊김: 지도 배경을 격자로 바꿈. 연결되면 원래 배경으로 돌아감.');
    });
    window.addEventListener('online', () => { if (basemap !== chosen) setBasemap(chosen); });
    fitAll();
    syncZoomClass();
    map.on('mousemove', e => {
      const c = document.getElementById('cursor-ll');
      if (c) c.textContent = `${e.latlng.lat.toFixed(5)}° N · ${e.latlng.lng.toFixed(5)}° E`;
    });
    map.on('dragstart', () => { if (S.follow) S.setFollow(false); });
    bindControls();
    bindLocation();
  }

  function bindControls() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('zoom-in', 'click', () => map.zoomIn());
    on('zoom-out', 'click', () => map.zoomOut());
    on('btn-follow', 'click', () => S.setFollow(!S.follow));
    const lp = document.getElementById('layer-panel');
    const lb = document.getElementById('btn-layers');
    if (lp && lb) {
      // 배경·표시 패널은 닫힌 상태로 시작하고, 배경·표시 버튼을 눌렀을 때만 엶
      lp.classList.remove('is-open');
      lb.classList.remove('is-on');
      lb.addEventListener('click', () => lb.classList.toggle('is-on', lp.classList.toggle('is-open')));
      on('layer-close', 'click', () => {
        lp.classList.remove('is-open');
        lb.classList.remove('is-on');
        // 다시 여는 버튼 위치를 알 수 있도록 잠깐 강조함
        lb.classList.add('is-hint');
        setTimeout(() => lb.classList.remove('is-hint'), 2400);
      });
    }
    on('btn-fit', 'click', () => { S.setFollow(false); fitAll(); });
    document.querySelectorAll('input[name="basemap"]').forEach(r => {
      r.addEventListener('change', () => setBasemap(r.value));
      if (NO_EXTERNAL_TILES && r.value !== 'grid') {
        r.disabled = true;
        r.parentElement.classList.add('is-disabled');
        r.parentElement.title = '공유 링크에서는 외부 지도 타일을 쓸 수 없음';
      }
    });
    const layerTog = layer => v => (v ? layer.addTo(map) : map.removeLayer(layer));
    on('lyr-proc', 'change', e => layerTog(procLayer)(e.target.checked));
    on('lyr-trail', 'change', e => layerTog(trailLayer)(e.target.checked));
    on('lyr-raw', 'change', e => layerTog(rawLayer)(e.target.checked));
    on('lyr-label', 'change', e => map.getContainer().classList.toggle('hide-labels', !e.target.checked));
    on('lyr-virtual', 'change', e => map.getContainer().classList.toggle('hide-virtual', !e.target.checked));
  }

  // 처음 화면: 기준점(제주시청)과 가상 절차·버티포트가 모두 보이도록 맞춤
  function fitAll() {
    const pts = [C.MAP_CENTER].concat(...M.PROCS.map(p => p.ll), M.VERTIPORTS.map(v => v.ll));
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60] });
  }

  // 기준 위치 변경: 목록 선택·직접 입력·지도 중심. 적용하면 저장 후 연동 창과 함께 다시 불러옴.
  function bindLocation() {
    const sel = document.getElementById('loc-preset');
    if (!sel) return;
    const lat = document.getElementById('loc-lat');
    const lon = document.getElementById('loc-lon');
    const msg = document.getElementById('loc-msg');
    sel.innerHTML = Object.entries(TMS.LOCATION_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')
      + '<option value="custom">직접 입력</option>';
    const fill = ll => { lat.value = ll[0].toFixed(5); lon.value = ll[1].toFixed(5); };
    sel.value = TMS.LOCATION_PRESETS[TMS.LOCATION.key] ? TMS.LOCATION.key : 'custom';
    fill(TMS.LOCATION.ll);
    sel.addEventListener('change', () => { if (TMS.LOCATION_PRESETS[sel.value]) fill(TMS.LOCATION_PRESETS[sel.value].ll); });
    [lat, lon].forEach(i => i.addEventListener('input', () => { sel.value = 'custom'; }));
    document.getElementById('loc-here').addEventListener('click', () => { const c = map.getCenter(); fill([c.lat, c.lng]); sel.value = 'custom'; });
    document.getElementById('loc-apply').addEventListener('click', () => {
      const ll = [Number(lat.value), Number(lon.value)];
      if (!isFinite(ll[0]) || !isFinite(ll[1]) || Math.abs(ll[0]) > 85 || Math.abs(ll[1]) > 180 || lat.value === '' || lon.value === '') {
        msg.hidden = false;
        msg.textContent = '위도·경도를 확인할 것';
        return;
      }
      try { localStorage.setItem('aamtms.loc', JSON.stringify({ key: sel.value, ll })); } catch (e) { /* 저장 불가 시 주소로 전달 */ }
      const p = new URLSearchParams(location.search);
      if (p.has('loc')) { p.set('loc', `${ll[0]},${ll[1]}`); history.replaceState(null, '', `${location.pathname}?${p}`); }
      S.reloadAll();
    });
  }

  function update() {
    if (!map) return;
    const sel = S.selected;
    const selRec = sel && S.recs[sel];
    const selProc = selRec && S.isFresh(sel) && selRec.proc.id ? selRec.proc : null;

    Object.entries(procSegs).forEach(([pid, segs]) => {
      segs.forEach((line, i) => {
        let style = { color: COLORS.proc, weight: 1.5, opacity: 0.45, dashArray: '5 6' };
        if (selProc && selProc.id === pid) {
          style = i === selProc.seg
            ? { color: COLORS.procSeg, weight: 3, opacity: 1, dashArray: null }
            : { color: COLORS.procActive, weight: 2, opacity: 0.85, dashArray: '5 4' };
        }
        line.setStyle(style);
      });
    });

    M.AIRCRAFT.forEach(ac => {
      const r = S.recs[ac.id];
      const mk = markers[ac.id];
      const el = mk.getElement();
      if (!r) { if (el) el.style.display = 'none'; return; }
      if (el) el.style.display = '';
      const st = S.displayStatus(ac.id);
      const fresh = st !== 'nodata';
      mk.setLatLng([r.fused.lat, r.fused.lon]);
      mk.setZIndexOffset(ac.id === sel ? 1000 : (5 - TMS.STATUS[st].rank) * 100);
      if (el) {
        const root = el.firstElementChild;
        root.className = `mk mk--${st}${ac.virtual ? ' mk--virtual' : ''}${ac.id === sel ? ' is-selected' : ''}`;
        root.querySelector('.mk__hdg').setAttribute('transform', `rotate(${r.fused.hdg})`);
        root.querySelector('.mk__st').textContent = st === 'normal' ? '' : TMS.STATUS[st].label;
        // 간단 정보 표지: 고도·상승/하강·속도. 수신 두절 시 값 대신 마지막 수신 시각
        const vs = r.fused.vs_fpm;
        const trend = vs > 200 ? '↑' : vs < -200 ? '↓' : '';
        root.querySelector('.mk__l2').textContent = fresh
          ? `${Math.round(r.fused.alt_ft)} ft${trend ? ` ${trend}` : ''} · ${Math.round(r.fused.gs_kt)} kt${r.proc.hold ? ' · HOLD' : ''}`
          : `마지막 수신 ${F.time(r.t + 9 * 3600 * 1000, true)}`;
      }
      trails[ac.id].setLatLngs((S.trails[ac.id] || []).map(p => [p[1], p[2]]));
      trails[ac.id].setStyle({ opacity: fresh ? 0.4 : 0.15 });

      const rw = raws[ac.id];
      if (fresh && (ac.id === sel || r.fusion.flag === 'mismatch')) {
        const a = r.paths.ADSB;
        const t = Object.keys(r.paths).filter(k => k.startsWith('TELEMETRY/')).map(k => r.paths[k]).find(p => p.state === 'ok');
        rw.adsb.setLatLng([a.lat, a.lon]).addTo(rawLayer);
        if (t) rw.tlm.setLatLng([t.lat, t.lon]).addTo(rawLayer); else rawLayer.removeLayer(rw.tlm);
        if (r.fusion.flag === 'mismatch') rw.link.setLatLngs([[a.lat, a.lon], [r.fused.lat, r.fused.lon]]).addTo(rawLayer);
        else rawLayer.removeLayer(rw.link);
      } else {
        rawLayer.removeLayer(rw.adsb); rawLayer.removeLayer(rw.tlm); rawLayer.removeLayer(rw.link);
      }
    });

    if (S.follow && selRec && S.isFresh(sel)) map.panTo([selRec.fused.lat, selRec.fused.lon], { animate: false });
    declutter();
    const fol = document.getElementById('btn-follow');
    if (fol) fol.classList.toggle('is-on', S.follow);
  }

  // 기체 정보 표지 겹침 피하기: 화면 좌표로 표지 상자를 만들고, 겹치면 아래로 비켜 놓고 연결선을 그림
  function declutter() {
    const placed = [];
    M.AIRCRAFT.map(ac => {
      const mk = markers[ac.id];
      const el = mk.getElement();
      if (!el || el.style.display === 'none') return null;
      const lab = el.querySelector('.mk__label');
      if (!lab || lab.offsetParent === null) return null;
      return { lab, p: map.latLngToContainerPoint(mk.getLatLng()), w: lab.offsetWidth, h: lab.offsetHeight, sel: ac.id === S.selected };
    }).filter(Boolean)
      .sort((a, b) => (b.sel - a.sel) || a.p.y - b.p.y || a.p.x - b.p.x)
      .forEach(it => {
        let dy = 0;
        for (let k = 0; k < 10; k++) {
          const box = { x: it.p.x + 14, y: it.p.y - 16 + dy, w: it.w, h: it.h };
          const hit = placed.some(b => box.x < b.x + b.w + 4 && b.x < box.x + box.w + 4 && box.y < b.y + b.h + 2 && b.y < box.y + box.h + 2);
          if (!hit) { placed.push(box); break; }
          dy += it.h + 4;
        }
        it.lab.style.top = `${dy}px`;
        it.lab.style.setProperty('--dy', `${dy}px`);
        it.lab.classList.toggle('is-shifted', dy > 0);
      });
  }

  function focus(id) {
    const r = S.recs[id];
    if (map && r) map.panTo([r.fused.lat, r.fused.lon]);
  }
  function ensure(el) {
    if (map) { map.invalidateSize(); return true; }
    if (typeof L === 'undefined') {
      el.innerHTML = '<p class="map-error">지도 라이브러리를 불러오지 못함. 외부 연결을 확인할 것(운영 환경에서는 라이브러리를 내장해야 함).</p>';
      return false;
    }
    init(el);
    return true;
  }

  TMS.mapView = { ensure, update, focus };
})();
