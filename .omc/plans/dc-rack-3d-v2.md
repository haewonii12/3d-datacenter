# Plan: dc-rack-3d v2 — 지도 진입 · 현장 데이터 형식 · 장착 규칙 · 테마

- Source spec: `.omc/specs/deep-interview-dc-rack-3d-v2.md` (ambiguity 17%)
- Mode: ralplan consensus (short), iteration 3 — **Critic APPROVE, Architect SOUND_WITH_CHANGES → 개선 반영 완료**
- Status: **pending approval** (구현 금지 — 실행은 별도 승인 후)

## 1. Requirements Summary
1. 첫 화면 = 번들 지도(서울·경기 경계) + 가산IDC/영등포IDC/파주IDC 핀 → 클릭 시 해당 DC 3D.
2. 입력 = 장비 1행 flat 레코드(JSON 배열 / CSV): `build_name, floorspace_name, company, rack_name, device_position, device_name` (+ 선택 `total_u`). `device_position`이 빈 행 = 빈 랙.
3. `floorspace_name` = `{층1}{구역A-Z}{줄2}{순번2}`, 쉼표 목록이면 랙이 여러 칸 점유(상한 없음).
4. `device_position` = `{h}U ({s}-{e})`. 경계 U만 2대 공유, 그 외 겹침·랙 칸 중복은 위반 → 경고 + 빨간 표시(거부·제외 안 함).
5. 밝은/어두운 테마 + 스위치(localStorage), 설비 추가 없음.
6. hostname/ip/services 제거, 편집기는 새 필드로 유지.

## 2. RALPLAN-DR Summary

### Principles
1. **어댑터 + 규칙 단일 출처** — 레코드를 기존 내부 트리(`src/state/store.js:20-33`)로 변환하되, 장착·칸 규칙은 `src/domain/mount.js`/`src/domain/floorspace.js` 두 모듈에만 존재하고 schema·edit·scene은 이를 호출만 한다.
2. **원본 코드가 진실, 좌표는 파생** — 트리에 `rack.floorspaces[]`(원본 코드), `server.device_position`(원본 문자열)을 보존. row/col/span은 렌더 전용 파생값.
3. **경고는 데이터, 표시는 파생** — 위반은 Issue `{path,message,kind,targets}`; 렌더러는 `violation` 플래그만 본다. 어떤 위반도 랙/장비를 제외하지 않는다(파싱 불가 device_position만 렌더 제외).
4. **오프라인 보장** — 런타임 네트워크 요청은 `data/` 정적 데이터 파일뿐. 지도 경계는 JS 번들에 import.
5. **테마는 주입** — 색/조명/배경을 `src/scene/setup.js:14`(`0x0d1117`) 하드코딩에서 theme 객체로.

### Decision Drivers (top 3)
1. 기존 기능(드릴다운, 해시, 검색, e2e 8개 spec 파일) 회귀 최소화.
2. 장착 규칙의 정확한 검증·표시(경계 U 공유).
3. 폐쇄망 배포(`Dockerfile`, `docker/nginx.conf`, `k8s/dc-rack-3d.yaml`) 유지.

### Viable Options
**A. 어댑터 + 구역은 메타데이터, 좌표는 col-offset 합성 (선택)**
- floor에 `zones:[{id:'A', colOffset, rows, cols}]` 메타를 두고 rack은 `{zone,row,seq,span,row(=줄),col(=offset+seq)}`. 기존 `floor.racks` 평면 배열·`gridToWorld` 유지.
- Pros: store/picking/view의 floor→racks 계약 유지, 구역 그룹핑은 `floor.zones`로 충족(AC 11). Cons: 구역 사이 갭 칼럼이 "빈 슬롯"으로 오인될 수 있어 slots 로직을 구역 인식형으로 바꿔야 함.

**A'. 어댑터 + 구역을 트리 1급 레벨로 (floor→zone→racks)**
- Pros: 도메인과 1:1, AC 11을 문자 그대로 충족, 갭 칼럼 문제 없음(구역별 그리드). Cons: `store.js` index·`floors.js`·`racks.js`(층당 InstancedMesh 1개, `racks.js:23-48`)·`picking.js`·해시(`zone` 키 추가 여부)·브레드크럼 전부 레벨 추가 필요 → 드라이버 1 위배 정도가 A보다 큼.

**B. 도메인 전면 재작성** — 기각: store/scene/ui/tests 대부분 재작성, A/A' 대비 이득은 명칭 일치뿐.

→ **A 선택.** A'의 장점(구역 단위 그리드)은 `floor.zones` 메타 + 구역 인식 `emptySlots`로 흡수.

## 3. 핵심 규칙 정의 (단일 출처)

### 3.1 장착 규칙 — `src/domain/mount.js`
- 두 장비를 `(s, e)` 오름차순 정렬해 L(아래), U(위). `ov = min(L.e,U.e) - max(L.s,U.s) + 1`.
- `ov <= 0` → OK.
- **경계 공유 OK ⇔ `L.s < U.s && L.e == U.s && U.e > L.e`** (따라서 1U 장비는 어떤 U도 공유할 수 없음).
- 그 외 `ov >= 1` → 위반 `mount-overlap`(동일 범위 / 포함 / 2U 이상 겹침 모두 포함).
- 방어적 검사: U별 장비 수 > 2 → `mount-crowded` (위 규칙 하에서 단독 발생 불가, 데이터 손상 탐지용).
- 복잡도: 랙당 쌍별 O(n²), n ≤ 42 → 충분.
- `sharedUnits(devices) → Map<u,{lower,upper}>` 렌더용.

### 3.2 공유 U 렌더 모델 (하나로 고정)
- 공유 U는 `UNIT_H/2`에서 분할: 아래 장비 = 하단 절반, 위 장비 = 상단 절반.
- 스펙 AC 17의 "반씩(홀 단위)"는 **반-U 분할로 충족**한다고 간주 (U당 3홀은 물리 사실이나 렌더 해상도는 반-U; 사용자 확인 항목 → §9).
- 엘리베이션은 U당 2 그리드 행(`repeat(2*total_u)`).

### 3.3 칸 규칙 — `src/domain/floorspace.js`
- `parseFloorspace` 정규식 `/^(\d)([A-Z])(\d{2})(\d{2})$/` → `{floor,zone,row,seq}`.
- 랙 칸 목록은 같은 floor/zone/row & seq 연속이어야 함; 아니면 `rack-noncontiguous` 경고(렌더는 min~max seq 폭).
- (floor,zone,row,seq) 키를 두 랙이 사용 → `rack-cell-conflict`, 두 랙 모두 violation, 둘 다 렌더.

### 3.4 ID 합성
- rack id = `rack_name` (build 내 유일). 같은 rack_name이 다른 floorspace_name으로 재등장 → `rack-floorspace-mismatch` 경고, 첫 값 사용, 장비는 같은 랙에 귀속.
- device id = `${rack_name}:${s}-${e}:${k}` (k = 같은 rack·범위 내 등장 순번 0..). 파싱 실패 장비는 `${rack_name}:invalid:${k}`.
- `device_name` 중복 허용(검색 결과에 모두 노출).
- 모든 rack/device/Issue는 `src: {row}`(CSV 행 번호 또는 JSON 배열 index+1)를 가짐 → `parseCsvDataset`의 `rowOfPath`(`csv.js:229`, `load.js:64`) 대신 Issue.targets의 `src.row`로 "5행 …" 메시지 생성.

## 4. Implementation Steps

### Phase 1 — 데이터/규칙 (순수, 테스트 먼저)
1. `src/domain/mount.js`, `src/domain/floorspace.js` 신규 (§3).
2. `src/data/records.js` 신규: `parsePosition` (`/^\s*(\d+)\s*U\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)\s*$/i`; `h≠e-s+1`·`s<1`·`e>total_u` → `position-invalid` 경고 + 렌더 제외), `recordsToDataset(records)` → `{version:3, datacenters:[{id:build_name, name:build_name, floors:[{id:'3F', level:3, zones:[…], rows, cols, racks:[…]}]}]}`. 구역 배치: 알파벳 순 가로, `colOffset(zone_i) = Σ(prev cols) + ZONE_GAP(2)`, 구역 cols = 그 구역 max seq, rows = max 줄.
3. `src/data/schema.js` — v3 트리 검증으로 교체: `STATUSES`/services/hostname/ip 검증 제거(`schema.js:5` 이하), **슬롯 중복 검사 `schema.js:101-107`(excludedRacks) → `checkRackCells` 경고로 교체, U 겹침 검사 `schema.js:131-143` → `checkMounts` 경고로 교체**. `excludedRacks`는 제거, `invalidServers`는 파싱 실패 장비만. `normalize`(`schema.js:188` 부근, 기존 `invalid` 플래그 옆)가 `checkMounts`/`checkRackCells` 결과로 `rack.violation`/`server.violation`(사유 배열)을 파생; `toPlain`은 `violation`·`invalid`·`src`를 제거.
4. `src/data/load.js:35-46` — JSON 최상위가 배열이면 `recordsToDataset` 후 `checkDataset`; 객체면 v3 트리로 검증. `parseCsvDataset`(`load.js:60`)은 새 컬럼.
5. `src/data/csv.js` — 헤더 교체. 쉼표 목록 따옴표 처리는 기존 파서(`csv.js:54-67`) 재사용. `datasetToCsv`(`csv.js:248-252`)는 `rack.floorspaces.join(',')`, `server.device_position` 원본 문자열로 출력, 장비 없는 랙은 `device_position` 빈 행 1개로 출력. 빈 층/DC는 flat 형식으로 표현 불가 → 내보내기에서 생략(문서화).
6. `src/data/edit.js` — (편집기 `addRack`은 이미 사용 중인 칸이면 **UI에서 거절**(사용자가 새 충돌을 만들지 않게); 로드된 데이터의 충돌은 경고만 — 정책 분리) `checkUnits:64-71` throw → `checkMounts` 결과를 경고로 반환(저장 허용); `checkHostname:74` 삭제; `addRack:160-172`는 floorspace 코드 목록을 받음(파생 row/col 재계산); `firstEmptySlot`(`edit.js:191`)은 구역 인식 `emptySlots` 사용; `toPlain`은 `floorspaces`, `device_position` 유지.
7. `src/domain/slots.js` — `emptySlots(floor)`: `floor.zones` 각 구역의 rows×cols 셀만 후보(갭 칼럼 제외), 랙의 span 전 셀을 taken 처리. 반환에 `floorspace` 코드 포함.
8. `scripts/gen-sample.mjs` — 3 DC(가산 4층/영등포 3층/파주 2층), 층당 구역 A–C, 시드 고정, 랙 10% span 2–5, 랙 15%에 경계 공유 쌍, 빈 랙 5%, 위반 0. `examples/violations.csv`: 동일 1U, 포함(`3U (29-31)`+`1U (31-31)`), 2U 겹침, 칸 충돌, 비연속 칸, 파싱 실패, 미등록 build(`의왕IDC`) 각 1건 이상. `examples/upload-example.{csv,json}` 새 형식.

### Phase 2 — 지도 상태/화면
9. `src/state/store.js` — 명시적 `mode: 'map' | 'dc'`. 해시 `''` 또는 `#map` → map. 수정 지점: `scope()`(`:37`)는 map에서 null, `resolve()`(`:53-54`) firstDc 강제 제거, `navigate()`(`:69`) `dc:null` = map 진입 허용, `setData` 리셋(`:90`) → 현재 dc가 사라졌으면 map, `goLevel('root')`(`:115`) → map. **정식 map 해시는 `#map` 하나**(`''`는 로드 시 `#map`으로 replaceState). 레거시 해시(`dc` 없이 `floor` 등만 있음, 또는 존재하지 않는 dc) → map. `goLevel`에 `'dc'` 레벨 추가(`navigate({dc})` = DC overview), `'root'` = map. `src/state/hash.js` serialize/parse에 map 왕복 테스트.
10. `src/domain/sites.js` — 핀 좌표 상수(가산디지털단지역 37.4816,126.8827 / 영등포역 37.5157,126.9074 / 파주시청 37.7599,126.7800; 허용 오차 ±0.02°, 실제 IDC 주소는 사용자 제공 시 교체 — §9). 미등록 build_name → `unknown-build` 경고.
11. `src/geo/seoul-gyeonggi.geo.json` (JS에서 `import`, 번들 포함) — 사전 단순화 **GeoJSON**(TopoJSON 아님, 디코더 불필요). 출처: 통계청 SGIS 시군구 경계(공공누리 1유형) 또는 `southkorea/southkorea-maps`(KOSTAT 2013, MIT 저장소); mapshaper로 서울·경기 시군구만 추출·단순화 ≤ 300KB. 실행 환경이 오프라인이면 실행자가 사용자에게 파일 요청(블로커로 보고).
12. `src/ui/mapView.js` 신규 — SVG, 등장방형 선형 투영(bbox→viewBox), 시군구 path, 핀 3개. hover 툴팁 `가산IDC · 랙 N · 장비 M`(AC 3), 클릭 → `store.navigate({dc})`(AC 4). 우측 목록: 등록 DC 3개 + "미등록 DC" 섹션(클릭 시 진입, AC 5).
13. `src/main.js` — `#map` 컨테이너; map 모드에서 `#viewport` 숨김 + `setup.pause()/resume()` 신규 메서드로 렌더 루프 정지. **DC 의존 구독자 전부 map 가드**(`dc==null`이면 no-op/숨김): `src/scene/view.js:45,142-144`(`loadDc(null)` 금지, 이전 씬 유지), `src/ui/editor.js:113,201,238,293`, `floorSummary`, `elevation`, `serverPanel`, `search`(`search.js:42` scope = 전체 DC). store.test + map.spec에서 map↔dc 왕복 시 콘솔 에러 0건. `dcSelect`(`main.js:54,73` 생성·구독) 및 `src/ui/dcSelect.js` 삭제. `src/ui/breadcrumb.js`(`:12` root=DC 규칙 변경) `지도 > 가산IDC > 3F > …`, `지도`=goLevel('root'), DC명=goLevel('dc'). `window.__dc.isSettled()`는 map 모드에서 SVG 렌더 완료 시 true, `window.__dc.mode`/`theme` 노출(e2e용, `src/debug.js`).

### Phase 3 — span 기하 / 렌더
14. `src/domain/layout.js` — 단일 계약 `rackFootprint(floor, rack) → {cx, cz, w}`: `w = span*COL_PITCH - (COL_PITCH - RACK.w)`, `cx = gridToWorld(start).x + (span-1)*COL_PITCH/2`. `mountY(device, shared) → {y, h}` (§3.2). `locationLabel` → `3A0401-U29–31`. **`gridToWorld` 직접 호출부는 `src/scene/racks.js:42`, `src/scene/floors.js:36`(빈 슬롯 마커 — 구역 인식 `emptySlots` 사용) 두 곳뿐** → `rackFootprint`로 교체, grep 0건(layout.js 제외)을 완료 조건으로. 그 외 rackDetail/view/camera는 `racks.rackCenter`→`setFromMatrixPosition`로 위치만 읽으므로 스케일 영향 없음 — 단 **폭**은 별도 반영: `rackDetail.js:48-60,117`(캐비닛/엣지/피킹 프록시)에 `w` 파라미터, `view.js:62` 가림 판정은 x 구간 겹침으로(`racks.rackFootprint(id)` 접근자 추가).
15. `src/scene/racks.js` — 인스턴스 행렬 = translate(cx) × scale(w/RACK.w, 1, 1). 테마별 점유율 표시(dark: 본체 색, light: 검정 본체 + 상단 띠 InstancedMesh). violation 랙: 빨간 엣지 LineSegments, `hideInstance` 시 함께 숨김.
16. `src/scene/rackDetail.js` — 캐비닛/엣지/피킹 프록시가 `w` 파라미터 사용; 장비 박스는 `mountY`(`unitToY` 호출 `:128,210` 교체); violation 장비 빨간 재질; `hostname` 라벨(`:137`) → `device_name`.
17. `src/ui/elevation.js` — U당 2행 그리드(`elevation.js:31` 템플릿 교체), 공유 U 상하 분할, 위반 행 빨강, 파싱 실패 장비는 하단 "위치 오류" 목록.
18. `src/scene/floors.js` — `floor.zones`별 바닥 판 + 높이 0.4 낮은 벽 + 구역 라벨, CanvasTexture 절차 생성 바닥 타일(외부 이미지 없음).

### Phase 4 — 테마
19. `src/ui/theme.js` — (런타임 토글 시 `theme` 구독으로 `racks.applyTheme`, `rackDetail.applyTheme`, `floors.applyTheme`이 재질 색만 갱신 — 재빌드 없음; `rackDetail.js:23,39-40`, `floors.js` 하드코딩 색 → theme 값) `THEMES.light/dark = {clear, bgGradient, fog, hemi, sun, floorTile, wall, rackBody, band}`; `localStorage['dc3d.theme']` (기본 dark); `document.documentElement.dataset.theme`.
20. `src/scene/setup.js:14-25` — `applyTheme(t)`: Scene.background 그라데이션 CanvasTexture, `scene.fog`, 조명 강도, **그림자 정책: overview off, floor·rack·server 모드 on**(shadowMap 2048, sun.castShadow, 랙 castShadow, 바닥 receiveShadow).
21. `src/style.css` — CSS 변수(`--bg`, `--panel`, `--text`, `--border`, `--accent`), `[data-theme=light]` 오버라이드, 상단 토글 버튼.

### Phase 5 — UI 필드/검색/편집기 (hostname 제거 전수)
22. `src/ui/serverPanel.js` — device_name, company, rack_name, floorspace_name, device_position, build_name, 위반 사유.
23. `src/domain/search.js` — 필드 device_name/company/rack_name, 보조 텍스트 `rack_name · 3A0401 · DC`.
24. `src/ui/tooltip.js:12` — 랙 `RI20261120 · 3A0401–02 · 31/42U (74%)`, 장비 `device_name · company · U29–31`.
25. `src/ui/breadcrumb.js:17`(hostname → device_name), `src/ui/editor.js` 폼 교체(빈 U 클릭 → `1U (u-u)` 프리필, `editor.js:391 worldToGrid` → 셀→floorspace 코드 역매핑 `floorspaceAt(floor,x,z)` in layout.js), 저장 시 경고 갱신.
26. `src/ui/warnings.js` — kind별 그룹, 항목 클릭 → 해당 랙/장비로 navigate.
27. 실행 시 `grep -rn "hostname\|services\|\.ip\b" src` 0건 확인.

### Phase 6 — 테스트/문서
28. Unit 신규: `tests/unit/mount.test.js`, `floorspace.test.js`, `records.test.js`, `sites.test.js`; 갱신: `schema/csv/edit/search/layout/slots/store/hash`.
29. E2E: 헬퍼(`tests/e2e/helpers.js`) 먼저 — 기본 진입 `#dc=가산IDC`, `isSettled` map 대응. 신규 `map.spec.js`, `mount.spec.js`, `theme.spec.js`. `playwright.config.js`에 `dark`/`light` 두 project(`storageState` localStorage로 테마 주입) → 기존 8개 spec 양 테마 실행(AC 9).
30. `tests/e2e/perf.spec.js` — 현재는 `frames > 0`만 확인. **실제 게이트 추가**: 10k 샘플에서 `data-ready=ok`까지 시간 측정. 기준 = 변경 전 커밋(`57cd944`)에서 같은 10k 샘플·같은 headless SwiftShader 설정으로 3회 측정 중앙값 × 1.5, `tests/e2e/perf.baseline.json`에 측정값·환경·날짜와 함께 저장.
31. `tests/e2e/offline.spec.js` — 전체 세션 동안 `page.on('request')`로 origin 외 요청 0건. 이어서 로드 완료 → `context.setOffline(true)` → 페이지 내 `#dc=가산IDC` → `#map` 이동 → SVG path ≥ 1개, 핀 3개 assert(리로드 없음).
32. README, `examples/README.md`: 새 형식, 규칙, 지도 출처·라이선스.

## 5. AC Traceability
| AC | 내용 | Step | 검증 |
|---|---|---|---|
| 1 | 첫 화면 지도 | 9,12,13 | map.spec: 해시 없이 진입 → `#map svg` 보임, `__dc.mode==='map'` |
| 2 | 오프라인 지도 | 11,12 | offline.spec |
| 3 | 핀 hover 툴팁 | 12 | map.spec: hover → 텍스트 `랙`·`장비` 수 = 데이터 집계 |
| 4 | 핀 클릭 진입/복귀 | 9,12 | map.spec: 클릭 → `#dc=가산IDC`, 브레드크럼 `지도` 클릭·`goBack` → map |
| 5 | 미등록 DC 목록 | 10,12 | map.spec(violations.csv 로드): "미등록 DC" 항목 클릭 진입, 경고 1건 |
| 6 | 테마 유지 | 19,21 | theme.spec: 토글 → 리로드 → `__dc.theme` 유지 |
| 7 | 밝은 테마 시각 | 15,18,20,21 | theme.spec: `scene.background`≠단색, 띠 mesh 존재, `html[data-theme=light]`, `__dc.shadows` floor 모드 true·overview false; 스크린샷 보관(`docs/`) |
| 8 | 어두운 테마 시각 | 18,20 | theme.spec: fog 존재, 벽 mesh 수 = 구역 수 |
| 9 | 양 테마 e2e | 29 | playwright dark/light project |
| 10 | 입력 형식 | 2,4,5 | records/csv unit |
| 11 | 그룹핑(층/구역/줄) | 2 | records.test: floor.zones, 구역별 rack 수, mismatch 경고 |
| 12 | floorspace 파싱 | 1 | floorspace.test |
| 13 | 2칸 폭·피킹 | 14,15,16 | layout.test(`rackFootprint`), rack.spec: span 2 랙의 두 번째 칸 위치 클릭 → 같은 랙 선택 |
| 14 | floorspace 불일치 경고 | 2 | records.test |
| 15 | 상세 패널 필드 | 22 | server-nav.spec |
| 16 | 검색 | 23 | search.test, search.spec |
| 17 | 경계 공유 OK·반분 | 1,14,17 | mount.test, layout.test(y 구간 맞닿음), mount.spec |
| 18 | 동일 1U 위반 | 1,26 | mount.test, mount.spec(빨강·경고) |
| 19 | 포함/2U 겹침 위반 | 1 | mount.test: `4U(10-13)+1U(11-11)`, `3U(29-31)+1U(31-31)`, `1U(29-29)+3U(29-31)`, `3U(10-12)+3U(11-13)` |
| 20 | 파싱 실패 정책 | 2,17 | records.test: `2U (5-7)`,`abc` → 경고 + 렌더 제외, elevation "위치 오류" 목록 |
| 21 | 칸 충돌 | 1,3 | floorspace.test, schema.test(제외 안 됨) |
| 22 | 점유율 distinct U | — (`occupancy.js:usedU` 유지) | occupancy.test: 공유 U 1회 카운트 |
| 23 | 샘플 생성 | 8 | gen-sample 2회 실행 해시 동일, 위반 0 |
| P1 | 전체 테스트 | 28–31 | `npm test`, `npm run test:e2e` |
| P2 | 외부 요청 0 | 31 | offline.spec |
| P3 | 성능 회귀 | 30 | perf.spec 게이트 |

## 6. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| 합성 좌표가 실제 현장 배치와 다름 | 합성은 `records.js` 한 함수 + `ZONE_GAP` 상수; 도면 좌표 생기면 교체(Follow-up) |
| span 랙 기하 불일치(렌더/피킹/가림/카메라) | `rackFootprint` 단일 계약 + `gridToWorld` 호출부 grep 0건 조건 + rack.spec span 케이스 |
| 규칙이 schema/edit/scene에 중복돼 판정 불일치 | 원칙 1: mount.js/floorspace.js만 규칙 보유, schema/edit는 호출; edit.test에서 같은 입력에 같은 경고 확인 |
| map 모드 진입 불가(store 폴백) | Step 9의 5개 지점 수정 + store.test map 전이 케이스 |
| 그림자/안개 성능 | overview 그림자 off; perf.spec 게이트 |
| 지도 파일 확보(오프라인 실행 환경) | 실행 첫 단계에서 확보, 불가 시 블로커 보고 |
| hostname 제거로 e2e 대량 실패 | helpers.js 먼저, grep 0건 조건 |
| flat 형식이 빈 층/DC 표현 불가 | 빈 랙은 빈 행으로 표현, 빈 층/DC 내보내기 생략 문서화 |

## 7. Verification Steps
1. `npm test` green (신규 4 + 갱신 8 unit 파일).
2. `npm run gen:sample && npm run build && npm run test:e2e` (dark/light 양 project).
3. `grep -rn gridToWorld src | grep -v domain/layout.js` 0건, `grep -rn "hostname\|services" src` 0건.
4. 수동: `npm run preview` → 지도 → 핀 진입 → span 랙 → 경계 공유 엘리베이션 → `examples/violations.csv` 업로드 → 경고 그룹·빨간 표시 → 테마 토글/리로드.
5. Docker 이미지(`docker/nginx.conf`)로 띄워 외부 요청 0건.

## 8. ADR
- **Decision:** 레코드→내부 트리 어댑터(A, 구역은 `floor.zones` 메타), 규칙은 `mount.js`/`floorspace.js` 단일 출처, 원본 코드 보존·좌표 파생, 번들 GeoJSON SVG 지도, 명시적 map 모드, 테마 주입.
- **Drivers:** 회귀 최소화, 규칙 정확성, 폐쇄망.
- **Alternatives considered:** A'(구역 트리 레벨 — store/scene/해시 레벨 추가 비용으로 기각, 장점은 zones 메타로 흡수), B 전면 재작성(기각), 온라인 지도 타일(폐쇄망), 3D 지도(Round 4 사용자 기각), 위반 거부(Round 8 사용자 기각), TopoJSON(디코더 의존 → GeoJSON).
- **Why chosen:** floor→racks 계약을 유지하면서 규칙·형식을 테스트 가능한 경계로 격리.
- **Consequences:** 내부 명칭 `servers`≠device; 구역 갭 칼럼이 좌표계에 존재(slots가 인식); flat 내보내기는 빈 층/DC 손실.
- **Follow-ups:** servers→devices 명칭 리팩터, 실제 도면 좌표, IDC 실제 주소 좌표, 공유 U 홀 단위(1/3) 렌더 필요 여부(§9).

## 9. 사용자 확인 필요 (실행 전 또는 실행 중 기본값)
1. 공유 U 표시를 반-U 분할로 할지, 3홀 기준(예: 아래 장비 2홀/위 장비 1홀)으로 할지 — 기본값 반-U.
2. 가산/영등포/파주 IDC 실제 주소(핀 위치) — 기본값 역/시청 근사.
3. 지도 경계 파일 출처 — 기본값 SGIS/southkorea-maps 단순화본.

## Changelog
- iter 3 (Critic APPROVE, Architect SOUND_WITH_CHANGES 반영):
  - DC 의존 구독자 map 가드(view `loadDc(null)` 크래시 방지), `setup.pause/resume`.
  - `#map` 정식 해시, 레거시 해시 규칙, `goLevel('dc')` 레벨 + 브레드크럼.
  - 레코드 원본 행(`src.row`) 추적 → CSV 경고 행 번호 정확화.
  - `violation` 파생 위치(normalize) 명시, toPlain 제거.
  - Step 14 호출부 목록 정정(racks.js:42, floors.js:36), 폭 반영 지점 분리.
  - 테마 런타임 적용(rackDetail/floors 재질), 그림자 assert, perf baseline 저장 위치, offline 테스트 절차 정정, 편집기 칸 충돌 거절 정책.

- iter 1: 초안.
- iter 2 (Architect SOUND_WITH_CHANGES + Critic REVISE 반영):
  - 장착 규칙 수정: 포함 관계(`3U(29-31)+1U(31-31)`, `1U(29-29)+3U(29-31)`)를 경계로 오인하던 결함 → `L.s<U.s && L.e==U.s && U.e>L.e`; O(n²) 명시.
  - 공유 U 렌더를 반-U 단일 모델로, HOLE_H·3서브행 제거, 엘리베이션 U당 2행.
  - store map 모드: 5개 폴백 지점 명시(`store.js:37,53-54,69,90,115`).
  - schema `:101-107`/`:131-143`, edit `:64-75,160-172,191` 규칙을 단일 모듈 호출 + 경고화(제외/throw 제거).
  - span 기하 계약 `rackFootprint` + 모든 `gridToWorld` 호출부 교체, rackDetail 폭 파라미터, view 가림 판정.
  - slots 구역·span 인식, ID 합성 규칙, 원본 코드 보존, 빈 랙 행 표현, CSV 왕복.
  - 지도: GeoJSON import(원칙 4 정합), 출처 명시; AC 3/5 단계 추가.
  - perf 게이트 실제화, 그림자 정책 단일화, 양 테마 e2e project, AC 추적표, e2e 8개로 정정, A' 대안 추가.
</content>
</invoke>
