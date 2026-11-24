# Deep Interview Spec: dc-rack-3d v2 — 지도 진입 · 새 데이터 형식 · 장착 규칙 · 테마

## Metadata
- Interview ID: dc3d-20261120-02
- Rounds: 8 (+ Round 0 topology)
- Final Ambiguity Score: 17%
- Type: brownfield (`/home/a451659/dc-rack-3d`, 기존 v1 spec: `.omc/SPEC.md`)
- Generated: 2026-11-20
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED — pending approval

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.88 | 0.35 | 0.308 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.80 | 0.25 | 0.200 |
| Context Clarity | 0.82 | 0.15 | 0.123 |
| **Total Clarity** | | | **0.831** |
| **Ambiguity** | | | **0.17** |

## Topology
| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 지도 첫 화면 (map-entry) | active | 앱 내장 서울·경기 행정경계 지도 위 가산/영등포/파주 핀 → 클릭 시 해당 DC 3D 진입 | AC 1–5 |
| 화면 분위기 개선 (visual-polish) | active | 설비(CRAC 등) 추가 없음. 배경·바닥·벽·조명·재질 개선, 밝은/어두운 테마 + 전환 스위치 | AC 6–9 |
| 데이터 형식 교체 (data-schema) | active | 장비 1행 단위 flat 레코드(build_name, floorspace_name, company, rack_name, device_position, device_name) | AC 10–16 |
| 장착/점유 규칙 (mount-rules) | active | U당 3홀, 경계 U만 2개 공유, 랙 다중 floorspace 점유, 랙 간 칸 중복 금지 | AC 17–23 |

## Goal
기존 dc-rack-3d 뷰어를 (1) 지도에서 가산·영등포·파주 IDC 중 하나를 골라 들어가는 진입 흐름으로 바꾸고, (2) 현장 데이터 형식(build_name / floorspace_name / company / rack_name / device_position)을 그대로 읽어 floorspace 코드로 랙을 배치하고 device_position으로 장비를 장착하며, (3) 경계 U 공유·다중 칸 랙 규칙을 검증·표시하고, (4) 밝은/어두운 두 테마로 덜 비어 보이는 화면을 제공한다.

## Constraints
- 오프라인 동작: 지도는 앱에 번들된 GeoJSON/TopoJSON(서울·경기 시군구 경계)로 렌더. 외부 타일/CDN 금지 (배포 대상이 폐쇄망일 가능성: `Dockerfile`, `k8s/`, `infra-amd64-v3.tar`).
- 스택 유지: Vite + three.js + camera-controls, vanilla JS. 지도 렌더는 SVG(또는 canvas) + 순수 JS 투영으로, 새 대형 의존성 지양.
- DC는 3곳 고정: `가산IDC`, `영등포IDC`, `파주IDC`. 핀 좌표는 앱 상수(가산디지털단지/영등포/파주 대략 위경도).
- floorspace_name 해석: `{층 1자리}{구역 알파벳}{줄 2자리}{순번 2자리}` 예) `3A0401` = 3층 A구역 4번째 줄 1번 칸.
- 랙 다중 칸: floorspace_name이 쉼표 목록(`3A0401,3A0402`)이면 그 칸들을 모두 차지. 칸 수 상한 없음(현재 최대 5, 늘어날 수 있음). 같은 층·구역·줄의 연속 칸이어야 하며 아니면 경고.
- device_position 형식: `{h}U ({start}-{end})`, `h == end - start + 1`. 불일치/파싱 실패는 경고.
- 장착 규칙: 1U = 세로 3홀. 두 장비가 같은 U를 공유하는 건 **경계뿐**(아래 장비의 end == 위 장비의 start). 동일 범위, 포함 관계, 2U 이상 겹침은 위반. 한 U에 최대 2대.
- 위반 데이터는 거부하지 않는다: 경고 패널(`src/ui/warnings.js`)에 모으고 해당 장비/랙을 빨간 표시(테두리/색)로 렌더, 화면은 계속 동작.
- 알 수 없는 build_name(예: `의왕IDC`)은 경고 + 지도 옆 목록에만 표시(핀 없음).
- 랙 total_u: 데이터에 없으므로 기본 42U (가정 — 필요 시 필드 추가).
- 편집기(`src/ui/editor.js`)는 유지하되 새 필드 기준으로 재작성.

## Non-Goals
- CRAC/냉방기, 케이블 트레이, 컨테인먼트 등 설비 모델링.
- hostname / ip / services / team / status 데이터와 그 UI (제거).
- 온라인 지도 타일, 3D 지형 지도.
- v1 데이터 형식(`version: 2` datacenters 중첩 JSON) 하위 호환 — 필요 시 별도 결정.

## Acceptance Criteria
### 지도 첫 화면
- [ ] 1. 앱 첫 진입(해시 없음) 시 3D가 아닌 지도 화면이 뜬다.
- [ ] 2. 네트워크 차단 상태(DevTools offline)에서도 지도 경계와 핀 3개가 그려진다.
- [ ] 3. 핀 hover 시 DC 이름 · 랙 수 · 장비 수 툴팁.
- [ ] 4. 핀 클릭 → 해당 DC 3D overview로 전환, URL 해시에 dc 기록. 브레드크럼 루트/뒤로가기로 지도로 복귀.
- [ ] 5. 알 수 없는 build_name은 지도 옆 목록에 "미등록 DC"로 나오고 클릭하면 진입 가능, 경고 1건.
### 화면 분위기
- [ ] 6. 테마 스위치(밝음/어두움)가 있고 선택이 localStorage에 유지된다.
- [ ] 7. 밝은 테마: 밝은 바닥 타일, 구역 경계 낮은 벽, 그림자, 금속/검은 랙 본체, 점유율 색은 랙 상단 띠로 표시, UI 패널 밝은 톤.
- [ ] 8. 어두운 테마: 단색 #0d1117 대신 그라데이션/안개 배경, 바닥 타일 그리드, 벽, 조명 보강.
- [ ] 9. 두 테마 모두 기존 e2e(랙/서버 드릴다운)가 통과한다.
### 데이터 형식
- [ ] 10. 업로드/기본 데이터는 장비 1행 레코드 배열(JSON) 또는 CSV, 컬럼: build_name, floorspace_name, company, rack_name, device_position, device_name.
- [ ] 11. 로더가 build → 층 → 구역 → 줄 → 랙 → 장비 트리로 그룹핑한다 (rack_name은 build 내 유일 키).
- [ ] 12. `3A0401` → {floor:3, zone:'A', row:4, seq:1} 단위 테스트.
- [ ] 13. `3A0401,3A0402`인 랙은 2칸 폭으로 그려지고 피킹 영역도 2칸.
- [ ] 14. 같은 rack_name 행들의 floorspace_name이 서로 다르면 경고.
- [ ] 15. 장비 상세 패널: device_name, company, rack_name, floorspace_name, device_position, build_name.
- [ ] 16. 검색: rack_name / company / device_name 부분 일치, 다른 DC 결과 포함.
### 장착 규칙
- [ ] 17. `3U (29-31)` + `2U (31-32)` 같은 랙 → 위반 없음, 엘리베이션·3D에서 U31을 두 장비가 반씩(홀 단위) 나눠 표시.
- [ ] 18. `1U (29-29)` × 2 → 위반 경고, 두 장비 빨간 표시.
- [ ] 19. `4U (10-13)` + `1U (11-11)`(포함) / `3U (10-12)` + `3U (11-13)`(2U 겹침) → 위반.
- [ ] 20. `2U (5-7)`(높이 불일치)·`abc` → 파싱 경고, 장비는 렌더 제외 또는 범위 기준 렌더(정책 고정 후 테스트).
- [ ] 21. 두 랙이 같은 floorspace 칸 사용 → 위반 경고, 두 랙 빨간 표시.
- [ ] 22. 점유율(U)은 distinct U 기준, 기존 색 3단계(<60/60–85/≥85) 유지.
- [ ] 23. 샘플 생성기(`npm run gen:sample`)가 3 DC 데이터를 결정적으로 만들고, 경계 공유·다중 칸 랙 사례를 포함하며 위반은 0건(별도 `examples/`에 위반 예시 파일).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "최대 5개 점유" = 장비/회사 기준? | Round 1 | 랙이 floorspace 칸을 N개 점유, 상한 없음 |
| floorspace_name은 단순 이름? | Round 2 | 층+구역+줄+순번 인코딩 |
| U 공유는 U당 2대면 모두 허용? | Round 3 | 경계 U만 공유 허용 |
| 지도는 온라인 타일 | Round 4 (폐쇄망 근거) | 번들 지도 파일 |
| Revit 스타일 = 설비 추가 | Round 0 | 설비 불필요, 배경·재질 문제 |
| 어두운 테마 버리고 밝게 | Round 5 (contrarian) | 두 테마 + 스위치 |
| 기존 필드 유지 | Round 7 (simplifier) | 새 필드만, 편집기는 유지 |
| 다중 칸 표현 방식 | Round 6 | floorspace_name 쉼표 목록 |
| 위반 데이터 처리 | Round 8 | 거부 없이 경고 + 빨간 표시 |

## Technical Context (brownfield)
- `src/data/schema.js` (218줄): v2 중첩 JSON 검증/정규화 → 새 flat 레코드 파서+그룹핑+규칙 검증으로 교체. Issue `{path,message}` 구조와 warnings 흐름 재사용.
- `src/data/csv.js`, `src/data/edit.js`, `src/ui/editor.js`, `src/ui/dataMenu.js`: 업로드/편집 → 새 컬럼으로 재작성.
- `src/domain/layout.js`: `gridToWorld(row,col)`, `RACK.w=0.6`, `COL_PITCH=0.7`, `unitToY(unit,height_u)` → 구역 오프셋 + 줄/순번 좌표, 다중 칸 폭(`span × COL_PITCH`), 홀 단위 y(`UNIT_H/3`) 추가.
- `src/domain/slots.js`(빈 슬롯), `src/domain/occupancy.js`(`usedU` distinct U — 그대로 사용 가능), `src/domain/search.js`(필드 교체).
- `src/scene/setup.js`: `setClearColor(0x0d1117)`, Hemisphere+Directional 조명, 그림자 없음 → 테마 객체로 배경/안개/조명/그림자 주입.
- `src/scene/floors.js`, `racks.js`, `rackDetail.js`, `src/ui/elevation.js`: 층 슬래브/랙/엘리베이션 → 구역 벽, 바닥 타일, 경계 U 반쪽 표시, 위반 빨간 표시.
- `src/state/store.js`, `hash.js`: 뷰 상태 `{dc,floor,rack,server}` → 지도 상태(`dc` 없음 = map) 추가.
- `src/ui/dcSelect.js`: 상단 DC 선택 → 지도 화면으로 대체(또는 보조로 유지).
- 테스트: Vitest(`tests/`), Playwright e2e(`tests/e2e/datacenter.spec.js`) 갱신 필요.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Build (IDC) | core | build_name, 핀 좌표 | has many Floors |
| Floor | core | level (floorspace 1번째 자리) | belongs to Build, has many Zones |
| Zone | supporting | 알파벳 (A, B…) | has many Rows |
| FloorSpace | core | code `3A0401`, floor, zone, row, seq | 랙 1개에 최대 1개 소속 |
| Rack | core | rack_name, floorspaces[], total_u(42) | occupies 1..N FloorSpaces, has many Devices |
| Device | core | device_name, company, device_position(h,start,end) | mounted in Rack |
| Company | supporting | company | owns Devices |
| Violation | supporting | kind, target, message | flags Device/Rack |
| Theme | supporting | light/dark | applies to Scene/UI |
| MapView | supporting | 지도 경계, 핀 | selects Build |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 6 | 6 | - | - | - |
| 2 | 8 | 2 (Floor, Zone) | 0 | 6 | 75% |
| 3 | 8 | 0 | 0 | 8 | 100% |
| 4 | 9 | 1 (MapView) | 0 | 8 | 89% |
| 5 | 10 | 1 (Theme) | 0 | 9 | 90% |
| 6 | 10 | 0 | 0 | 10 | 100% |
| 7 | 10 | 0 | 0 | 10 | 100% |
| 8 | 10 | 0 (Violation 명시화) | 0 | 10 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (8 rounds + Round 0)</summary>

### Round 0 — Topology
**A:** 4개 컴포넌트 맞음. 단 2번은 냉방기 등 불필요, 지금 구성으로 충분한데 배경이 너무 까맣고 없어 보이는 게 문제.

### Round 1 — 최대 5개 점유
**Q:** 랙이 floorspace 칸을 1~5개 차지하고 랙끼리 칸 공유 불가?
**A:** 맞고, 5개는 현재 최대일 뿐 늘어날 수 있음. **Ambiguity:** 57%

### Round 2 — floorspace 코드
**A:** 층+구역+열+순번. **Ambiguity:** 51%

### Round 3 — 겹침 규칙
**A:** 경계 U만 공유 가능. **Ambiguity:** 48%

### Round 4 — 지도
**A:** 앱 번들 지도 파일. **Ambiguity:** 38%

### Round 5 — 테마 (contrarian)
**A:** 두 테마 모두 + 전환 스위치. **Ambiguity:** 35%

### Round 6 — 다중 칸 표현
**A:** rack_name 1개에 floorspace_name이 `3A0401,3A0402`처럼 쉼표 목록이면 2칸 점유. **Ambiguity:** 30%

### Round 7 — 단순화 (simplifier)
**A:** 새 필드만, 편집기는 유지. **Ambiguity:** 25%

### Round 8 — 검증 동작
**A:** 경고 + 빨간 표시, 거부 안 함. **Ambiguity:** 17%
</details>

## Open (낮은 위험, 실행 중 기본값으로 처리)
- 랙 total_u 기본 42 (데이터에 필드 없음).
- device_position 파싱 실패 장비는 렌더 제외 + 경고 (AC 20 기본값).
- 구역 간 배치: 구역 A, B…를 층 바닥에 가로로 나란히, 구역마다 낮은 벽.
- 랙 정면 방향: 기존 규칙(홀수 줄 +z, 짝수 줄 -z) 유지.
</content>
</invoke>
