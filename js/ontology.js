// AAM TMS 관제 화면 시안 - 온톨로지(데이터 계보) 화면
// 수신 원천에서 변환 규칙·공통 파라미터·영역 관측·판정 입력을 거쳐 비행·기체로 이어지는 관계를 그래프로 표시함.
// 정의·입력 단자·변환식은 모두 가상 예시임(입력 단자는 문서용 주소 대역 192.0.2.x).
// 화면은 판정하지 않으며 수신 값과 변환 결과만 표시함. 마지막 유효 수신 후 기준 시간이 지나면 값을 숨기고 정보 없음으로 표시함.
(function () {
  const S = TMS.state, M = TMS.mock, F = TMS.fmt;
  const $ = sel => document.querySelector(sel);
  const esc = s => F.esc(s);
  const kstMs = ms => `${F.time(ms + 9 * 3600 * 1000, true)}.${Math.floor(new Date(ms).getMilliseconds() / 100)}`;
  const byAc = Object.fromEntries(M.AIRCRAFT.map(a => [a.id, a]));

  // ---------- 정의(가상 예시) ----------
  // col: 그래프 열(왼쪽 원천 → 오른쪽 기체·시설)
  const TYPES = {
    source: { label: '데이터 원천', col: 0, ico: '<rect x="2.5" y="3" width="11" height="10"/><path d="M2.5 6.5h11M2.5 10h11"/>' },
    rule:   { label: '변환 규칙', col: 1, ico: '<path d="M11 2.5c-2.2 0-2.7 1.1-3 3.2L6.8 13.5M4.8 7h5.4"/>' },
    param:  { label: '공통 파라미터', col: 2, ico: '<path d="M8 2.8L13.2 8 8 13.2 2.8 8z"/>' },
    obs:    { label: '영역 관측', col: 3, ico: '<circle cx="8" cy="8" r="5"/>' },
    input:  { label: '판정 입력', col: 4, ico: '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.4"/>' },
    event:  { label: '관측·판정', col: 5, ico: '<path d="M4 13.5v-11M4 3h7.5L10 5.5 11.5 8H4"/>' },
    flight: { label: '비행·경보', col: 6, ico: '<path d="M2.5 11.5l3.5-4 3 2.5 4.5-6"/>' },
    entity: { label: '기체·시설', col: 7, ico: '<path d="M8 2l5.2 3v6L8 14l-5.2-3V5z"/>' },
  };
  const DOMAINS = { surv: '감시', comm: '통신', ops: '운항', verdict: '판정' };
  const PROFILE = 'canonical.v0(가상)';

  // 수신 원천. path: 조회 API 상태 JSON의 경로 이름(paths 키). 가상기체 주입은 무선 구간을 거치지 않음
  const SOURCES = [
    { id: 'ADSB', short: 'ADS-B', name: 'ADS-B 수신기', path: 'ADSB', ep: '192.0.2.11:30003', fmt: 'SBS-1 문자열(가상)', domain: 'surv', mark: 'adsb', desc: '주변 기체의 ADS-B 위치 보고를 받는 지상 수신기.' },
    { id: 'LORA', short: 'LoRa', name: '텔레메트리 · LoRa', path: 'TELEMETRY/LORA', ep: '192.0.2.21:49000', fmt: '이진 프레임(가상)', domain: 'surv', mark: 'tlm', desc: 'LoRa 링크로 받는 기체 텔레메트리.' },
    { id: 'MANET', short: 'MANET', name: '텔레메트리 · MANET', path: 'TELEMETRY/MANET', ep: '192.0.2.31:49001', fmt: 'UDP 데이터 참조(가상)', domain: 'surv', mark: 'tlm', desc: 'MANET 지상 노드로 받는 기체 텔레메트리.' },
    { id: 'SIM', short: '가상 주입', name: '가상기체 주입', path: null, ep: '내부 주입(무선 구간 없음)', fmt: '텔레메트리와 같은 형식', domain: 'surv', mark: 'virtual', desc: '가상기체 값을 입력단에 같은 형식으로 주입함. 실기체에는 적용하지 않음.' },
    { id: 'FPL', short: '운항 배정', name: '운항 배정', path: null, ep: null, fmt: '운항 배정 파일(가상)', domain: 'ops', desc: '운항 배정, 노선, 기체별 텔레메트리 링크 구성.' },
    { id: 'POLICY', short: '정책', name: '절차·정책 데이터', path: null, ep: 'POL-가상-0.3', fmt: '정책 데이터(가상)', domain: 'ops', desc: '절차 형상과 판정 한계값. 판정 엔진이 사용함.' },
    { id: 'ENGINE', short: '판정 엔진', name: '판정 엔진(조회 API)', path: null, ep: '조회 API(모사)', fmt: '상태 JSON', domain: 'verdict', desc: '판정 결과를 내는 외부 기능. 화면은 결과를 표시만 함.' },
  ];
  const SENSORS = ['ADSB', 'LORA', 'MANET', 'SIM'];
  const srcById = Object.fromEntries(SOURCES.map(s => [s.id, s]));

  // 공통 파라미터. v: 조회 API 기록에서 물리량을 꺼내는 이름
  const PARAMS = [
    { id: 'latitude_deg', key: 'lat', name: '위도(WGS84)', unit: 'deg', dtype: 'float64', v: 'lat' },
    { id: 'longitude_deg', key: 'lon', name: '경도(WGS84)', unit: 'deg', dtype: 'float64', v: 'lon' },
    { id: 'altitude_msl_ft', key: 'alt', name: '고도(MSL)', unit: 'ft', dtype: 'float32', v: 'alt_ft' },
    { id: 'ground_speed_kt', key: 'gs', name: '대지속도', unit: 'kt', dtype: 'float32', v: 'gs_kt' },
    { id: 'vertical_rate_fpm', key: 'vs', name: '수직속도', unit: 'fpm', dtype: 'float32', v: 'vs_fpm' },
    { id: 'heading_deg', key: 'hdg', name: '방위', unit: 'deg', dtype: 'float32', v: 'hdg' },
    { id: 'received_utc_ms', key: 't', name: '수신 시각', unit: 'UTC ms', dtype: 'int64', v: 't_last', domain: 'comm' },
    { id: 'signature_state', key: 'sig', name: '서명 검증 결과', unit: '—', dtype: 'enum', domain: 'comm' },
  ];
  const parByKey = Object.fromEntries(PARAMS.map(p => [p.key, p]));
  const RULE_NAME = { lat: '위도', lon: '경도', alt: '고도', gs: '대지속도', vs: '수직속도', hdg: '방위', t: '수신 시각' };

  // 원천별 필드와 변환식(가상 예시). [원천 필드, 원천 단위, 변환식, k, b] → 공통 값 = 원천 값 × k + b
  const R2D = 180 / Math.PI;
  const FORMATS = {
    ADSB: {
      lat: ['lat', 'deg', 'value', 1], lon: ['lon', 'deg', 'value', 1], alt: ['alt_baro', 'ft', 'value', 1],
      gs: ['gs', 'kt', 'value', 1], vs: ['baro_rate', 'fpm', 'value', 1], hdg: ['track', 'deg', 'value', 1], t: ['t_msg', 'UTC ms', 'value', 1],
    },
    LORA: {
      lat: ['pos.lat_e7', '1e-7 deg', 'value / 1e7', 1e-7], lon: ['pos.lon_e7', '1e-7 deg', 'value / 1e7', 1e-7],
      alt: ['pos.alt_m', 'm', 'value * 3.28084', 3.28084], gs: ['vel.gs_ms', 'm/s', 'value * 1.94384', 1.94384],
      vs: ['vel.vz_ms', 'm/s (아래 +)', '-value * 196.85', -196.85], hdg: ['att.yaw_cdeg', 'cdeg', 'value / 100', 0.01],
      t: ['hdr.gps_ms', 'GPS ms', 'value - 18000', 1, -18000],
    },
    MANET: {
      lat: ['sim/position/latitude', 'rad', 'value * 180 / Math.PI', R2D], lon: ['sim/position/longitude', 'rad', 'value * 180 / Math.PI', R2D],
      alt: ['sim/position/elevation', 'm', 'value * 3.28084', 3.28084], gs: ['sim/velocity/groundspeed', 'm/s', 'value * 1.94384', 1.94384],
      vs: ['sim/velocity/vz', 'm/s', 'value * 196.85', 196.85], hdg: ['sim/attitude/psi', 'rad', 'value * 180 / Math.PI', R2D],
      t: ['hdr.stamp', null, 'value', 1],
    },
    SIM: {
      lat: ['lat', 'deg', 'value', 1], lon: ['lon', 'deg', 'value', 1], alt: ['alt_ft', 'ft', 'value', 1],
      gs: ['gs_kt', 'kt', 'value', 1], vs: ['vs_fpm', 'fpm', 'value', 1], hdg: ['hdg', 'deg', 'value', 1], t: ['t', 'UTC ms', 'value', 1],
    },
  };

  // 관측 이후 노드: [식별자, 유형, 이름, 정의 이름, 도메인, 설명, [[상위 노드, 관계, 기수], ...]]
  const DERIVED = [
    ['obs.position', 'obs', '위치 관측', 'position_observation', 'surv', '위도·경도·고도를 같은 수신 시각 기준으로 묶은 관측.',
      [['par.latitude_deg', 'belongsTo', 'N:1'], ['par.longitude_deg', 'belongsTo', 'N:1'], ['par.altitude_msl_ft', 'belongsTo', 'N:1'], ['par.received_utc_ms', 'timestamps', 'N:1']]],
    ['obs.motion', 'obs', '속도·방위 관측', 'motion_observation', 'surv', '대지속도·수직속도·방위를 묶은 관측.',
      [['par.ground_speed_kt', 'belongsTo', 'N:1'], ['par.vertical_rate_fpm', 'belongsTo', 'N:1'], ['par.heading_deg', 'belongsTo', 'N:1']]],
    ['obs.link', 'obs', '수신 경로 관측', 'link_observation', 'comm', '경로별 마지막 수신 시각과 연속 미수신 횟수.',
      [['par.received_utc_ms', 'belongsTo', 'N:1']]],
    ['obs.signature', 'obs', '서명 검증 관측', 'signature_observation', 'comm', '서명 검증에 실패한 메시지는 표시하지 않고 폐기하며 횟수만 남김.',
      [['par.signature_state', 'belongsTo', 'N:1']]],
    ['in.deviation', 'input', '경로 이탈', 'route_deviation', 'verdict', '절차 경로와의 거리. 판정은 판정 엔진이 수행함.',
      [['obs.position', 'inputOf', 'N:N'], ['src.POLICY', 'limits', '1:N']]],
    ['in.speed', 'input', '구간 속도 초과', 'speed_limit', 'verdict', '구간별 속도 한계와의 비교. 판정은 판정 엔진이 수행함.',
      [['obs.motion', 'inputOf', 'N:N'], ['src.POLICY', 'limits', '1:N']]],
    ['in.descent', 'input', '강하율', 'descent_rate', 'verdict', '접근 구간 강하율 한계와의 비교. 판정은 판정 엔진이 수행함.',
      [['obs.motion', 'inputOf', 'N:N'], ['src.POLICY', 'limits', '1:N']]],
    ['in.mismatch', 'input', 'ADS-B 위치 불일치', 'path_mismatch', 'verdict', 'ADS-B와 텔레메트리 위치 차이. 판정은 판정 엔진이 수행함.',
      [['obs.position', 'inputOf', 'N:N']]],
    ['in.loss', 'input', '수신 두절', 'signal_loss', 'verdict', '연속 미수신 횟수 기준의 정보 없음 판단.',
      [['obs.link', 'inputOf', 'N:N']]],
    ['in.redundancy', 'input', '링크 이중화', 'link_redundancy', 'verdict', '운항 배정 링크 구성 대비 수신 링크. 구성 미지정이면 판단하지 않음.',
      [['obs.link', 'inputOf', 'N:N'], ['src.FPL', 'configures', '1:N']]],
    ['ev.observation', 'event', '기체 관측', 'flight_observation', 'surv', '관측을 시각과 원천 기준으로 비행에 연결함.',
      [['obs.position', 'belongsTo', 'N:1'], ['obs.motion', 'belongsTo', 'N:1'], ['obs.link', 'belongsTo', 'N:1'], ['obs.signature', 'belongsTo', 'N:1']]],
    ['ev.verdict', 'event', '판정 결과 기록', 'verdict_result', 'verdict', '판정 엔진의 상태·사유·항목. 화면은 표시만 함.',
      [['src.ENGINE', 'produces', '1:N'], ['in.deviation', 'evaluatedBy', 'N:1'], ['in.speed', 'evaluatedBy', 'N:1'], ['in.descent', 'evaluatedBy', 'N:1'],
        ['in.mismatch', 'evaluatedBy', 'N:1'], ['in.loss', 'evaluatedBy', 'N:1'], ['in.redundancy', 'evaluatedBy', 'N:1']]],
    ['fl.flight', 'flight', '비행', 'flight', 'ops', '운항 배정 하나에 해당하는 비행.',
      [['ev.observation', 'belongsTo', 'N:1'], ['ev.verdict', 'belongsTo', 'N:1'], ['src.FPL', 'plans', '1:N']]],
    ['fl.alert', 'flight', '경보 이벤트', 'alert_event', 'verdict', '확인이 필요한 상태 전환(경고·비상·정보 없음).',
      [['ev.verdict', 'raises', '1:N']]],
    ['fl.oplog', 'flight', '병행 운용 판단', 'parallel_ops_record', 'verdict', '관제 요원 판단을 시스템 판정과 나란히 기록함.',
      [['ev.verdict', 'comparedWith', '1:N']]],
    ['fl.schedule', 'flight', '운항일정', 'flight_schedule', 'ops', '버티포트별 출항·입항 예정.',
      [['src.FPL', 'defines', '1:N']]],
    ['fl.procedure', 'flight', '절차', 'procedure', 'ops', '출항·입항·공중대기 절차와 구간.',
      [['src.POLICY', 'defines', '1:N']]],
    ['en.aircraft', 'entity', '기체', 'aircraft', 'ops', '실기체와 가상기체.',
      [['fl.flight', 'operatedBy', 'N:1']]],
    ['en.vertiport', 'entity', '버티포트', 'vertiport', 'ops', '이착륙장. 한 번에 한 대만 이착륙함.',
      [['fl.schedule', 'uses', 'N:1'], ['fl.procedure', 'serves', 'N:1']]],
    ['en.operator', 'entity', '관제 요원', 'operator', 'ops', '경보 확인과 병행 운용 기록의 주체.',
      [['fl.alert', 'acknowledgedBy', 'N:1'], ['fl.oplog', 'recordedBy', 'N:1']]],
  ];

  // ---------- 노드·관계 구성 ----------
  const NODES = [], EDGES = [];
  const byId = {};
  const addNode = n => { NODES.push(n); byId[n.id] = n; };
  const addEdge = (from, to, rel, card) => EDGES.push({ from, to, rel, card });
  SOURCES.forEach(s => addNode({
    id: `src.${s.id}`, type: 'source', name: s.name, key: s.id.toLowerCase(), sub: s.ep || '입력 단자 미지정', domain: s.domain,
    src: s.id, mark: s.mark, desc: s.desc, dtype: 'stream', unit: '—',
  }));
  PARAMS.forEach(p => addNode({
    id: `par.${p.id}`, type: 'param', name: p.name, key: p.id, sub: `${p.id} · ${p.unit}`, domain: p.domain || 'surv',
    pkey: p.key, unit: p.unit, dtype: p.dtype, desc: '원천과 관계없이 같은 이름·단위로 쓰는 값.',
  }));
  PARAMS.forEach(p => SENSORS.forEach(src => {
    const f = FORMATS[src][p.key];
    if (!f) return;
    const id = `rule.${src}.${p.key}`;
    addNode({
      id, type: 'rule', name: `${srcById[src].short} · ${RULE_NAME[p.key]}`, key: `${src.toLowerCase()}_${p.key}`, sub: f[0], domain: p.domain || 'surv',
      src, pkey: p.key, field: f[0], srcUnit: f[1], formula: f[2], k: f[3], b: f[4] || 0, unit: p.unit, dtype: p.dtype,
      desc: `원천 필드를 공통 파라미터로 변환함: ${f[0]} → ${p.id}`,
    });
    addEdge(`src.${src}`, id, 'feeds', '1:N');
    addEdge(id, `par.${p.id}`, 'mapsTo', 'N:1');
  }));
  SENSORS.forEach(src => addEdge(`src.${src}`, 'par.signature_state', 'verifiedBy', 'N:1'));
  DERIVED.forEach(([id, type, name, key, domain, desc, parents]) => {
    addNode({ id, type, name, key, sub: key, domain, desc, dtype: 'object', unit: '—' });
    parents.forEach(([from, rel, card]) => addEdge(from, id, rel, card));
  });
  const OUT = {}, IN = {};
  EDGES.forEach(e => { (OUT[e.from] = OUT[e.from] || []).push(e); (IN[e.to] = IN[e.to] || []).push(e); });

  // 정의 검증(가상 예시): 단위·단자가 정의되지 않은 항목
  const FINDINGS = [];
  NODES.forEach(n => {
    if (n.type === 'rule' && !n.srcUnit) FINDINGS.push({ lv: 'caution', id: n.id, msg: '원천 시각 기준(UTC·GPS)이 정의되지 않음. 수신 시각 비교에서 제외됨.' });
    if (n.type === 'source' && n.sub === '입력 단자 미지정') FINDINGS.push({ lv: 'na', id: n.id, msg: '입력 단자가 정의되지 않음. 파일을 수동으로 적재함.' });
  });
  const warnCount = FINDINGS.filter(f => f.lv !== 'na').length;

  function reach(id, adj, key) {
    const seen = new Set([id]);
    const st = [id];
    while (st.length) (adj[st.pop()] || []).forEach(e => { if (!seen.has(e[key])) { seen.add(e[key]); st.push(e[key]); } });
    return seen;
  }
  function lineage(id) {
    const up = reach(id, IN, 'from'), down = reach(id, OUT, 'to');
    return { up, down, all: new Set([...up, ...down]) };
  }
  const edgeLit = (e, lin) => (lin.up.has(e.from) && lin.up.has(e.to)) || (lin.down.has(e.from) && lin.down.has(e.to));

  // ---------- 화면 상태(창별, 동기화하지 않음) ----------
  const O = {
    built: false, sel: null, lineage: 'full', domain: 'all', source: 'all', q: '', focusType: null,
    tool: 'select', view: 'graph', dtab: 'preview', drawer: true, ac: null,
    pos: {}, auto: {}, k: 1, tx: 0, ty: 0, closed: {}, secClosed: {}, dirty: false,
  };
  // 노드 상자 크기: 영어 표시에서 가장 긴 이름(가상 주입 · 수직속도)과 3줄(이름·식별자·상태)이 잘리지 않는 크기
  const NW = 236, NH = 60, COLW = 292, PADX = 24, TOP = 48;
  // 변환 규칙 묶음: 공통 파라미터별로 묶어 한 줄에 RULE_COLS개씩 옆으로 놓음(ADS-B·LoRa / MANET·가상 주입)
  const RULE_COLS = 2, RGAPX = 14, RGAPY = 8, RHEAD = 24, RPAD = 10, RGROUP_GAP = 18;
  const RULE_W = RPAD * 2 + RULE_COLS * NW + (RULE_COLS - 1) * RGAPX;
  // 열의 왼쪽 위치. 변환 규칙 열이 넓어진 만큼 오른쪽 열을 밂
  const colX = col => PADX + col * COLW + (col >= 2 ? RULE_W - NW : 0);
  const posOf = id => O.pos[id] || O.auto[id];

  // 보이는 노드만으로 배치함(필터·선택 계보에서도 빈자리 없이 모음). 사용자가 옮긴 위치(O.pos)가 우선함
  function autoLayout(vis) {
    const P = {};
    const x = colX;
    const on = id => vis.has(id);
    // 변환 규칙: 공통 파라미터별 묶음 상자 안에 원천 순으로 옆으로 놓고, 묶음을 위에서 아래로 쌓음
    let y = TOP;
    const groups = [];
    PARAMS.forEach(p => {
      const rules = SENSORS.map(src => `rule.${src}.${p.key}`).filter(id => byId[id] && on(id));
      if (!rules.length) return;
      const cols = Math.min(RULE_COLS, rules.length);
      const rows = Math.ceil(rules.length / cols);
      rules.forEach((id, i) => { P[id] = [x(1) + RPAD + (i % cols) * (NW + RGAPX), y + RHEAD + Math.floor(i / cols) * (NH + RGAPY)]; });
      const h = RHEAD + rows * (NH + RGAPY) - RGAPY + RPAD;
      groups.push({ param: p, n: rules.length, x: x(1), y, w: RPAD * 2 + cols * NW + (cols - 1) * RGAPX, h });
      y += h + RGROUP_GAP;
    });
    O.groups = groups;
    // 원천: 수신 원천을 위에, 정의 데이터 원천을 아래에 둠
    const srcs = SOURCES.map(s => `src.${s.id}`).filter(on);
    srcs.forEach((id, i) => { P[id] = [x(0), TOP + i * (NH + 64) + (SENSORS.includes(byId[id].src) ? 0 : 60)]; });
    // 나머지 열: 상위 노드 중심의 평균 높이에 두고 겹치면 아래로 밂
    for (let col = 2; col <= 7; col++) {
      const ids = NODES.filter(n => TYPES[n.type].col === col && on(n.id)).map(n => n.id);
      ids.forEach((id, i) => {
        const ps = (IN[id] || []).map(e => P[e.from]).filter(Boolean);
        const prev = i ? P[ids[i - 1]] : null;
        P[id] = [x(col), ps.length ? ps.reduce((s, p) => s + p[1], 0) / ps.length : (prev ? prev[1] + NH + 20 : TOP)];
      });
      ids.sort((a, b) => P[a][1] - P[b][1]);
      ids.forEach((id, i) => { if (i && P[id][1] < P[ids[i - 1]][1] + NH + 18) P[id][1] = P[ids[i - 1]][1] + NH + 18; });
    }
    // 숨은 노드는 이전 위치를 유지함(다시 보일 때 다시 배치됨)
    NODES.forEach(n => { if (!P[n.id]) P[n.id] = O.auto[n.id] || [x(TYPES[n.type].col), TOP]; });
    O.auto = P;
    O.layoutKey = [...vis].sort().join(',');
  }
  function sizeWorld() {
    let maxX = 0, maxY = 0;
    NODES.forEach(n => { if (!O.vis.has(n.id)) return; const p = posOf(n.id); maxX = Math.max(maxX, p[0] + NW); maxY = Math.max(maxY, p[1] + NH); });
    O.size = [Math.max(maxX, colX(7) + NW) + PADX, maxY + 40];
    const world = $('#og-world'), svg = $('#og-edges');
    world.style.width = `${O.size[0]}px`;
    world.style.height = `${O.size[1]}px`;
    svg.setAttribute('width', O.size[0]);
    svg.setAttribute('height', O.size[1]);
  }

  // ---------- 실시간 값 ----------
  const refAc = () => (O.ac && byAc[O.ac] ? O.ac : S.selected && byAc[S.selected] ? S.selected : M.AIRCRAFT[0].id);
  // 원천별 경로 값(공통 단위의 물리량). ADS-B·텔레메트리 경로 기록에는 위치·고도만 있으므로 속도·방위는 융합 값을 씀(시안)
  function sample(src, acId) {
    const r = S.recs[acId];
    const ac = byAc[acId];
    if (src === 'SIM' && !ac.virtual) return { state: 'na' };
    if (!r || !r.fused) return { state: 'none' };
    const fz = { gs_kt: r.fused.gs_kt, vs_fpm: r.fused.vs_fpm, hdg: r.fused.hdg };
    if (src === 'SIM') return { state: 'ok', t_last: r.t, lat: r.fused.lat, lon: r.fused.lon, alt_ft: r.fused.alt_ft, ...fz };
    const p = r.paths[srcById[src].path];
    if (!p) return { state: 'none' };
    return { ...p, ...fz };
  }
  const sampleStale = (s, acId) => S.feedStale() || S.displayStatus(acId) === 'nodata' || TMS.isStale(S.now - s.t_last);

  function srcLive(id) {
    if (S.feedStale()) return { cls: 'nodata', text: '정보 없음' };
    if (SENSORS.includes(id)) {
      let n = 0, m = 0;
      M.AIRCRAFT.forEach(a => {
        const s = sample(id, a.id);
        if (s.state === 'na' || s.state === 'none') return;
        m++;
        if (s.state === 'ok' && !sampleStale(s, a.id)) n++;
      });
      if (!m) return { cls: 'na', text: '수신 대상 없음' };
      return { cls: n === m ? 'normal' : n ? 'caution' : 'nodata', text: `수신 ${n}/${m}` };
    }
    if (id === 'ENGINE') return { cls: 'normal', text: '수신 중' };
    if (id === 'FPL') return { cls: 'na', text: '입력 단자 미지정' };
    return { cls: 'normal', text: '적재됨' };
  }
  const nodeStatus = n => {
    if (n.type === 'source') return srcLive(n.src);
    if (n.type === 'rule' && !n.srcUnit) return { cls: 'caution', text: '시각 기준 미지정' };
    if (n.type === 'input') return { cls: 'na', text: '판정 엔진 수행' };
    return { cls: 'na', text: '정의됨' };
  };

  const DIGITS = { lat: 6, lon: 6, alt: 0, gs: 1, vs: 0, hdg: 1 };
  function fmtRaw(n, raw) {
    if (n.pkey === 't') return String(Math.round(raw));
    if (n.srcUnit === 'rad') return raw.toFixed(8);
    if (n.srcUnit === '1e-7 deg' || n.srcUnit === 'cdeg') return String(Math.round(raw));
    if (n.srcUnit === 'm' || n.srcUnit === 'm/s' || n.srcUnit === 'm/s (아래 +)') return raw.toFixed(2);
    return raw.toFixed(DIGITS[n.pkey]);
  }
  const fmtOut = (key, v) => (key === 't' ? kstMs(v) : v.toFixed(DIGITS[key]));
  // 데이터 미리보기 한 줄: 원천 값(공통 값을 역변환해 만든 모사 값)과 변환 결과
  function previewRow(n, acId) {
    const s = sample(n.src, acId);
    const p = parByKey[n.pkey];
    if (s.state === 'na') return { st: '<span class="st-text--na">미적용</span>', inV: '—', outV: '—', at: '—', age: '—' };
    if (s.state === 'none') return { st: '<span class="st-text--na">수신 이력 없음</span>', inV: '—', outV: '—', at: '—', age: '—' };
    const age = `${Math.max(0, (S.now - s.t_last) / 1000).toFixed(1)}초`;
    if (sampleStale(s, acId)) return { st: '<span class="st-tag st-tag--nodata">정보 없음</span>', inV: '—', outV: '—', at: kstMs(s.t_last), age };
    const phys = s[p.v];
    if (phys == null || !isFinite(phys)) return { st: '<span class="st-text--na">값 없음</span>', inV: '—', outV: '—', at: kstMs(s.t_last), age };
    const raw = (phys - n.b) / n.k;
    const out = raw * n.k + n.b;
    const st = s.state === 'ok' ? '<span class="st-text st-text--normal">수신</span>' : '<span class="st-text st-text--warning">두절</span>';
    return { st, inV: fmtRaw(n, raw), outV: fmtOut(n.pkey, out), at: kstMs(s.t_last), age };
  }

  // ---------- 그래프 ----------
  const nodeEls = {};
  const glyph = (type, cls = 'og-gl') => `<svg class="${cls}" viewBox="0 0 16 16">${TYPES[type].ico}</svg>`;
  function buildGraph() {
    $('#og-cols').innerHTML = Object.values(TYPES).map(t => `<span class="og-colhead" style="left:${colX(t.col)}px">${t.label}</span>`).join('');
    $('#og-nodes').innerHTML = NODES.map(n => `<div class="og-node og-node--${n.type}${n.mark ? ` og-node--${n.mark}` : ''}" data-id="${n.id}" title="${esc(n.name)}">
      <div class="og-node__l1">${glyph(n.type)}<b>${esc(n.name)}</b></div>
      <div class="og-node__l2">${esc(n.sub)}</div>
      <div class="og-node__l3" data-st></div>
      <i class="og-port og-port--in"></i><i class="og-port og-port--out"></i></div>`).join('');
    $('#og-nodes').querySelectorAll('.og-node').forEach(el => { nodeEls[el.dataset.id] = el; });
  }
  // 변환 규칙 묶음 상자(공통 파라미터 이름 · 규칙 수). 누르면 해당 공통 파라미터를 고름
  function drawGroups() {
    $('#og-groups').innerHTML = (O.groups || []).map(g => `<div class="og-group" data-go="par.${g.param.id}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">
      <span class="og-group__head">${glyph('param')}<b>${esc(g.param.name)}</b><em class="mono">${g.param.id}</em><span class="og-group__n mono">${g.n}</span></span></div>`).join('');
  }
  function placeNode(id) {
    const p = posOf(id), el = nodeEls[id];
    el.style.left = `${p[0]}px`;
    el.style.top = `${p[1]}px`;
  }
  function edgePath(e) {
    const a = posOf(e.from), b = posOf(e.to);
    const x1 = a[0] + NW, y1 = a[1] + NH / 2, x2 = b[0], y2 = b[1] + NH / 2;
    const dx = Math.max(36, (x2 - x1) * 0.5);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  function drawEdges() {
    const vis = O.vis, lin = O.lin;
    const parts = [], lit = [];
    EDGES.forEach(e => {
      if (!vis.has(e.from) || !vis.has(e.to)) return;
      const on = lin && edgeLit(e, lin);
      (on ? lit : parts).push(`<path class="${lin ? (on ? 'is-lit' : 'is-dim') : ''}" d="${edgePath(e)}"/>`);
    });
    $('#og-edges').innerHTML = parts.join('') + lit.join(''); // 강조 관계를 위에 그림
  }
  function applyView() {
    $('#og-world').style.transform = `translate(${O.tx}px, ${O.ty}px) scale(${O.k})`;
    $('#og-zoom-pct').textContent = `${Math.round(O.k * 100)}%`;
    drawOverview();
  }
  function bboxOf(ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach(id => { const p = posOf(id); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0] + NW); y1 = Math.max(y1, p[1] + NH); });
    return x0 === Infinity ? [0, 0, O.size[0], O.size[1]] : [x0, y0 - 30, x1, y1];
  }
  // 보이는 노드를 화면에 맞춤. 전체를 맞추면 글자를 읽을 수 없을 만큼 작아지는 경우에는 너비에 맞추고 위쪽부터 보임
  const MIN_READABLE_K = 0.42;
  function fit(ids) {
    const cv = $('#og-canvas');
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const [x0, y0, x1, y1] = bboxOf(ids || [...O.vis]);
    const pad = 36;
    const kw = (w - pad * 2) / (x1 - x0), kh = (h - pad * 2) / (y1 - y0);
    const all = Math.min(1.25, kw, kh);
    if (all >= MIN_READABLE_K || kw <= all) {
      O.k = Math.max(0.2, all);
      O.ty = (h - (y1 - y0) * O.k) / 2 - y0 * O.k;
    } else {
      O.k = Math.max(0.2, Math.min(1.25, kw));
      O.ty = pad - y0 * O.k;
    }
    O.tx = (w - (x1 - x0) * O.k) / 2 - x0 * O.k;
    O.fitted = true;
    applyView();
  }
  function centerOn(id) {
    const cv = $('#og-canvas');
    const p = posOf(id);
    if (O.k < 0.85) O.k = 0.85;
    O.tx = cv.clientWidth / 2 - (p[0] + NW / 2) * O.k;
    O.ty = cv.clientHeight / 2 - (p[1] + NH / 2) * O.k;
    applyView();
  }
  function zoomAt(f, mx, my) {
    const nk = Math.max(0.2, Math.min(2.2, O.k * f));
    O.tx = mx - (mx - O.tx) * nk / O.k;
    O.ty = my - (my - O.ty) * nk / O.k;
    O.k = nk;
    applyView();
  }
  function drawOverview() {
    const box = $('#og-overview svg');
    if (!box || !O.size) return;
    const W = 168, H = 96;
    const sc = Math.min(W / O.size[0], H / O.size[1]);
    const cv = $('#og-canvas');
    const vx = -O.tx / O.k * sc, vy = -O.ty / O.k * sc, vw = cv.clientWidth / O.k * sc, vh = cv.clientHeight / O.k * sc;
    O.ovScale = sc;
    box.innerHTML = NODES.filter(n => O.vis.has(n.id)).map(n => {
      const p = posOf(n.id);
      return `<rect class="${n.id === O.sel ? 'is-sel' : O.lin && O.lin.all.has(n.id) ? 'is-lit' : ''}" x="${(p[0] * sc).toFixed(1)}" y="${(p[1] * sc).toFixed(1)}" width="${(NW * sc).toFixed(1)}" height="${Math.max(1.5, NH * sc).toFixed(1)}"/>`;
    }).join('') + `<rect class="og-ov__view" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}"/>`;
  }

  const matches = (n, q) => [n.name, TMS.i18n.t(n.name), n.key, n.id, n.sub].some(s => String(s).toLowerCase().includes(q));
  function visibleSet() {
    const vis = new Set(NODES.filter(n => O.domain === 'all' || n.domain === O.domain).map(n => n.id));
    const keep = set => [...vis].forEach(id => { if (!set.has(id)) vis.delete(id); });
    if (O.source !== 'all') keep(reach(`src.${O.source}`, OUT, 'to'));
    if (O.lineage === 'selected' && O.sel) keep(lineage(O.sel).all);
    return vis;
  }

  // 화면 상태가 바뀔 때(선택·필터·검색) 다시 그림. 매 갱신 주기에는 tick()만 수행함
  function render(opts = {}) {
    O.vis = visibleSet();
    if (O.sel && !O.vis.has(O.sel) && O.lineage !== 'selected') { O.sel = null; O.vis = visibleSet(); }
    if (O.layoutKey !== [...O.vis].sort().join(',')) {
      autoLayout(O.vis);
      NODES.forEach(n => placeNode(n.id));
      drawGroups();
      sizeWorld();
    }
    O.lin = O.sel ? lineage(O.sel) : null;
    const q = O.q.trim().toLowerCase();
    NODES.forEach(n => {
      const el = nodeEls[n.id];
      const m = q ? matches(n, q) : true;
      const f = O.focusType ? n.type === O.focusType : true;
      el.hidden = !O.vis.has(n.id);
      el.classList.toggle('is-sel', n.id === O.sel);
      el.classList.toggle('is-lit', !!O.lin && O.lin.all.has(n.id) && n.id !== O.sel);
      el.classList.toggle('is-dim', (!!O.lin && !O.lin.all.has(n.id)) || !m || !f);
      el.classList.toggle('is-match', !!q && m);
    });
    drawEdges();
    // 묶음 상자: 묶인 규칙이 모두 흐리게 표시되면 상자도 흐리게 함
    document.querySelectorAll('#og-groups .og-group').forEach(g => {
      const rules = NODES.filter(n => n.type === 'rule' && `par.${parByKey[n.pkey].id}` === g.dataset.go && O.vis.has(n.id));
      g.classList.toggle('is-dim', rules.every(n => nodeEls[n.id].classList.contains('is-dim')));
      g.classList.toggle('is-lit', !!O.lin && rules.some(n => O.lin.all.has(n.id)));
    });
    $('#og-count').textContent = `${O.vis.size} / ${NODES.length} 노드`;
    $('#og-chip-mode').textContent = O.lineage === 'selected' ? (O.sel ? '선택 계보' : '선택 계보 · 노드를 고를 것') : '전체 계보';
    document.querySelectorAll('#og-lineage [data-l]').forEach(b => b.classList.toggle('is-on', b.dataset.l === O.lineage));
    document.querySelectorAll('#og-tools [data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === O.tool));
    $('#og-focus-param').classList.toggle('is-on', O.focusType === 'param');
    $('#og-canvas').classList.toggle('is-pan', O.tool === 'pan');
    renderHead();
    renderExplorer();
    renderProps();
    renderMain();
    renderDrawer();
    if (opts.fit) fit();
    else drawOverview();
    tick();
  }

  function select(id, opts = {}) {
    O.sel = id && byId[id] ? id : null;
    render();
    if (O.sel && O.lineage === 'selected') fit();
    else if (O.sel && opts.center) centerOn(O.sel);
  }

  // ---------- 머리 ----------
  function renderHead() {
    document.querySelectorAll('#og-views [data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === O.view));
    $('#og-meta-save').textContent = O.dirty ? '노드 위치 변경 · 저장 안 함' : '편집 시안 · 저장 안 함';
    $('#og-meta-save').classList.toggle('is-dirty', O.dirty);
    document.querySelector('.pane-ograph').dataset.ov = O.view;
  }

  // ---------- 탐색기 ----------
  function renderExplorer() {
    const q = O.q.trim().toLowerCase();
    const html = Object.entries(TYPES).map(([type, t]) => {
      const all = NODES.filter(n => n.type === type);
      const list = all.filter(n => !q || matches(n, q));
      if (q && !list.length) return '';
      const closed = !q && O.closed[type];
      let lastP = null;
      const items = closed ? '' : list.map(n => {
        const sub = type === 'rule' && n.pkey !== lastP ? `<div class="ox-sub">${esc(parByKey[n.pkey].name)}</div>` : '';
        if (type === 'rule') lastP = n.pkey;
        const rules = type === 'source' ? (OUT[n.id] || []).filter(e => byId[e.to].type === 'rule').length : 0;
        return `${sub}<div class="ox-item${n.id === O.sel ? ' is-selected' : ''}${O.vis.has(n.id) ? '' : ' is-hidden'}" data-id="${n.id}">
          ${glyph(type)}<span class="ox-item__name">${esc(n.name)}</span>${type === 'source' ? `<i class="ox-dot" data-src="${n.src}"></i>` : '<span></span>'}
          ${rules ? `<small>+ 변환 규칙 <b class="mono">${rules}</b></small>` : ''}</div>`;
      }).join('');
      return `<div class="ox-group${closed ? '' : ' is-open'}">
        <button type="button" class="ox-ghead" data-g="${type}"><i class="ox-sw ox-sw--${type}"></i>${t.label}<span class="count">${q ? `${list.length}/` : ''}${all.length}</span><i class="ox-chev"></i></button>
        ${items}</div>`;
    }).join('');
    $('#ox-body').innerHTML = html || '<p class="d-hint">찾는 노드가 없음.</p>';
    $('#ox-count').textContent = NODES.length;
  }

  // ---------- 노드 속성 ----------
  const sec = (key, title, small, body) => `<div class="sec${O.secClosed[key] ? '' : ' is-open'}" data-sec="${key}">
    <button type="button" class="sec__head">${title}${small ? `<small>${small}</small>` : ''}<i></i></button>
    <div class="sec__body">${body}</div></div>`;
  const kv = rows => `<dl class="kv2">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  function relList(id) {
    const rows = [...(IN[id] || []).map(e => ({ e, other: e.from, dir: 'in' })), ...(OUT[id] || []).map(e => ({ e, other: e.to, dir: 'out' }))];
    return `<div class="og-rels">${rows.map(r => `<button type="button" class="og-rel" data-go="${r.other}">
      <svg class="og-rel__ico" viewBox="0 0 16 16"><path d="${r.dir === 'in' ? 'M12 4L4.5 11.5M4.5 6v5.5H10' : 'M4 12l7.5-7.5M6 4.5h5.5V10'}"/></svg>
      <span><b>${esc(byId[r.other].name)}</b><small class="mono">${r.e.rel} · ${r.e.card}</small></span>
      <em>${r.dir === 'in' ? '상위' : '하위'}</em></button>`).join('')}</div>`;
  }
  function renderProps() {
    const box = $('#og-props');
    if (!O.sel) {
      const cnt = type => NODES.filter(n => n.type === type).length;
      box.innerHTML = `<div class="d-head">
        <div class="eyebrow">개요</div>
        <h1>비행 온톨로지</h1>
        <div class="d-status"><span class="st-text st-text--normal">${NODES.length}개 노드 · ${EDGES.length}개 관계</span></div>
        <div class="d-meta">프로파일 <b class="mono">${PROFILE}</b><br>가상 예시 정의 · 화면은 판정하지 않고 표시만 함</div>
      </div>
      ${sec('types', '노드 유형', `${Object.keys(TYPES).length}개 유형`, kv(Object.entries(TYPES).map(([k, t]) => [t.label, `<span class="mono">${cnt(k)}</span>`])))}
      ${sec('sources', '원천 수신', '실시간', `<table class="tbl"><tbody>${SOURCES.map(s => `<tr data-go="src.${s.id}" class="og-click"><td>${esc(s.name)}</td><td class="r" data-live="src" data-src="${s.id}"></td></tr>`).join('')}</tbody></table>`)}
      <p class="d-hint">그래프나 탐색기에서 노드를 고르면 정의, 연결 관계, 원천별 입력 값을 표시함.</p>`;
      return;
    }
    const n = byId[O.sel];
    const t = TYPES[n.type];
    const defRows = [['식별자', `<span class="mono">${esc(n.key)}</span>`], ['데이터 유형', `<span class="mono">${esc(n.dtype)}</span>`], ['단위', `<span class="mono">${esc(n.unit || '—')}</span>`],
      ['도메인', DOMAINS[n.domain]], ['프로파일', `<span class="mono">${PROFILE}</span>`], ['상태', `<span data-live="node"></span>`]];
    let extra = '';
    if (n.type === 'rule') {
      extra = sec('rule', '변환', '가상 예시', kv([['원천 필드', `<span class="mono">${esc(n.field)}</span>`], ['원천 단위', `<span class="mono">${esc(n.srcUnit || '미지정')}</span>`],
        ['변환식', `<span class="mono">${esc(n.formula)}</span>`], ['공통 필드', `<span class="mono">${esc(parByKey[n.pkey].id)}</span>`]]));
    } else if (n.type === 'source') {
      const s = srcById[n.src];
      extra = sec('src', '입력', '가상 예시', kv([['입력 단자', `<span class="mono">${esc(s.ep || '미지정')}</span>`], ['형식', esc(s.fmt)],
        ['경로 이름', `<span class="mono">${esc(s.path || '—')}</span>`], ['변환 규칙', `<span class="mono">${(OUT[n.id] || []).filter(e => byId[e.to].type === 'rule').length}</span>`]]));
    }
    const live = (n.type === 'rule' || (n.type === 'param' && n.pkey !== 'sig'))
      ? sec('live', '현재 값', `기준 기체 <b class="mono">${refAc()}</b>`, '<div data-live="values"></div>') : '';
    const rels = (IN[n.id] || []).length + (OUT[n.id] || []).length;
    box.innerHTML = `<div class="d-head">
      <div class="og-type-ico">${glyph(n.type, 'og-type-ico__svg')}</div>
      <div class="eyebrow">객체 유형 · ${t.label}</div>
      <h1>${esc(n.name)}</h1>
      <div class="mono muted og-id">${esc(n.id)}</div>
      <p class="og-desc">${esc(n.desc)}</p>
      <div class="d-actions">
        <button type="button" class="btn btn--sm" data-act="trace">→ 이 노드 추적</button>
        <button type="button" class="btn btn--sm" data-act="center">그래프에서 보기</button>
      </div>
    </div>
    ${sec('def', '정의', `${defRows.length}개 속성`, kv(defRows))}
    ${extra}${live}
    ${sec('rels', '연결 관계', `${rels}개`, relList(n.id))}
    <div class="og-props-foot">
      <button type="button" class="btn" data-act="edit">속성 편집</button>
      <button type="button" class="btn" data-act="connect">→ 연결</button>
      <button type="button" class="og-linkbtn" data-act="delete">노드 삭제</button>
    </div>`;
  }

  // ---------- 본문(관계 그래프 외 보기) ----------
  function renderMain() {
    const box = $('#og-table');
    if (O.view === 'objects') {
      box.innerHTML = `<table class="tbl tbl--og"><thead><tr><th>유형</th><th>이름</th><th>식별자</th><th>도메인</th><th>단위</th><th class="r">관계</th><th>상태</th></tr></thead><tbody>
        ${NODES.filter(n => O.vis.has(n.id)).map(n => `<tr data-go="${n.id}" class="og-click${n.id === O.sel ? ' is-selected' : ''}">
          <td><span class="og-type">${glyph(n.type)}${TYPES[n.type].label}</span></td><td><b>${esc(n.name)}</b></td><td class="mono">${esc(n.key)}</td>
          <td>${DOMAINS[n.domain]}</td><td class="mono">${esc(n.unit || '—')}</td><td class="r mono">${(IN[n.id] || []).length + (OUT[n.id] || []).length}</td>
          <td data-live="nodest" data-id="${n.id}"></td></tr>`).join('')}</tbody></table>`;
    } else if (O.view === 'data') {
      box.innerHTML = `<table class="tbl tbl--og"><thead><tr><th>원천</th><th>입력 단자</th><th>형식</th><th>경로 이름</th><th class="r">변환 규칙</th><th>수신 상태</th><th>도메인</th></tr></thead><tbody>
        ${SOURCES.map(s => `<tr data-go="src.${s.id}" class="og-click${`src.${s.id}` === O.sel ? ' is-selected' : ''}">
          <td><b>${esc(s.name)}</b></td><td class="mono">${esc(s.ep || '미지정')}</td><td>${esc(s.fmt)}</td><td class="mono">${esc(s.path || '—')}</td>
          <td class="r mono">${(OUT[`src.${s.id}`] || []).filter(e => byId[e.to].type === 'rule').length}</td>
          <td data-live="src" data-src="${s.id}"></td><td>${DOMAINS[s.domain]}</td></tr>`).join('')}</tbody></table>
        <p class="d-hint">입력 단자는 문서용 주소 대역(192.0.2.x)의 가상 값임. 실제 접속 정보는 넣지 않음.</p>`;
    } else box.innerHTML = '';
  }

  // ---------- 아래 서랍(데이터 미리보기·파라미터 매핑·관계·검증) ----------
  function previewRules() {
    const rules = NODES.filter(n => n.type === 'rule' && O.vis.has(n.id));
    if (!O.sel) return rules;
    const n = byId[O.sel];
    if (n.type === 'rule') return [n];
    const set = n.type === 'source' ? reach(n.id, OUT, 'to') : lineage(n.id).up;
    return rules.filter(r => set.has(r.id));
  }
  function renderDrawer() {
    const d = $('#og-drawer');
    d.classList.toggle('is-closed', !O.drawer);
    document.querySelectorAll('#og-dtabs [data-dt]').forEach(b => b.classList.toggle('is-on', b.dataset.dt === O.dtab));
    $('#og-valid-n').textContent = warnCount;
    $('#og-valid-n').hidden = !warnCount;
    const ac = refAc();
    const selA = $('#og-ac');
    if (selA.value !== ac) selA.value = ac;
    const n = O.sel ? byId[O.sel] : null;
    const sub = $('#og-dsub');
    const body = $('#og-dbody');
    if (O.dtab === 'preview') {
      const rules = previewRules();
      sub.innerHTML = `<span><b>${esc(n ? n.name : '전체 변환 규칙')}</b> / 원천별 입력 · 기준 기체 <b class="mono">${ac}</b></span><span>공통 단위로 변환해 표시 · 마지막 유효 수신 후 1초가 지나면 정보 없음</span>`;
      body.innerHTML = rules.length ? `<table class="tbl tbl--og tbl--preview"><thead><tr><th>원천</th><th>입력 단자</th><th>원천 필드</th><th class="r">입력 값</th><th>단위</th><th>변환식</th><th>공통 필드</th><th class="r">출력 값</th><th>단위</th><th>상태</th><th>수신 시각</th><th class="r">경과</th></tr></thead><tbody>
        ${rules.map(r => `<tr data-rule="${r.id}" data-go="${r.id}" class="og-click${r.id === O.sel ? ' is-selected' : ''}">
          <td>${esc(srcById[r.src].short)}</td><td class="mono muted">${esc(srcById[r.src].ep || '미지정')}</td><td class="mono">${esc(r.field)}</td>
          <td class="r mono" data-c="inV"></td><td class="mono muted">${esc(r.srcUnit || '미지정')}</td><td class="mono">${esc(r.formula)}</td>
          <td class="mono">${esc(parByKey[r.pkey].id)}</td><td class="r mono" data-c="outV"></td><td class="mono muted">${esc(r.unit)}</td>
          <td data-c="st"></td><td class="mono" data-c="at"></td><td class="r mono" data-c="age"></td></tr>`).join('')}</tbody></table>`
        : '<p class="d-hint">이 노드에는 원천별 입력 값이 없음(정의 데이터 또는 판정 엔진 결과). 판정 결과는 기체·판정 화면에서 확인함.</p>';
    } else if (O.dtab === 'mapping') {
      sub.innerHTML = '<span><b>파라미터 매핑</b> / 공통 파라미터 × 원천</span><span>원천 필드 · 변환식(가상 예시)</span>';
      body.innerHTML = `<table class="tbl tbl--og"><thead><tr><th>공통 파라미터</th><th>단위</th>${SENSORS.map(s => `<th>${esc(srcById[s].short)}</th>`).join('')}</tr></thead><tbody>
        ${PARAMS.filter(p => p.key !== 'sig').map(p => `<tr><td><b>${esc(p.name)}</b><small class="mono">${p.id}</small></td><td class="mono muted">${esc(p.unit)}</td>
          ${SENSORS.map(s => { const r = byId[`rule.${s}.${p.key}`]; return `<td data-go="${r.id}" class="og-click og-map${r.id === O.sel ? ' is-selected' : ''}"><span class="mono">${esc(r.field)}</span><small class="mono">${esc(r.formula)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    } else if (O.dtab === 'rels') {
      const list = EDGES.filter(e => O.vis.has(e.from) && O.vis.has(e.to) && (!O.lin || edgeLit(e, O.lin)));
      sub.innerHTML = `<span><b>관계</b> / ${n ? `${esc(n.name)} 계보` : '전체'}</span><span>${list.length}개</span>`;
      body.innerHTML = `<table class="tbl tbl--og"><thead><tr><th>출발 노드</th><th>관계</th><th>도착 노드</th><th>기수</th></tr></thead><tbody>
        ${list.map(e => `<tr><td class="og-click" data-go="${e.from}">${esc(byId[e.from].name)}</td><td class="mono">${e.rel}</td><td class="og-click" data-go="${e.to}">${esc(byId[e.to].name)}</td><td class="mono muted">${e.card}</td></tr>`).join('')}</tbody></table>`;
    } else {
      sub.innerHTML = `<span><b>정의 검증</b> / 주의 ${warnCount}건 · 참고 ${FINDINGS.length - warnCount}건</span><span>정의 형식만 확인함(비행 판정과 무관)</span>`;
      body.innerHTML = `<table class="tbl tbl--og"><thead><tr><th>수준</th><th>노드</th><th>내용</th></tr></thead><tbody>
        ${FINDINGS.map(f => `<tr class="og-click" data-go="${f.id}"><td><span class="st-tag st-tag--${f.lv}">${f.lv === 'na' ? '참고' : '주의'}</span></td><td><b>${esc(byId[f.id].name)}</b><small class="mono">${f.id}</small></td><td>${esc(f.msg)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  // ---------- 매 갱신 주기 ----------
  const setHTML = (el, h) => { if (el.innerHTML !== h) el.innerHTML = h; };
  const el3Set = {}; // 상태가 바뀌지 않는 노드는 한 번만 씀
  const stSpan = s => `<span class="st-text st-text--${s.cls}">${s.text}</span>`;
  function tick() {
    const mode = $('#og-mode');
    const live = S.mode === 'live';
    mode.className = `og-mode ${live ? 'is-live' : 'is-replay'}`;
    mode.textContent = live ? '실시간' : `재생 · ${kstMs(S.now)} KST`;
    NODES.forEach(n => {
      if (n.type !== 'source' && el3Set[n.id]) return;
      const st = nodeStatus(n);
      const el = nodeEls[n.id].querySelector('[data-st]');
      const h = `<i class="og-st og-st--${st.cls}"></i>${st.text}`;
      setHTML(el, h);
      el3Set[n.id] = true;
    });
    document.querySelectorAll('.ox-dot[data-src]').forEach(el => { el.className = `ox-dot ox-dot--${srcLive(el.dataset.src).cls}`; });
    document.querySelectorAll('[data-live="src"]').forEach(el => setHTML(el, stSpan(srcLive(el.dataset.src))));
    document.querySelectorAll('[data-live="nodest"]').forEach(el => setHTML(el, stSpan(nodeStatus(byId[el.dataset.id]))));
    const ns = document.querySelector('#og-props [data-live="node"]');
    if (ns && O.sel) setHTML(ns, stSpan(nodeStatus(byId[O.sel])));
    const ac = refAc();
    const vals = document.querySelector('#og-props [data-live="values"]');
    if (vals && O.sel) {
      const n = byId[O.sel];
      const rules = n.type === 'rule' ? [n] : SENSORS.map(s => byId[`rule.${s}.${n.pkey}`]).filter(Boolean);
      setHTML(vals, `<table class="tbl"><thead><tr><th>원천</th><th class="r">출력 값</th><th>상태</th></tr></thead><tbody>${rules.map(r => {
        const v = previewRow(r, ac);
        return `<tr><td>${esc(srcById[r.src].short)}</td><td class="r mono">${v.outV}${v.outV !== '—' && r.pkey !== 't' ? ` <small class="og-u">${esc(r.unit)}</small>` : ''}</td><td>${v.st}</td></tr>`;
      }).join('')}</tbody></table>`);
    }
    if (O.drawer && O.dtab === 'preview') {
      document.querySelectorAll('#og-dbody tr[data-rule]').forEach(tr => {
        const v = previewRow(byId[tr.dataset.rule], ac);
        tr.querySelectorAll('[data-c]').forEach(td => setHTML(td, v[td.dataset.c]));
      });
    }
  }

  // ---------- 내보내기 ----------
  function exportJson() {
    const doc = {
      name: '비행 온톨로지(가상 예시)', profile: PROFILE, exported_at: new Date().toISOString(),
      note: 'AAM TMS 관제 화면 시안의 가상 정의임. 개발·운영 정의가 아님.',
      types: Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.label])),
      nodes: NODES.map(n => ({ id: n.id, type: n.type, name: n.name, key: n.key, domain: n.domain, unit: n.unit, dtype: n.dtype,
        ...(n.type === 'rule' ? { source_field: n.field, source_unit: n.srcUnit, formula: n.formula } : {}), position: posOf(n.id).map(Math.round) })),
      edges: EDGES,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aamtms_ontology_example.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 조작 ----------
  const toast = m => TMS.panels.toast(m);
  const NO_EDIT = '시안: 정의 추가·편집·연결은 하지 않음. 노드 위치 이동만 이 창 메모리에 남음.';
  function bindCanvas() {
    const cv = $('#og-canvas');
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.og-ui')) return;
      const nodeEl = e.target.closest('.og-node');
      const groupEl = nodeEl ? null : e.target.closest('.og-group');
      const id = nodeEl ? nodeEl.dataset.id : null;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: id || (groupEl ? groupEl.dataset.go : null), node: id && O.tool === 'select' ? id : null, tx: O.tx, ty: O.ty };
      if (drag.node) drag.p = posOf(id).slice();
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.node) {
        O.pos[drag.node] = [drag.p[0] + dx / O.k, drag.p[1] + dy / O.k];
        placeNode(drag.node);
        drawEdges();
        drawOverview();
        if (!O.dirty) { O.dirty = true; renderHead(); }
      } else {
        cv.classList.add('is-panning');
        O.tx = drag.tx + dx;
        O.ty = drag.ty + dy;
        applyView();
      }
    });
    cv.addEventListener('pointerup', () => {
      if (!drag) return;
      cv.classList.remove('is-panning');
      if (!drag.moved) select(drag.id);
      drag = null;
    });
    cv.addEventListener('pointercancel', () => { drag = null; cv.classList.remove('is-panning'); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    const ovGo = e => {
      const r = e.currentTarget.querySelector('svg').getBoundingClientRect();
      const wx = (e.clientX - r.left) / O.ovScale, wy = (e.clientY - r.top) / O.ovScale;
      O.tx = cv.clientWidth / 2 - wx * O.k;
      O.ty = cv.clientHeight / 2 - wy * O.k;
      applyView();
    };
    const ov = $('#og-overview');
    ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); ov.dataset.drag = '1'; ovGo(e); });
    ov.addEventListener('pointermove', e => { if (ov.dataset.drag) ovGo(e); });
    ov.addEventListener('pointerup', () => { delete ov.dataset.drag; });
    const mid = () => [cv.clientWidth / 2, cv.clientHeight / 2];
    $('#og-zin').addEventListener('click', () => zoomAt(1.25, ...mid()));
    $('#og-zout').addEventListener('click', () => zoomAt(0.8, ...mid()));
    $('#og-fit').addEventListener('click', () => fit());
  }
  // 선택 이동: data-go 를 가진 요소를 누르면 해당 노드를 고르고 그래프에서 가운데로 옮김
  function onGo(e) {
    const g = e.target.closest('[data-go]');
    if (!g) return false;
    select(g.dataset.go, { center: O.view === 'graph' });
    return true;
  }
  function bind() {
    bindCanvas();
    document.querySelectorAll('#og-views [data-v]').forEach(b => b.addEventListener('click', () => {
      O.view = b.dataset.v;
      render();
      if (O.view === 'graph') fit();
    }));
    $('#og-export').addEventListener('click', () => { exportJson(); toast('가상 정의를 JSON 파일로 내보냄'); });
    $('#og-save').addEventListener('click', () => { O.dirty = false; renderHead(); toast('시안: 정의는 저장하지 않음. 노드 위치는 이 창 메모리에만 남음.'); });
    $('#ox-search').addEventListener('input', e => { O.q = e.target.value; render(); });
    $('#ox-collapse').addEventListener('click', () => { document.body.classList.add('assets-closed'); TMS.panels.update(); requestAnimationFrame(() => fit()); });
    $('#ox-body').addEventListener('click', e => {
      const g = e.target.closest('[data-g]');
      if (g) { O.closed[g.dataset.g] = !O.closed[g.dataset.g]; renderExplorer(); return; }
      const it = e.target.closest('.ox-item');
      if (it) select(it.dataset.id, { center: true });
    });
    document.querySelectorAll('#og-tools [data-tool]').forEach(b => b.addEventListener('click', () => { O.tool = b.dataset.tool; render(); }));
    document.querySelectorAll('[data-noedit]').forEach(b => b.addEventListener('click', () => toast(NO_EDIT)));
    $('#og-auto').addEventListener('click', () => {
      O.pos = {};
      O.dirty = false;
      O.layoutKey = null;
      render({ fit: true });
    });
    $('#og-validate').addEventListener('click', () => {
      O.dtab = 'valid';
      O.drawer = true;
      render();
      toast(`정의 검증 완료 · 주의 ${warnCount}건 · 참고 ${FINDINGS.length - warnCount}건`);
    });
    $('#og-focus-param').addEventListener('click', () => { O.focusType = O.focusType === 'param' ? null : 'param'; render(); });
    $('#og-domain').addEventListener('change', e => { O.domain = e.target.value; render({ fit: true }); });
    $('#og-source').addEventListener('change', e => { O.source = e.target.value; render({ fit: true }); });
    document.querySelectorAll('#og-lineage [data-l]').forEach(b => b.addEventListener('click', () => {
      O.lineage = b.dataset.l;
      render({ fit: true });
    }));
    document.querySelectorAll('#og-dtabs [data-dt]').forEach(b => b.addEventListener('click', () => { O.dtab = b.dataset.dt; O.drawer = true; render(); }));
    $('#og-dtoggle').addEventListener('click', () => { O.drawer = !O.drawer; render(); });
    $('#og-ac').addEventListener('change', e => { O.ac = e.target.value; render(); });
    $('#og-dbody').addEventListener('click', onGo);
    $('#og-table').addEventListener('click', onGo);
    $('#og-props').addEventListener('click', e => {
      const h = e.target.closest('.sec__head');
      if (h) {
        const s = h.closest('.sec');
        s.classList.toggle('is-open');
        O.secClosed[s.dataset.sec] = !s.classList.contains('is-open');
        return;
      }
      if (onGo(e)) return;
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'trace') { O.lineage = 'selected'; O.view = 'graph'; O.dtab = 'preview'; O.drawer = true; render({ fit: true }); }
      else if (a.dataset.act === 'center') { if (O.view !== 'graph') { O.view = 'graph'; render(); } centerOn(O.sel); }
      else toast(NO_EDIT);
    });
  }

  function build() {
    $('#og-ac').innerHTML = M.AIRCRAFT.map(a => `<option value="${a.id}">${a.id}${a.virtual ? ' (가상)' : ''}</option>`).join('');
    $('#og-source').innerHTML = `<option value="all">전체 원천</option>${SENSORS.map(s => `<option value="${s}">${esc(srcById[s].name)}</option>`).join('')}`;
    $('#og-domain').innerHTML = `<option value="all">전체 도메인</option>${Object.entries(DOMAINS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}`;
    $('#og-n-graph').textContent = EDGES.length;
    $('#og-n-objects').textContent = NODES.length;
    $('#og-n-data').textContent = SOURCES.length;
    $('#og-meta-rels').textContent = `${EDGES.length}개 관계`;
    buildGraph();
    bind();
    O.built = true;
    render({ fit: true });
    // 처음 그릴 때 영역 크기를 아직 모르면 다음 화면 갱신 때 맞춤(그사이 사용자가 고른 위치는 덮지 않음)
    if (!O.fitted) requestAnimationFrame(() => { if (!O.fitted) fit(); });
  }

  // 화면 역할이 온톨로지일 때만 처음 만들고 갱신함
  let lastClosed = null;
  function update() {
    if (S.view !== 'ontology') return;
    if (!O.built) { build(); return; }
    const closed = document.body.classList.contains('assets-closed');
    if (lastClosed !== null && closed !== lastClosed) requestAnimationFrame(() => fit());
    lastClosed = closed;
    tick();
  }
  function clear() { if (O.built && O.sel) select(null); }
  function focusSearch() {
    const s = $('#ox-search');
    if (s && s.offsetParent) { s.focus(); return true; }
    return false;
  }

  TMS.ontology = { update, clear, focusSearch };
})();
