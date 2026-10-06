// AAM TMS 내부 관제 화면 시안 - 공통 설정
// 시안 전용 값임. 운영 값은 정책·설정 데이터에서 받으며 화면 코드에 고정하지 않음.
window.TMS = window.TMS || {};

TMS.config = {
  // 정보 없음 전환 기준: 마지막 유효 수신 후 경과 시간(ms).
  // 기획서 7장 초기값(연속 5회 미수신 = 1초). 실증 데이터로 보정 예정.
  STALE_MS: 1000,
  // 화면 갱신 주기(ms). 위치 갱신 주기 0.2초에 맞춤.
  TICK_MS: 200,
  // 항적 표시 길이(초)
  TRAIL_SEC: 60,
  // 재생 가능 범위(초). 시안에서는 최근 30분.
  REPLAY_WINDOW_SEC: 1800,
  // 시연 상황 무작위 발생: 기체마다 SLOT초 단위로 PROB 확률로 이상 상황 1건(확인 필요 경보 시간당 15건 안팎)
  SCENARIO_SLOT_SEC: 60,
  SCENARIO_EVENT_PROB: 0.07,
  // 지도 기준 위치(아래 TMS.LOCATION에서 정함). 가상 절차·버티포트는 이 점을 기준으로 한 상대 좌표(임의값)임.
  MAP_CENTER: null,
  MAP_ZOOM: 13,
  // 창 간 연동 채널 이름
  CHANNEL: 'aamtms-console-v0',
  // 연동 창 생존 확인 주기·만료(ms)
  PEER_HB_MS: 1000,
  PEER_EXPIRE_MS: 3500,
  // 확인이 필요한 상태 전환
  ACK_REQUIRED: ['warning', 'emergency', 'nodata'],
  OPERATOR: '관제 요원(시안)',
};

// 기준 위치 목록. 기본은 성산일출봉(사용자 지정, 2026-10-06).
TMS.LOCATION_PRESETS = {
  // shift: 가상 경로 묶음을 기준점에서 옮겨 놓을 거리(동·북, m). 해안 기준점에서 경로가 바다로 나가지 않게 함.
  seongsan:  { label: '성산일출봉', ll: [33.4581, 126.9425], shift: [-4000, 0] },
  jeongseok: { label: '정석비행장', ll: [33.3964, 126.7119] },
  // 자월도 비행시험장(인천 옹진군). 좌표는 사용자 지정(2026-10-06).
  // network: 시험장과 주변 섬을 잇는 가상 노선망. 섬 버티포트 위치는 OpenStreetMap 섬 중심 좌표를 쓴 가상 위치임.
  jawoldo:   {
    label: '자월도 비행시험장', ll: [37.26146, 126.29088],
    network: {
      hub: 'JAW',
      vertiports: [
        { id: 'JAW', name: '자월도', ll: [37.26146, 126.29088] },
        { id: 'DIJ', name: '대이작도', ll: [37.16978, 126.26513] },
        { id: 'SIJ', name: '소이작도', ll: [37.18273, 126.23516] },
        { id: 'SBD', name: '승봉도', ll: [37.16684, 126.30597] },
        { id: 'DJD', name: '덕적도', ll: [37.24188, 126.11559] },
        { id: 'YHD', name: '영흥도', ll: [37.25607, 126.45903] },
      ],
      destinations: ['DIJ', 'SIJ', 'SBD', 'DJD', 'YHD'],
    },
  },
  jejucity:  { label: '제주시청', ll: [33.4996, 126.5312] },
};
TMS.DEFAULT_LOCATION = 'seongsan';

// 기준 위치 결정: 주소 ?loc=위도,경도 → 이 브라우저에 저장된 위치 → 기본 위치
TMS.LOCATION = (function () {
  const valid = (lat, lon) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
  const q = new URLSearchParams(location.search).get('loc');
  if (q) {
    const [lat, lon] = q.split(',').map(Number);
    if (valid(lat, lon)) return { key: 'custom', ll: [lat, lon] };
  }
  try {
    const saved = JSON.parse(localStorage.getItem('aamtms.loc') || 'null');
    if (saved && valid(saved.ll[0], saved.ll[1])) {
      const p = TMS.LOCATION_PRESETS[saved.key];
      return p ? { key: saved.key, ll: p.ll.slice(), shift: p.shift, network: p.network } : { key: 'custom', ll: saved.ll };
    }
  } catch (e) { /* 저장소 사용 불가 시 기본 위치 */ }
  const p = TMS.LOCATION_PRESETS[TMS.DEFAULT_LOCATION];
  return { key: TMS.DEFAULT_LOCATION, ll: p.ll.slice(), shift: p.shift, network: p.network };
})();
TMS.config.MAP_CENTER = TMS.LOCATION.ll;

// 정보 없음 판단: 마지막 유효 수신 후 경과 시간이 기준을 넘으면 참
TMS.isStale = ageMs => ageMs > TMS.config.STALE_MS;

// 표시 상태 정의. 판정 자체는 판정 엔진이 수행하며 화면은 표시만 함.
// rank: 목록 정렬 우선순위(작을수록 위)
TMS.STATUS = {
  emergency: { label: '비상', glyph: '■', rank: 0 },
  warning:   { label: '경고', glyph: '◆', rank: 1 },
  nodata:    { label: '정보 없음', glyph: '◌', rank: 2 },
  caution:   { label: '주의', glyph: '▲', rank: 3 },
  normal:    { label: '정상', glyph: '●', rank: 4 },
  na:        { label: '미적용', glyph: '–', rank: 9 },
};

// 화면 역할(상단 탭). 멀티모니터 모드에서는 창마다 역할 하나를 맡음.
TMS.VIEWS = {
  main:          { label: '기본', tab: true },
  map:           { label: '상황 지도', tab: true },
  detail:        { label: '기체·판정', tab: true },
  events:        { label: '경보·시스템', tab: true },
  flightplan:    { label: '운항일정', tab: true },
  detail_events: { label: '기체·판정·경보', tab: false },
};

TMS.LAYOUT_PRESETS = {
  2: ['map', 'detail_events'],
  3: ['map', 'detail', 'events'],
  4: ['map', 'detail', 'events', 'flightplan'],
};

// 공통 형식 함수
TMS.fmt = {
  pad(n, w = 2) { return String(n).padStart(w, '0'); },
  time(ms, utc = false) {
    const d = new Date(ms);
    if (utc) return `${this.pad(d.getUTCHours())}:${this.pad(d.getUTCMinutes())}:${this.pad(d.getUTCSeconds())}`;
    return `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
  },
  timeMs(ms) {
    const d = new Date(ms);
    return `${this.time(ms)}.${Math.floor(d.getMilliseconds() / 100)}`;
  },
  age(ms) {
    if (ms < 0) ms = 0;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}초 전`;
    return `${Math.floor(ms / 60000)}분 ${Math.floor((ms % 60000) / 1000)}초 전`;
  },
  ll(lat, lon) { return `${lat.toFixed(5)}°N ${lon.toFixed(5)}°E`; },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
};
