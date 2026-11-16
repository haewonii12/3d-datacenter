# Plan: dc-rack-3d — 데이터센터 랙/서버 3D 뷰어

- Status: **pending approval** (v3.1 — consensus reached; v3 — revised after round-2 Architect APPROVE_WITH_CHANGES + Critic REVISE)
- Source spec: `.omc/specs/deep-interview-dc-rack-3d.md` (ambiguity 13%, AC 1–21)
- Target dir: `~/dc-rack-3d` (does not exist yet — greenfield; all paths below are relative to it)
- Versions verified 2026-11-16: three@0.187.0, vite@8.3.8, Node 22.21.1
- Out of scope: 접근성(a11y), 모바일 최적화, 편집, 인증, 실시간 연동

## Requirements Summary
정적 웹앱(Vite + three.js, vanilla JS). 단일 중첩 JSON(층→랙→서버→서비스) 로드. 뷰 상태 `{floor, rack, server}`(각 null 가능)에서 모드를 **파생**:
`overview`(전 층 수직 분해 스택) → `floor` → `rack`(랙 줌인 + U1–U42 엘리베이션) → `server`(서버 상세 + 서비스).
랙 색 = U 점유율 3단계, 빈 슬롯 = 바닥 점선. 브레드크럼, ESC/빈공간 클릭 = 한 단계 위, URL 해시 상태(브라우저 뒤로가기 = 이전 상태), 검색(호스트명/서비스명 → 자동 드릴다운). 규모: 4층 × ~240슬롯 × 42U, 서버 수천 대.

## RALPLAN-DR Summary

### Principles
1. **Data model is the contract** — `src/data/schema.js` 하나가 생성기·로더·렌더러의 기준. 실데이터 교체 시 JSON만 바뀐다.
2. **View state is a pure value; mode is derived** — `{floor, rack, server}` → `mode()`; 3D 변경은 오직 `scene/view.js#applyView(prev, next)`, DOM 패널은 store 구독.
3. **Render cost scales with what's visible** — 층별 InstancedMesh(≤5 draw call), 서버 지오메트리는 선택된 랙만.
4. **Testable without a GPU** — 도메인/상태/검증은 three 비의존 순수 모듈 + Vitest. e2e는 `window.__dc` 디버그 훅으로 결정적 검증.
5. **Minimal dependencies** — runtime: `three`, `camera-controls`. dev: `vite`, `vitest`, `@playwright/test`.

### Decision Drivers
1. 수천 오브젝트에서 부드러운 렌더 + 정확한 피킹
2. 드릴다운/뒤로/URL/검색이 한 상태 모델로 일관 동작 (카메라 전환 포함)
3. 실데이터 교체 용이성(검증 + 명확한 에러/경고)

### Viable Options (top-level)
**A. Vanilla three.js + 순수 JS store + 단일 reconciler (favored)**
- Pros: 사용자 결정(Round 6 "Vite + three.js 그대로")과 일치, 의존성 최소, InstancedMesh/셰이더 직접 제어
- Cons: DOM↔3D 동기화와 카메라 전환을 직접 작성 → `scene/view.js` 단일 reconciler + `camera-controls`로 완화

**B. React + react-three-fiber + drei**
- Pros(steelman): 앱의 상당 부분이 DOM 패널 + 상태→렌더 동기화라 React가 Principle 2를 공짜로 제공; drei `CameraControls`/`Html`/`<Instances>`가 전환·라벨·인스턴스 이벤트를 해결; r3f도 `instanceId`를 그대로 노출해 직접 제어 손실은 작다
- Cons: 사용자가 Round 6에서 React 옵션을 명시적으로 고르지 않음, 번들·학습비용 증가
- **기각 사유는 사용자 결정(Round 6)이 주된 이유**임을 명시. 기술적으로는 유효한 대안.

**C. 오버뷰/층 2D Canvas + 랙만 3D** — *invalidated*: 사용자가 3D 분해 스택을 명시 선택(Round 7–8).

### Sub-decisions within A
| 결정 | 선택 | 대안 | 이유 |
|------|------|------|------|
| 랙 메시 | 층별 `InstancedMesh` + 층별 전용 material | 전체 1개 InstancedMesh / 랙별 Mesh | 층 단위 페이드·숨김·피킹 대상 분리 용이, draw call ≤5 |
| 랙 모드 페이드 | 선택 랙 인스턴스를 zero-scale로 숨기고 독립 Mesh로 그림 + 층 material opacity 0.15, `depthWrite=false` | per-instance alpha(`onBeforeCompile`) | 셰이더 패치 없이 동일 효과, 유지보수 쉬움 |
| 카메라 | `camera-controls`(yomotsu) — 궤도 + `setLookAt(..., true)` 전환 + 입력 시 자동 중단 | OrbitControls + 자작 tween | 전환/관성/중단 처리 버그 최다 지점을 검증된 라이브러리로 대체 (+1 dep, Principle 5 개정) |
| 층 라벨 | `CSS2DRenderer` (overlay `pointer-events:none`, 라벨 `auto`) | Sprite 텍스처 | 텍스트 선명, DOM 클릭 이벤트로 층 진입 |
| 빈 슬롯 | 층당 병합 `LineSegments` + `LineDashedMaterial` + `computeLineDistances()` | 슬롯별 Line | 오브젝트 수 ~1000→4 |

## Data Schema (canonical)
```json
{
  "version": 1,
  "name": "Sample DC",
  "floors": [
    { "id": "2F", "level": 2, "rows": 12, "cols": 20,
      "racks": [
        { "id": "R-2F-03-12", "row": 3, "col": 12, "total_u": 42,
          "servers": [
            { "id": "srv-0123", "hostname": "web-0123", "ip": "10.2.3.45",
              "unit": 10, "height_u": 2,
              "services": [ { "name": "payment-api", "team": "결제팀", "status": "ok" } ] } ] } ] } ]
}
```
- 중첩 구조(Round 6 "층→랙→서버→서비스"와 일치). 스펙 초안의 평면 `server.rack_id`는 **대체됨**; 중첩이므로 `rack_id` 불필요(있으면 무시).
- `row`/`col`/`unit`은 **1-based**. `unit` = 서버 하단 시작 U. `height_u` 생략 시 1. `total_u` 생략 시 42. `status ∈ {ok, warn, down}`.
- ID: `floor.id`, `rack.id`, `server.id`는 전역 유일 문자열(해시·내부키). 표시 형식: 랙 `R03-C12`, 위치 `2F-R03-C12-U10`(2U 이상은 `U10–11`).
- 데이터 경로: 기본 `public/data/datacenter.json`, `?data=<url>`로 오버라이드.

### Validation rules (`validate(json) → {fatal[], warnings[]}`)
| 구분 | 조건 | 동작 |
|------|------|------|
| Fatal | fetch 실패/404, JSON 파싱 실패, `floors` 비배열/비어있음, floor의 `id`/`rows`/`cols` 누락, ID 중복 | 씬 생성 안 함, `#error` 패널에 메시지 + 경로(`floors[1].racks[4].id`) |
| Fatal | rack의 `id` 누락, server의 `id`/`unit` 누락 또는 비정수 | Fatal과 동일 (경로 표시) |
| Warning | rack `row`/`col` 누락·비정수·그리드 밖, 같은 슬롯 중복 랙 | 해당 랙 제외, 경고 목록 |
| Warning | server `hostname` 누락 | `id`로 대체 표시, 경고 |
| Warning | service `name` 누락 → 해당 서비스 제외; `status` 허용값 외/누락 → `unknown`(회색 배지) | 경고 목록 |
| Warning | `unit < 1` 또는 `unit+height_u-1 > total_u`, 서버 U 범위 겹침 | 렌더하되 엘리베이션·3D에 빨간 테두리, 경고 목록 |
| Info | `height_u` 누락 → 1 | 카운트만 표시 |
경고는 상단 `⚠ N` 배지 → 클릭 시 목록.

## Domain definitions
- `usedU(rack)` = Σ height_u (범위 클램프 후, 겹침은 중복 미계산). `occupancy(rack) = usedU / total_u`.
- **색(고정 3단계, lerp 없음)**: `r < 0.60` 초록 `#3fb950`, `0.60 ≤ r < 0.85` 노랑 `#d29922`, `r ≥ 0.85` 빨강 `#f85149`. 0%(서버 없음)도 초록(AC5 그대로; 별도 회색 처리 없음).
- **층 평균** = Σ usedU / Σ total_u (층의 모든 랙, 빈 랙 포함). 층 라벨: `2F · 랙 240/300 · 평균 68%` (= 랙 수 / 슬롯 수 rows×cols).
- **랙 방향**: `layout.frontNormal(row)` — 홀수 row 정면 `+z`, 짝수 row 정면 `−z` (hot/cold aisle). 서버 박스·카메라·슬라이드아웃 모두 이 normal 기준.
- 레이아웃 상수: 랙 0.6 W × 1.2 D × 2.0 H, unit 높이 2.0/42, col pitch 0.7, row pitch 2.4, overview 층 간격 6.0 (층 위치는 모든 모드에서 고정 — 층 진입 시 스택을 접지 않고 카메라가 이동).

## View model & interaction
`mode = server ? 'server' : rack ? 'rack' : floor ? 'floor' : 'overview'`

| From | Event | To |
|------|-------|----|
| overview | 층 라벨(DOM) 클릭 또는 층 슬래브 raycast hit | floor(f) |
| overview / floor | 랙 클릭 | rack(f(r), r) |
| rack / server | 다른 랙 클릭 | rack(f, r') |
| rack / server | 서버 클릭(3D 또는 엘리베이션 행) | server(f, r, s) |
| any | ESC (포커스가 input이 아닐 때) / 빈공간 클릭 | up(): server→rack→floor→overview |
| any | 브레드크럼 항목 | 해당 레벨 |
| any | 검색 결과 선택 | server(f, r, s) |

- **클릭 판정**: pointerdown→pointerup 이동 < 5px **그리고** < 300ms 일 때만 클릭. 드래그(궤도 회전)는 절대 `up()`을 호출하지 않음.
- **"빈공간"**: overview — 아무 것도 안 맞음; floor — 맞은 것 없음 또는 슬래브만; rack/server — 서버·랙 아닌 것(슬래브 포함).
- **피킹 대상(모드별 명시 리스트; Raycaster는 `visible` 무시하므로)**: overview = 전 층 rack meshes + slabs; floor = 해당 층 rack mesh + slab; rack/server = **2-pass**: (1) 선택 랙 server meshes만 raycast → hit면 서버; (2) miss면 [선택 랙 독립 mesh(`kind:'selectedRack'`, no-op), 해당 층 rack mesh(페이드돼도 피킹 가능 → AC21), slab]을 **거리가 아닌 고정 우선순위**로 판정: selectedRack(no-op) > 다른 랙 > slab. 즉 광선이 선택 랙을 지나가면 앞의 페이드된 마주보는 열보다 선택 랙이 우선(AC11 '선택 랙 빈 U 클릭 = 변화 없음'). 다른 랙 전환은 화면상 선택 랙과 겹치지 않는 랙을 클릭할 때 발생. 마주보는 열이 카메라와 선택 랙 사이에 있어도 서버 클릭이 우선. hover 툴팁도 동일 2-pass. instanceId→rackId 맵은 층별.
- **URL / 상태 흐름**: `#floor=2F&rack=R-2F-03-12&server=srv-0123` (encodeURIComponent). 모든 네비게이션 액션(`openRack`, `up`, 브레드크럼, 검색, `__dc.navigate`)은 **`location.hash`만 쓴다**(→ history push, 브라우저 뒤로가기 = 이전 상태). store 상태는 오직 `hashchange` 핸들러와 초기 로드에서만 `apply(parse(hash))`로 변경. 없는 ID → 가장 가까운 유효 조상 계산 → `history.replaceState(조상 hash)` 후 조상 상태를 **직접 apply**(replaceState는 hashchange를 발생시키지 않으므로 루프 없음). 현재와 같은 hash 대입은 이벤트가 없으며 무시해도 무방(강제 재적용 경로 추가 금지).
- **툴팁**: overview/floor — 랙 hover: `R03-C12 · 2F · 31/42U (74%)`; rack/server — 서버 hover: `hostname · U10–11`.
- **층 요약 패널(AC7)**: floor 모드에서 좌상단 `#floor-summary`: 랙 수/슬롯 수, 평균 점유율, 색 구간별 랙 수.

### applyView(prev, next) — 유일한 3D 변경 지점 (`scene/view.js`)
각 모드는 **절대 목표 상태**를 정의한다(진입 경로 무관: 클릭, 검색, 해시 직링크, overview→rack 직행). `prev`는 전환 애니메이션 시작값에만 쓰임. floor/rack/server 모드에서 f 이외의 층은 항상 opacity 0 + `visible=false` + 라벨 숨김 + 피킹 제외.
- overview: 전 층 material opacity 1, visible; CSS2D 라벨 visible; 카메라 전경 preset.
- floor: 다른 층 opacity 1→0 (300ms) 후 `visible=false`; **해당 층 opacity 1 + `depthWrite=true`**, 선택 랙 인스턴스 복원·독립 메시/서버 메시 dispose; 해당 층 라벨 숨김; 카메라 층 위 45° preset.
- rack: 다른 층 숨김(위 규칙); **선택 서버 없음 — 모든 서버 emissive 해제, 오프셋 0**; 해당 층 material opacity 0.15 + `depthWrite=false`; 선택 랙 인스턴스 zero-scale(`instanceMatrix.needsUpdate`, `computeBoundingSphere()`) + 독립 rack Mesh(opacity 1) + 서버 Mesh(≤42, **서버별 개별 material**) 생성; 랙 종료·랙→랙 전환 시 이전 인스턴스 matrix 복원 + bounding sphere 재계산 + 이전 메시 dispose; 카메라 `controls.setLookAt(px,py,pz, tx,ty,tz, true)` (p = rackCenter + n·3.5 + up·0.3, t = rackCenter).
- server: 선택 서버 emissive + n 방향 +0.25 이동(200ms); 이전 선택 원복.
- 층 material은 생성 시부터 `transparent=true`(opacity 1, depthWrite 토글만) — 플래그 전환 시 `needsUpdate` 불필요. renderOrder 조정 불필요(불투명 선택 랙/서버는 투명 패스보다 먼저 그려짐).
- CSS2D: `labelRenderer.setSize` on resize; 라벨은 층 페이드와 함께 `element.style.opacity`로 페이드. 페이드 중 카메라 전환 동시 진행, 사용자 입력 시 camera-controls가 전환 중단.
- camera-controls: `CameraControls.install({ THREE })` 후 생성, 매 프레임 `controls.update(clock.getDelta())`. `isSettled()` = 진행 중인 `setLookAt` Promise 해소 && 페이드 없음 (`rest` 이벤트 사용 안 함).
- 브레드크럼: `데이터센터 > 2F > R03-C12 > {hostname}`. 모든 데이터 문자열은 `textContent`로만 삽입(`innerHTML` 금지 — `?data=` 외부 JSON 대비).

## Architecture
```
package.json            scripts: dev, build, preview, gen:sample, test, test:e2e
index.html              #app + #topbar(breadcrumb, search, ⚠badge) + #floor-summary + #panel(elevation/server) + #tooltip + #error
vite.config.js
playwright.config.js    webServer: `npm run build && vite preview --port 4173`; chromium args --use-angle=swiftshader --enable-unsafe-swiftshader
scripts/gen-sample.mjs  → public/data/datacenter.json (seeded mulberry32)
src/main.js             load → validate → (fatal? error panel : build scene) → store.apply(parse(location.hash))
src/debug.js            window.__dc 설치 — 조건: import.meta.env.DEV || URLSearchParams has 'debug'
src/data/schema.js      validate, normalize
src/data/load.js        fetch(?data= | default)
src/domain/occupancy.js usedU, occupancy, colorFor, floorStats
src/domain/slots.js     emptySlots
src/domain/search.js    buildIndex, search
src/domain/layout.js    gridToWorld, floorY, unitToY, frontNormal, rackLabel, locationLabel
src/state/store.js      state, mode(), navigate, apply, enterFloor, openRack, selectServer, up, subscribe
src/state/hash.js       parse, serialize
src/scene/setup.js      renderer, camera, camera-controls, lights, CSS2DRenderer, resize
src/scene/floors.js     slab, dashed empty slots, CSS2D label
src/scene/racks.js      per-floor InstancedMesh, colors, instance maps
src/scene/rackDetail.js selected rack mesh + server meshes, dispose
src/scene/picking.js    click threshold, targets per mode, hit → {kind,id}
src/scene/view.js       applyView(prev, next)
src/ui/{breadcrumb,elevation,serverPanel,search,tooltip,floorSummary,warnings,error}.js
tests/unit/*.test.js    vitest
tests/e2e/app.spec.js   playwright
README.md               실행법, 스키마 표, 실데이터 교체, 수동 FPS 측정 결과
```

`window.__dc` API: `state()`, `navigate(s)`(hash 쓰기 = 사용자 네비게이션과 동일 경로), `visibleRackIds()`, `rackScreenPos(id)`, `serverScreenPos(id)`, `rackInstanceColor(id)`, `emptySlotCount(floorId)`, `serverMeshes()`(id, worldPos, offsetAlongNormal), `camera()`(position, target), `floorOpacity(id)`, `isSettled()`.

## Implementation Steps
1. **Scaffold**: `npm create vite@latest dc-rack-3d -- --template vanilla` (in `~`), add `three camera-controls`, dev `vitest @playwright/test`, `npx playwright install chromium`; scripts.
2. **Schema + generator** (`schema.js`, `gen-sample.mjs`) + unit tests: sample valid; each fatal & warning rule triggers with expected path. *(AC 1–3)*
3. **Domain** (occupancy, slots, search, layout, hash) + unit tests with hand-computed values. *(AC 5, 6, 7, 14 normal, 15, 17, 20)*
4. **Store** (actions = `navigate(next)` → hash 쓰기; `apply(state)` = 상태 반영; `location`/`history` 주입 가능하게 하여 DOM 없이 테스트) + unit tests for the transition table, `up()` chain, ancestor fallback, `openRack` from overview sets floor. *(AC 11, 18, 19, 21)*
5. **Loader + error/warning UI** (before scene so failures are visible early). *(AC 2)*
6. **Scene base**: setup, floors, racks, overview stack, CSS2D labels, `view.js` overview/floor. *(AC 4, 5, 6, 17, 18)*
7. **Picking + tooltip + floor summary**. *(AC 7, 19)*
8. **Rack mode**: rackDetail, elevation panel, camera preset. *(AC 8, 9, 10, 21)*
9. **Server mode**: server panel, highlight/slide-out. *(AC 12–14)*
10. **Breadcrumb, ESC, hash/history**. *(AC 11, 20)*
11. **Search UI** (debounce 150ms, max 20, ↑↓, Enter = highlighted (default first), ESC = clear+blur). *(AC 15, 16)*
12. **E2E suite, debug hook, README + manual FPS**.

## Acceptance Criteria → Verification
Unit = Vitest; E2E = Playwright vs `vite preview` with `?debug=1`. "settled" = `__dc.isSettled()` true (no camera transition / fade active), wait ≤ 2s.

| AC | Verification |
|----|--------------|
| 1 | `npm run gen:sample` exit 0; `validate` → 0 fatal, 0 warnings except Info; floors = 4; racks 700–950; servers 2000–6000; height_u 없는 서버 3–8% |
| 2 | Unit: each fatal **and warning** rule in the table (incl. missing rack.id/row/col, server.id/hostname/unit, bad service status → `unknown`). E2E: `page.route` serve `{bad json` → `#error` visible containing "JSON"; serve schema-missing `rows` → `#error` contains `floors[0].rows`; serve overlap → no `#error`, `⚠` badge count ≥1 |
| 3 | Unit: normalize height_u=1. E2E: server w/o height_u → elevation block spans exactly 1 row |
| 4 | E2E ×3 entry paths (overview label click, breadcrumb from rack, search result): `visibleRackIds()` ⊆ floor; other floors `floorOpacity = 0` & hidden |
| 5 | Unit: `colorFor(0)`=green, `(0.599)`=green, `(0.6)`=yellow, `(0.849)`=yellow, `(0.85)`=red, `(1)`=red. E2E: `rackInstanceColor(id)` equals `colorFor(occupancy)` for 3 sampled racks |
| 6 | Unit: `emptySlots(floor).length = rows*cols − validRacks`. E2E: `emptySlotCount(f)` equals same |
| 7 | E2E: floor mode → `#floor-summary` shows racks/slots and avg% equal to `floorStats`; hover rack at `rackScreenPos` → `#tooltip` contains rack label and `%` |
| 8 | E2E: click rack → a camera sample ~150ms later differs from both start and end (smooth transition) → settled → `camera().target` = rack center (ε 0.01), `camera().position` = center + n·3.5 + up·0.3 (ε 0.1) |
| 9 | E2E: `serverMeshes()` count = rack.servers.length; each worldPos.y = `unitToY(unit, height_u)` (ε 0.001) |
| 10 | E2E: elevation has 42 rows labelled U42→U1; empty rows have `.empty`; empty rack → 42 `.empty` |
| 11 | E2E: from server: ESC → rack, ESC → floor, ESC → overview; ESC with focus in search input does not change state; breadcrumb "2F" from server → floor; orbit drag (pointer move 50px) in rack mode leaves state unchanged; **empty-space click** (screen point with no hit) in server → rack, rack → floor, floor → overview; click on selected rack's empty U area in rack mode leaves state unchanged; root breadcrumb "데이터센터" → overview |
| 12 | E2E: click server via 3D `serverScreenPos` (incl. a rack whose facing row is between camera and rack) **and** via elevation row → panel shows hostname, IP, `2F-R03-C12-U10`, height |
| 13 | E2E: services listed with name, team, badge class `status-ok/warn/down` matching data |
| 14 | E2E: selected → settled → `offsetAlongNormal` = 0.25 (ε 0.01); others 0; ESC (server→rack) → all offsets 0, no emissive |
| 15 | Unit: hostname & service-name substring, case-insensitive, ≤20. E2E: type partial hostname → results list visible |
| 16 | E2E: search by hostname → Enter → state = server(f,r,s), `visibleRackIds()` ⊆ f, camera per AC8; repeat with a service name; also from overview directly (no prior floor) → other floors hidden |
| 17 | E2E: initial load (no hash) → mode overview, 4 labels matching `2F · 랙 x/y · 평균 z%` with values from `floorStats` |
| 18 | E2E: click floor label → mode floor; during transition sampled `floorOpacity(other)` strictly between 0 and 1 at least once; settled → 0 & hidden |
| 19 | E2E: in overview click rack at `rackScreenPos` → mode rack, rack id matches |
| 20 | Unit: parse/serialize roundtrip incl. encoded IDs; invalid ids → ancestor. E2E: navigate to server, reload → same state; `page.goBack()` → previous state |
| 21 | E2E: in rack mode click a faded rack whose screen pos does not overlap the selected rack → rack id changes, server meshes rebuilt; then ESC → floor: `floorOpacity(f)` = 1 |

**Performance (spec 60fps target):** headless FPS is recorded only (SwiftShader meaningless). **Manual gate**: on a real-GPU browser, overview with full sample sustains ≥ 55fps (Chrome DevTools FPS meter, 10s orbit); result + machine noted in README. Below 55fps → fall back: `renderer.setPixelRatio(1)`, disable antialias, hide empty-slot lines in overview. (55fps gate is a deliberate relaxation of the spec's 60fps target for measurement noise.)

## Risks and Mitigations
| Risk | Mitigation |
|------|-----------|
| Overview frame rate | ≤5 InstancedMesh + 4 LineSegments + 4 CSS2D labels; no shadows by default; manual ≥55fps gate above |
| Picking hidden/faded floors | explicit per-mode target lists (not `visible`); floors hidden after fade are excluded |
| Transparent sorting artifacts in rack mode | faded material `depthWrite=false`; selected rack + servers are opaque so drawn before the transparent pass |
| Facing row occludes servers in rack mode | 2-pass raycast (servers first) |
| `?debug=1` exposed in production | read-only-ish hook on an internal static tool; accepted, documented in README |
| Instance matrix edits break raycast culling | after zero-scaling/restoring an instance: `instanceMatrix.needsUpdate=true`, `computeBoundingSphere()` |
| Headless WebGL in this machine/CI | `--use-angle=swiftshader --enable-unsafe-swiftshader`; all logic also covered by unit tests |
| Real data errors | fatal/warning split above; app renders valid parts |
| Stale hash after data swap | ancestor fallback with `replaceState` |

## Verification Steps
1. `npm test` — all unit green
2. `npm run gen:sample && npm run build` — exit 0
3. `npm run test:e2e` — AC table green
4. Manual: `npm run dev`, walk overview → floor → rack → server → ESC×3, search hostname & service, reload with hash, browser Back; FPS gate

## ADR
- **Decision**: Vanilla three.js (Option A) with derived view mode, single `applyView` reconciler, per-floor InstancedMesh, `camera-controls` for orbit + transitions, CSS2D floor labels, nested JSON schema.
- **Drivers**: smooth picking at thousands of objects; one consistent navigation model; easy real-data swap.
- **Alternatives considered**: B React/r3f/drei (valid; rejected primarily because user chose vanilla in Round 6); C 2D overview (invalidated by user Rounds 7–8); OrbitControls + custom tween (rejected: highest bug-risk area); per-instance alpha shader (rejected: unnecessary complexity vs pull-out mesh).
- **Why chosen**: matches user decisions, minimal deps, risks concentrated in two modules (`view.js`, camera-controls) that are testable via debug hook.
- **Consequences**: +1 runtime dep (`camera-controls`); hand-written DOM panels; browser Back moves through view history; spec's flat `rack_id` schema superseded by nested schema (floors gain `id`/`level`); hash uses floor id (`floor=2F`) instead of spec's `floor=2`; 0% racks render green; Back button steps through every view change incl. ESC; FPS gate 55 vs spec 60; `?debug=1` reachable in prod.
- **Follow-ups**: real-data adapter (CSV/xlsx → schema) once real format known; optional multi-DC support; revisit React if UI panels grow substantially.

## Changelog
- v2: resolved single vs per-floor InstancedMesh; replaced "group opacity" with per-floor material + pull-out mesh; added computeLineDistances/merged LineSegments; per-mode pick targets + click threshold + "empty" definition + ESC-in-input rule; adopted camera-controls; CSS2D pointer-events/visibility/resize; Playwright ANGLE flags + preview + debug-hook gating; canonical nested schema, IDs, display formats, 1-based indices; fatal vs warning rules; fixed color bands (no lerp, 0% green); average definition; rack front normal; tooltip per mode; floor summary panel; hard-numbered AC8/9/14 verifications; added e2e for all entry paths, elevation click, service search, fade, drag; manual FPS gate ≥55; removed "stack collapses" (floors stay put); browser Back via hash push; step order (error UI before scene); Option B steelman + honest rejection reason; sub-decision table; ADR.
- v3: 2-pass picking (servers first) + selectedRack no-op target; hash-only navigation with explicit replaceState fallback apply; applyView absolute per-mode targets (other floors hidden on any entry path); classified rack/server/service missing-field rules; empty-space click + root breadcrumb + occlusion + direct-from-overview e2e; camera-controls install/setLookAt/update/isSettled details; transparent=true from start, removed renderOrder; per-server materials; instance restore on rack exit; build before preview; CSS2D label fade; textContent only; FPS fallback levers; height_u tolerance; breadcrumb shows hostname; spec deviations listed in ADR.
- v3.1: pass-2 picking uses fixed priority (selectedRack > other racks > slab) instead of distance; floor mode restores own floor opacity/depthWrite and disposes rack detail; rack mode clears server highlight/offset; navigate/apply naming split, injectable location for store tests; AC14/AC21 extended.
