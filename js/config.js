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
  // 서버 시각 동기 모사(가상 값). 운영에서는 상태 수집 에이전트 설정(offset_max_ms, error_max_ms, max_age_s)으로 판단함.
  // CLOCK_SLOT_SEC마다 CLOCK_EVENT_PROB 확률로 '주의'(오차 초과) 또는 '보고 없음'(상태 파일 갱신 멈춤)이 60~150초 발생함
  CLOCK_OFFSET_MAX_MS: 10,
  CLOCK_ERROR_MAX_MS: 20,
  CLOCK_MAX_AGE_S: 30,
  CLOCK_REPORT_SEC: 16,
  CLOCK_SLOT_SEC: 600,
  CLOCK_EVENT_PROB: 0.12,
  // 정기 백업 모사(가상 값). 매일 BACKUP_HOUR_UTC시(UTC)에 실행, 하루 BACKUP_FAIL_PROB 확률로 실패.
  // 마지막 실행 실패·성공 없음·마지막 성공이 BACKUP_MAX_AGE_H시간보다 오래되면 주의(운영에서는 에이전트 설정 max_age_h로 판단)
  BACKUP_HOUR_UTC: 17,
  BACKUP_FAIL_PROB: 0.1,
  BACKUP_MAX_AGE_H: 26,
  // 텔레메트리 링크 구성(가상 예시): 기체마다 이중(LoRa+MANET) 또는 단일(LoRa만 / MANET만)로 운용
  // 링크 이름은 조회 API·운항계획의 링크 이름(LORA, MANET)을 따름(interfaces/api_format.md, flight_plan_format.md)
  TLM_LINKS: { R01: ['LORA', 'MANET'], V01: ['LORA', 'MANET'], V02: ['MANET'], V03: ['LORA'], V04: ['LORA', 'MANET'], V05: ['MANET'], V06: ['LORA'], R02: ['LORA', 'MANET'] },
  TLM_LINK_LABEL: { LORA: 'LoRa', MANET: 'MANET' },
  // 운항 배정에 링크 구성이 지정되지 않은 기체(telemetry_links = []). 텔레메트리는 위 링크로 받으나 이중화 판정은 하지 않음
  TLM_CONFIG_UNSET: ['V06'],
  // 버티포트 이착륙 분리: 같은 버티포트에서 착륙·이륙은 한 번에 한 대만 하며, 앞뒤 움직임 사이에 이 간격(초)을 둠
  PAD_SEPARATION_SEC: 30,
  // 기체 간 분리 기준(가상 예시 값, 2026-10-08 사용자 선택): 수직 범위(±ft) 안에 있는 다른 기체와의 최소 수평 거리(m).
  // 판정 항목 '기체 간 간격'(horizontal_separation, REQ-ENG-014)에 씀. 기준 미만은 경고, 기준의 SEP_CAUTION_FACTOR배 미만은 주의(데모 모사)
  SEP_H_M: 500,
  SEP_V_FT: 300,
  SEP_CAUTION_FACTOR: 1.5,
  // 노선망 운항 주기(초)와 중심 버티포트 지상 대기(초). 남는 시간은 섬 지상 대기로 씀.
  NETWORK_CYCLE_SEC: 1800,
  HUB_TURNAROUND_SEC: 90,
  ISLAND_MIN_TURNAROUND_SEC: 120,
  // 공중대기: 대기 경로(경주로형) 반경·직선 길이(m), 대기 속도(kt), 회차별 공중대기 발생 확률(1바퀴/2바퀴 누적)
  HOLD_TURN_RADIUS_M: 450,
  HOLD_LEG_M: 1200,
  HOLD_SPEED_KT: 70,
  HOLD_PROB_1: 0.18,
  HOLD_PROB_2: 0.10,
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
  // 지도 경보 띠: 확인하지 않아도 발생 후 이 시간(초)이 지나면 띠에서 내림. 미확인 상태는 경보·이벤트 목록과 탭 숫자에 그대로 남음
  ALERT_STRIP_HIDE_SEC: 300,
  OPERATOR: '관제 요원(데모)',
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
        { id: 'SGD', name: '선갑도', ll: [37.09547, 126.07555] }, // 2026-10-08 추가(실증기 2대 운용 시 노선 분산)
      ],
      destinations: ['DIJ', 'SIJ', 'SBD', 'DJD', 'YHD', 'SGD'],
      // 자월도 시험장 시계비행(VFR) 국지절차(가상 예시). 위치는 중심 버티포트 기준 방위(도)·거리(m).
      // 보고점은 A(북서, 왼쪽 위)·B(남서, 왼쪽 아래)·C(북동, 오른쪽 위)·D(남동, 오른쪽 아래). 각 섬은 방향이 가까운 보고점으로 출입항하며,
      // 출항은 보고점을 1,200ft, 입항은 800ft로 지나 고도로 분리함. 공중대기점은 서·동 두 곳.
      vfr: {
        points: {
          A: { bearing: 300, dist: 2000 },
          B: { bearing: 240, dist: 2000 },
          C: { bearing: 60, dist: 2000 },
          D: { bearing: 120, dist: 2000 },
        },
        // rotate: 대기 경로 방향 회전(도, 시계 방향 +). 기본 방향은 안쪽 직선이 버티포트를 향함.
        holds: {
          'HOLD-W': { bearing: 270, dist: 3000, turn: 'R', rotate: -90 },
          'HOLD-E': { bearing: 90, dist: 3000, turn: 'R', rotate: 90 },
        },
        gateDist: 1000, // 이륙 후 상승 지점·최종 접근점: 버티포트에서 1km
        // 출항·입항 항로 분리(우측 통행): 보고점 양옆으로 laneOffset(m)씩 띄운 출항 항로(바깥 방향 오른쪽)와 입항 항로(바깥 방향 왼쪽)를 씀.
        // 상승 지점은 보고점 방위 +gateAngle(도), 최종 접근점은 -gateAngle로 벌려 버티포트 근처에서도 겹치지 않게 함
        laneOffset: 500,
        gateAngle: 15,
        outboundAlt: 2200,      // 섬 방향 순항 고도(ft): 공중대기 최고층(1,800ft)보다 높게 둠(수직 분리)
        islandLaneOffset: 600, // 섬 출발 경로 중간점을 같은 노선의 섬 방향 경로에서 먼 쪽으로 띄우는 거리(m)
        depAlt: 1200,   // 출항 보고점 통과 고도(ft)
        arrAlt: 800,    // 입항 보고점 통과 고도(ft)
        departures: { 'DEP-JAW-A': 'A', 'DEP-JAW-B': 'B', 'DEP-JAW-C': 'C', 'DEP-JAW-D': 'D' },
        arrivals: {
          'ARR-JAW-A': { vrp: 'A', hold: 'HOLD-W' },
          'ARR-JAW-B': { vrp: 'B', hold: 'HOLD-W' },
          'ARR-JAW-C': { vrp: 'C', hold: 'HOLD-E' },
          'ARR-JAW-D': { vrp: 'D', hold: 'HOLD-E' },
        },
        // 노선별 출항 절차·입항 절차·공중대기 고도(ft). 같은 대기점은 고도로 층을 나눔.
        routes: {
          DJD: { dep: 'DEP-JAW-A', arr: 'ARR-JAW-A', holdAlt: 900 },
          SIJ: { dep: 'DEP-JAW-B', arr: 'ARR-JAW-B', holdAlt: 1200 },
          DIJ: { dep: 'DEP-JAW-B', arr: 'ARR-JAW-B', holdAlt: 1500 },
          SBD: { dep: 'DEP-JAW-D', arr: 'ARR-JAW-D', holdAlt: 900 },
          YHD: { dep: 'DEP-JAW-C', arr: 'ARR-JAW-C', holdAlt: 1200 },
          SGD: { dep: 'DEP-JAW-B', arr: 'ARR-JAW-B', holdAlt: 1800 },
        },
      },
    },
  },
  jejucity:  { label: '제주시청', ll: [33.4996, 126.5312] },
};
TMS.DEFAULT_LOCATION = 'seongsan';

// 기준 위치 결정: 주소 ?loc=위도,경도 → 이 브라우저에 저장된 위치 → 기본 위치
TMS.LOCATION = (function () {
  const valid = (lat, lon) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
  const q = new URLSearchParams(location.search).get('loc');
  // ?loc=목록 키(예: jawoldo)이면 해당 기준 위치, ?loc=위도,경도이면 직접 지정
  if (q && TMS.LOCATION_PRESETS[q]) {
    const p = TMS.LOCATION_PRESETS[q];
    return { key: q, ll: p.ll.slice(), shift: p.shift, network: p.network };
  }
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
  ontology:      { label: '온톨로지', tab: true },
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
  // 경과 시간(초)을 '1일 5시간', '5시간 12분', '12분'으로 표시. null이면 '—'
  dur(s) {
    if (s == null) return '—';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
  },
  ll(lat, lon) { return `${lat.toFixed(5)}°N ${lon.toFixed(5)}°E`; },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
};
