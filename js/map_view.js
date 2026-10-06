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
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      opt: { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' },
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

  function pref(key, def) { try { return localStorage.getItem('aamtms.' + key) || def; } catch (e) { return def; } }
  function savePref(key, v) { try { localStorage.setItem('aamtms.' + key, v); } catch (e) { /* 저장 불가 시 무시 */ } }

  function setBasemap(key) {
    basemap = key in BASEMAPS ? key : 'satellite';
    if (NO_EXTERNAL_TILES) basemap = 'grid';
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
    savePref('basemap', basemap);
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
        <div class="mk__label"><span class="mk__id">${ac.id}</span><span class="mk__st"></span></div>
      </div>`,
    });
  }

  function init(el) {
    map = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 9 }).setView(C.MAP_CENTER, C.MAP_ZOOM);
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
      const mid = p.ll[Math.floor(p.ll.length / 2) - 1];
      L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'proc-label', html: `${p.id} <i>가상</i>`, iconSize: [0, 0] }) }).addTo(procLayer);
    });
    M.VERTIPORTS.forEach(v => {
      L.marker(v.ll, { interactive: false, icon: L.divIcon({ className: 'vp-icon', html: `<div class="vp">H</div><div class="vp__label">${v.id} <i>가상</i></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(procLayer);
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

    setBasemap(pref('basemap', 'satellite'));
    fitAll();
    map.on('mousemove', e => {
      const c = document.getElementById('cursor-ll');
      if (c) c.textContent = `${e.latlng.lat.toFixed(5)}° N · ${e.latlng.lng.toFixed(5)}° E`;
    });
    map.on('dragstart', () => { if (S.follow) S.setFollow(false); });
    bindControls();
  }

  function bindControls() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('zoom-in', 'click', () => map.zoomIn());
    on('zoom-out', 'click', () => map.zoomOut());
    on('btn-follow', 'click', () => S.setFollow(!S.follow));
    const lp = document.getElementById('layer-panel');
    const lb = document.getElementById('btn-layers');
    if (lp && lb) {
      // 지도 영역이 넉넉할 때만 배경·표시 패널을 펼친 상태로 시작함
      const box = map.getContainer().getBoundingClientRect();
      const wide = box.width >= 900 && box.height >= 560;
      lp.classList.toggle('is-open', wide);
      lb.classList.toggle('is-on', wide);
      lb.addEventListener('click', () => lb.classList.toggle('is-on', lp.classList.toggle('is-open')));
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
      }
      trails[ac.id].setLatLngs((S.trails[ac.id] || []).map(p => [p[1], p[2]]));
      trails[ac.id].setStyle({ opacity: fresh ? 0.4 : 0.15 });

      const rw = raws[ac.id];
      if (fresh && (ac.id === sel || r.fusion.flag === 'mismatch')) {
        const a = r.paths.adsb, t = r.paths.tlm;
        rw.adsb.setLatLng([a.lat, a.lon]).addTo(rawLayer);
        if (t.state === 'ok') rw.tlm.setLatLng([t.lat, t.lon]).addTo(rawLayer); else rawLayer.removeLayer(rw.tlm);
        if (r.fusion.flag === 'mismatch') rw.link.setLatLngs([[a.lat, a.lon], [r.fused.lat, r.fused.lon]]).addTo(rawLayer);
        else rawLayer.removeLayer(rw.link);
      } else {
        rawLayer.removeLayer(rw.adsb); rawLayer.removeLayer(rw.tlm); rawLayer.removeLayer(rw.link);
      }
    });

    if (S.follow && selRec && S.isFresh(sel)) map.panTo([selRec.fused.lat, selRec.fused.lon], { animate: false });
    const fol = document.getElementById('btn-follow');
    if (fol) fol.classList.toggle('is-on', S.follow);
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
