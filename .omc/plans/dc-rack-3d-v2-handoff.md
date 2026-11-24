# dc-rack-3d v2 — 작업 인계 (2026-11-20)

다음에 이 파일부터 읽고 이어서 작업하면 됩니다.

- 요구사항: `.omc/specs/deep-interview-dc-rack-3d-v2.md` (deep-interview, 모호도 17%)
- 승인된 구현 플랜: `.omc/plans/dc-rack-3d-v2.md` (ralplan 합의, AC 추적표 §5)
- 구현 메모: `.omc/progress.txt` 맨 아래 "v2 run" 섹션
- ralph PRD/상태: `.omc/state/sessions/d4cf9866-8342-4b9e-9c42-c2253abb0583/prd.json` (US-001~008 모두 passes + architectVerified)
- 상태: **구현 완료, 커밋 안 함** (작업 트리에만 있음, 기준 커밋 `57cd944`)

## 1. 요청 원문 요약

1. 첫 화면 = 지도에서 가산·영등포·파주 데이터센터 3곳 선택
2. 데이터센터 화면을 toffu Revit 모델처럼 → 인터뷰 결과: 설비 추가 없이 **배경·바닥·벽·조명·재질 개선**, 밝은/어두운 테마 + 전환
3. 데이터 형식 교체: `build_name`, `floorspace_name`, `company`, `rack_name`, `device_position` (`1U (39-39)`)
4. 장착 규칙: 경계 U만 2대 공유(`3U (29-31)` + `2U (31-32)`), 같은 범위·포함·2U 이상 겹침은 위반, 랙은 상면 여러 칸(쉼표 목록, 상한 없음), 랙끼리 같은 칸 불가

## 2. 확정된 결정 (인터뷰 + 합의)

| 항목 | 결정 |
|---|---|
| floorspace 코드 | `{층1}{구역A-Z}{줄2}{순번2}`, `3A0401,3A0402` = 2칸 랙 |
| 위반 데이터 | 거부하지 않음. 경고 목록(종류별) + 빨간 표시. 파싱 불가 위치는 그리지 않고 "위치 오류"에 나열 |
| 지도 | 앱 번들 GeoJSON(오프라인), SVG, 핀 3개, 미등록 build_name은 옆 목록 |
| 테마 | 밝음/어두움 둘 다 + 토글(localStorage `dc3d.theme`) |
| 필드 | hostname/ip/services 제거, 편집기는 새 필드로 유지 |
| 공유 U 표시 | 반 U 분할 (기본값 — §5-1 확인 필요) |
| 구조 | 레코드 → v3 트리 어댑터. 규칙은 `src/domain/mount.js`·`src/domain/floorspace.js` 두 곳에만 |

## 3. 구현된 것 (주요 파일)

- 데이터: `src/data/records.js`(레코드↔트리, `parsePosition`), `src/data/schema.js`(v3 검증/정규화/`toStored`), `src/data/load.js`(JSON 배열·트리·CSV, 행 번호 경고), `src/data/csv.js`, `src/data/edit.js`
- 규칙/도메인: `src/domain/mount.js`, `src/domain/floorspace.js`(코드 파싱·구역 배치·칸 충돌), `src/domain/slots.js`, `src/domain/sites.js`(핀 좌표), `src/domain/layout.js`(`rackFootprint`, `mountY`, 라벨)
- 상태: `src/state/store.js`(명시적 지도 모드 `#map`, 첫 DC 자동선택 제거), `src/state/hash.js`
- 화면: `src/ui/mapView.js` + `src/geo/seoul-gyeonggi.geo.json`, `src/ui/theme.js`, `src/scene/{setup,view,floors,racks,rackDetail}.js`, `src/ui/{elevation,serverPanel,search,tooltip,breadcrumb,floorSummary,warnings,editor}.js`, `src/style.css`, `index.html`
- 삭제: `src/ui/dcSelect.js`
- 샘플: `scripts/gen-sample.mjs` → `public/data/datacenter.json` (레코드 10,577개, 랙 1,501, 장비 10,501, 위반 0, 공유 U 160곳)
- 예시: `examples/upload-example.{csv,json}`, `examples/violations.csv`(기대 경고 8건), `examples/README.md`
- 문서: `README.md` 전면 갱신
- 테스트: 단위 14파일 107건, e2e 12파일 160건(dark/light 프로젝트), `tests/e2e/perf.baseline.json`(변경 전 중앙값 473ms, 게이트 ×1.5)
- 설정: `playwright.config.js` — dark/light 프로젝트, `E2E_PORT` 환경변수(다른 포트면 `node_modules/.e2e-dist-PORT`로 빌드)

## 4. 검증 상태

| 항목 | 결과 |
|---|---|
| `omc ralph verify` (build + unit + e2e 전체) | 1차: clean (exit 0) |
| architect(opus) 완료 리뷰 | APPROVED, 지적 5건 중 4건 수정 + 1건 문구 처리(§5-4) |
| 리뷰 후 수정 + 정리(deslop) 뒤 단위 테스트 | 107/107 통과, 빌드 통과 |
| 리뷰 후 수정 + deslop 뒤 `omc ralph verify` (build + unit + e2e 전체) | clean (exit 0) — 2026-11-20 |

## 5. 남은 일 (우선순위 순)

1. **[결정 필요] 공유 U 표시 방식**: 지금은 공유 U를 위아래 반씩. "1U = 3칸" 기준(예: 아래 장비 2칸/위 장비 1칸)으로 바꿀지 확인. 바꾸면 `src/domain/layout.js` `mountY`, `src/ui/elevation.js`(U당 그리드 행 수 2→3), `laneOf`의 반U 단위, 관련 테스트(`tests/unit/layout.test.js`, `elevation.test.js`, `tests/e2e/mount.spec.js` AC17)를 함께 수정.
2. **[입력 필요] 실제 IDC 주소 → 핀 좌표**: `src/domain/sites.js`의 lat/lng (현재 가산디지털단지역·영등포역·파주시청 근사). 라벨 겹침 오프셋 `tag`도 같이 확인.
3. **[작은 버그] 밝은 테마 그림자 줄무늬**: floor 모드에서 검은 랙 윗면에 얇은 사선 줄(shadow acne). `src/scene/setup.js`의 `sun.shadow.bias`/`normalBias` 조정 또는 랙 `receiveShadow=false`(`src/scene/racks.js`). 스크린샷으로 확인.
4. **[알려진 한계] floorspace를 해석할 수 없는 랙은 저장/내보내기에서 빠짐**: 지금은 경고 문구로만 알림. 보존하려면 schema `normalize`에서 제외하지 말고 `unplaced` 플래그로 두고 scene/slots/store에서만 거르기 (architect 지적 1).
5. **[알려진 한계] 레이아웃은 근사**: 구역을 알파벳 순 가로 배치, 구역 간 2칸 간격(`ZONE_GAP`). 실제 도면 좌표가 생기면 `layoutZones`/`placeRack`(`src/domain/floorspace.js`) 교체.
6. **[선택] 지도 경계 최신화**: 2013 KOSTAT 경계(southkorea-maps). 최신 SGIS 경계로 바꾸려면 `src/geo/seoul-gyeonggi.geo.json` 재생성(서울 11·경기 31·인천 23, 좌표 소수 4자리, ~40KB 유지).
7. **[선택] 실제 GPU 수동 FPS 확인**: README "성능" 절차대로 overview/floor ≥ 55fps 기록.
8. **[선택] 리팩터**: 내부 이름 `servers`→`devices` (플랜 ADR follow-up). 동작 변경 없음, diff 큼.
9. **[선택] docs/ 스크린샷 교체**: `docs/*.png`는 v1 화면(README에서 더 이상 참조 안 함). 새 스크린샷으로 바꾸거나 삭제.
10. **커밋/브랜치**: 아직 커밋 안 함. 마지막 검증은 통과한 상태. 이후 변경이 있으면 §6-1로 다시 확인.

## 6. 다시 시작할 때

1. (변경했다면) 재검증 (약 6분):
   ```bash
   cd ~/dc-rack-3d
   npm test
   npm run test:e2e          # 또는 E2E_PORT=4191 npm run test:e2e
   ```
   ralph 게이트로 보려면:
   ```bash
   node ~/.claude/plugins/cache/omc/oh-my-claudecode/5.7.19/dist/cli/index.js ralph verify --session d4cf9866-8342-4b9e-9c42-c2253abb0583
   ```
   (feedbackCommands는 `scripts/quiet.sh`로 감싸져 있어 실패할 때만 출력. 플러그인 의존성은 2026-11-20에 `npm install --omit=dev`로 설치함)
2. 화면 확인: `npm run build && npm run preview` → http://localhost:4173 (지도 → 가산IDC → 3F → 랙, ☀/☾ 토글, 데이터 ▾ → `examples/violations.csv` 불러오기)
3. §5에서 결정/입력이 필요한 1·2번을 먼저 정하고, 3번부터 처리.

## 7. 주의할 점 (작업 중 알게 된 것)

- `omc ralph verify`는 출력 줄을 전부 지문으로 쓰므로 feedbackCommands는 반드시 `sh scripts/quiet.sh ...`로 감쌀 것.
- e2e를 두 개 동시에 돌리면 4173 포트·`dist/` 충돌 → `E2E_PORT`로 분리.
- 지도 핀 클릭은 `.map-pin[data-dc=…] .pin-dot`을 눌러야 함(그룹 중심은 라벨 때문에 지도 위를 누름).
- 경고 목록 그룹 헤더도 `data-kind`를 가짐 → 항목만 셀 땐 `:not(.warn-group)`.
- 테마 전환은 현재 DC 씬을 그 자리에서 다시 만듦(revision에 테마 포함, 카메라 유지).

## 8. 2026-11-24 추가 작업: 랙 외관 (일러스트 스타일)

요청: "랙이 검은 박스라 이상하다", 참고 = 아이소메트릭 서버룸 일러스트(짙은 네이비 캐비닛, 밝은 윗면, 앞면에 장비 슬롯 + 초록/청록 LED).

- `src/scene/rackTextures.js` (신규): 문(타공 패턴·손잡이)·윗면(통풍구)·옆면을 512px 아틀라스 텍스처 하나로 굽고 `atlasBoxGeometry`로 UV 매핑 → 층당 draw call 1개. 장비가 있는 U는 **셰이더가** 랙별 42비트 마스크(`aMask`, U1–21 / U22–42)로 문 위에 베젤+LED 패턴을 그림(장비 지오메트리 없음).
- `src/scene/racks.js`: 위 재질 사용, 점유율 색은 랙 윗단 둘레 띠(`BAND_H` 0.09)로 두 테마 공통. 테마별 `rackBody`/`band` 설정 제거.
- `src/scene/rackDetail.js`: 뽑아낸 랙도 같은 팔레트, 장비 앞면에 LED 패널 텍스처(U 수만큼 반복). 장비 메시는 재질 배열 → 강조는 `userData.lit`.
- `src/scene/view.js`: 랙 재질 불투명도/깊이쓰기를 `entry.setOpacity/setDepthWrite`로.
- 테스트: `theme.spec` — 띠는 두 테마 모두, `panelCount`(= 점유 U 슬롯 수) 검사. 단위 107 / e2e 159 통과(1 skip).
- **성능 주의**: headless SwiftShader overview fps 약 30 (변경 전 v1 약 53). 원인 순: U별 패널 지오메트리(→ 셰이더 마스크로 해결), 6재질 박스(→ 아틀라스로 해결), 나머지는 텍스처·구역 타일·벽. 실제 GPU에서는 문제 없을 것으로 보지만 **README의 수동 FPS 확인(≥55fps)을 실제 GPU로 해 볼 것**. 부족하면 구역 벽 병합, 타일 텍스처 축소, 안개 끄기 순으로.
- 남은 아이디어(요청 시): 아이소메트릭(직교) 카메라 옵션, 방 단면처럼 뒤쪽 두 벽을 높게 + 케이블 트레이.
