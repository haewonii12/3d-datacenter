# dc-rack-3d — 데이터센터 랙/장비 3D 뷰어

정적 웹앱(Vite + three.js, vanilla JS)입니다. 현장 데이터(장비 1대 = 레코드 1개: `build_name`, `floorspace_name`, `company`, `rack_name`, `device_position`, `device_name`)를 읽어 데이터센터를 3D로 보여 줍니다. 인터넷 없이 동작합니다(지도 경계도 앱에 들어 있음).

- **지도 (첫 화면)**: 서울·경기 지도에 **가산IDC · 영등포IDC · 파주IDC** 핀. 핀에 마우스를 올리면 층·랙·장비 수, 클릭하면 그 데이터센터로 들어갑니다. 지도에 없는 데이터센터(예: `의왕IDC`)는 오른쪽 목록의 **미등록 DC**에 나옵니다.
- **overview**: 전 층을 수직으로 분해한 스택
- **floor**: 한 층의 구역(A·B·C…)별 바닥 타일·낮은 벽과 랙 배치. 빈 상면은 바닥에 점선
- **rack**: 랙을 줌인하고 U42→U1 배치도(엘리베이션)를 표시
- **server**: 장비 상세(회사·랙·상면·장착 위치·규칙 위반 사유)

랙 색은 U 점유율 3단계입니다: < 60% 초록, 60–85% 노랑, ≥ 85% 빨강. **밝은 테마 / 어두운 테마**를 상단 버튼으로 바꿀 수 있고(브라우저에 기억됨), 밝은 테마에서는 랙 본체가 검은색이고 점유율 색은 랙 위 띠로 표시됩니다.
뷰 상태 `{dc, floor, rack, server}`는 URL 해시에 기록됩니다(지도는 `#map`). 링크로 공유할 수 있고, 브라우저 뒤로가기로 이전 화면에 돌아갑니다.

## 실행 방법

```bash
npm install
npm run dev            # 개발 서버 (http://localhost:5173)
npm run build          # dist/ 정적 빌드
npm run preview        # 빌드 결과 미리보기 (http://localhost:4173)
npm run gen:sample     # public/data/datacenter.json 샘플 재생성 (seed 고정, 결정적)
npm test               # 단위 테스트 (Vitest)
npx playwright install chromium   # e2e 최초 1회
npm run test:e2e       # e2e (Playwright: build + vite preview, headless SwiftShader WebGL, 어두운/밝은 테마 각각)
```

샘플 데이터는 데이터센터 3곳, 랙 1,501개, 장비 10,501대(레코드 10,577개)입니다. 랙의 약 10%는 상면 2–5칸을 차지하고, 경계 U를 공유하는 장비 쌍이 160곳 있으며, 규칙 위반은 없습니다.

| build_name | 층 | 구역 × (줄 × 칸) | 랙 | 장비 |
|---|---|---|---|---|
| `가산IDC` | 4 | A·B·C × (6 × 14) | 613 | 4,174 |
| `영등포IDC` | 3 | A·B × (7 × 16) | 400 | 2,832 |
| `파주IDC` | 2 | A·B·C × (8 × 18) | 488 | 3,495 |

## 화면 / 조작

| 동작 | 결과 |
|---|---|
| 지도 핀 / 오른쪽 목록 클릭 | 그 데이터센터의 overview |
| overview에서 층 라벨(`3F · 랙 x/y · 평균 z%`) 또는 층 바닥 클릭 | floor 모드. 다른 층은 페이드아웃 후 숨김 |
| 랙 클릭 (overview/floor) | rack 모드. 카메라가 랙 정면으로 이동하고 우측에 배치도(U42→U1) 표시 |
| 장비 클릭 (3D 또는 배치도) | server 모드. 장비가 정면으로 슬라이드되고 상세 패널이 열림 |
| **ESC** / 빈 공간 클릭 | 한 단계 위로 (server → rack → floor → overview → **지도**). 드래그(궤도 회전)는 클릭으로 치지 않음 |
| 브레드크럼 `지도 > 가산IDC > 3F > RI20261120 > 장비명` | 해당 단계로 이동 |
| 검색창 (장비명 / 랙 이름 / 회사, 대소문자 무시, 부분 일치) | 모든 데이터센터를 검색. 다른 데이터센터의 결과에는 이름이 붙음. 선택하면 그 장비(랙 검색이면 랙)로 이동 |
| ⚠ 배지 | 경고 목록(종류별 묶음). 항목을 누르면 해당 랙/장비로 이동 |
| ☀/☾ 버튼 | 밝은/어두운 테마 전환 |
| hover | 랙: `RI20261120 · 3A0401–02 · 31/42U (74%)`, 장비: `장비명 · 회사 · U29–31` |

## 데이터 형식

기본 데이터 `public/data/datacenter.json`과 업로드 파일은 **레코드 배열**(JSON) 또는 같은 열의 **CSV**입니다. 장비 1대가 레코드 1개입니다.

```json
[
  { "build_name": "가산IDC", "floorspace_name": "3A0401", "company": "해원회사", "rack_name": "RI20261120", "device_position": "3U (29-31)", "device_name": "db-gs-002" },
  { "build_name": "가산IDC", "floorspace_name": "3A0401", "company": "해원회사", "rack_name": "RI20261120", "device_position": "2U (31-32)", "device_name": "cache-gs-003" },
  { "build_name": "가산IDC", "floorspace_name": "3A0402,3A0403", "company": "한빛솔루션", "rack_name": "RI20261121", "device_position": "4U (1-4)", "device_name": "nas-gs-004" },
  { "build_name": "가산IDC", "floorspace_name": "3A0404", "company": "", "rack_name": "RI20261122", "device_position": "", "device_name": "" }
]
```

| 필드 | 의미 |
|---|---|
| `build_name` | 데이터센터. `가산IDC`·`영등포IDC`·`파주IDC`는 지도 핀이 있고(`src/domain/sites.js`), 그 밖의 이름은 "미등록 DC" |
| `floorspace_name` | 상면 칸 `{층 1자리}{구역 A–Z}{줄 2자리}{순번 2자리}`. `3A0401` = 3층 A구역 4번째 줄 1번 칸. 랙이 여러 칸을 차지하면 쉼표 목록(`3A0402,3A0403`, CSV에서는 따옴표로 감쌈). 칸 수 상한 없음 |
| `company` | 장비 소유 회사 (비어도 됨) |
| `rack_name` | 랙 이름. 데이터센터 안에서 랙을 구분하는 키 |
| `device_position` | `{높이}U ({시작}-{끝})`, 예 `1U (39-39)`, `3U (29-31)`. 높이 = 끝 − 시작 + 1 |
| `device_name` | 장비 이름 |
| `total_u` (선택) | 랙 높이. 없으면 42 |

`device_position`과 `device_name`이 비어 있는 레코드는 **빈 랙**입니다. 같은 `rack_name`의 레코드는 같은 `floorspace_name`을 가져야 합니다(다르면 경고, 첫 값 사용).

### 장착 규칙

- 1U는 나사 구멍 3개 높이이고, 장비 두 대가 **경계 U 하나**를 함께 쓸 수 있습니다: 아래 장비의 끝 U = 위 장비의 시작 U (예: `3U (29-31)` + `2U (31-32)` → U31 공유). 화면에서는 그 U를 위아래 반으로 나눠 그립니다.
- 그 밖의 겹침은 모두 **위반**입니다: 같은 범위(`1U (29-29)` × 2), 포함(`3U (29-31)` + `1U (31-31)`), 2U 이상 겹침(`3U (10-12)` + `3U (11-13)`). 따라서 1U 장비는 U를 공유할 수 없습니다. 한 U에 장비는 최대 2대입니다.
- 랙은 상면 칸을 여러 개 차지할 수 있지만, **두 랙이 같은 칸을 쓸 수는 없습니다**. 여러 칸은 같은 줄의 연속된 칸이어야 합니다.

규칙 판정은 `src/domain/mount.js`(장비)와 `src/domain/floorspace.js`(상면)에만 있고, 데이터 검증·편집·화면이 모두 이 두 모듈을 씁니다.

### 검증 / 경고

위반 데이터도 **거부하지 않습니다**. 경고 목록(⚠ 배지, 종류별)에 모으고, 해당 랙은 3D에서 빨간 테두리, 장비는 빨간색으로 그립니다. 겹친 장비는 배치도와 3D에서 나란히(레인) 그려져 각각 클릭할 수 있습니다. 경고 메시지는 CSV면 엑셀 행 번호(`file.csv 5행`), JSON 배열이면 `#5`를 가리킵니다.

| 경고 종류 | 처리 |
|---|---|
| 장비 겹침 / 한 U에 3대 이상 | 경고 + 빨간 표시 |
| 상면 중복 / 연속되지 않은 상면 | 경고 + 두 랙 모두 빨간 테두리 (둘 다 그림) |
| 장착 위치 오류 (`abc`, `2U (5-7)`처럼 형식·높이가 틀림, 랙 범위 밖) | 경고. 장비는 그리지 않고 배치도 아래 "위치 오류"에 나열 |
| floorspace 오류 (해석 불가) | 경고. 위치를 알 수 없어 그 랙은 그리지 않음 |
| 미등록 데이터센터 | 경고. 지도 옆 "미등록 DC" 목록에서 들어갈 수 있음 |

치명 오류(JSON 문법, 필수 열 누락, 유효한 레코드 없음)만 불러오기를 막습니다.

### 화면 배치

층 안에서 구역(A, B, C…)을 알파벳 순서로 가로로 나란히 놓고(구역 사이 2칸 간격), 구역마다 줄(row) × 칸(순번)의 격자를 만듭니다. 구역의 크기는 그 구역에 나온 가장 큰 줄/순번입니다. 홀수 줄은 +z, 짝수 줄은 −z를 바라봅니다(통로를 사이에 두고 마주봄). 실제 도면 좌표가 아니라 상면 코드에서 만든 근사 배치입니다.

## 데이터 업로드 / 편집

정적 앱이라 서버가 없습니다. 업로드한 파일과 화면에서 고친 내용은 **이 브라우저의 IndexedDB**에 저장되고, 다음 방문 때도 그대로 열립니다. 팀 전체에 반영하려면 내보낸 파일로 `public/data/datacenter.json`을 바꾸세요.

예시 파일: [`examples/upload-example.csv`](examples/upload-example.csv), [`examples/upload-example.json`](examples/upload-example.json), 규칙 위반 예시 [`examples/violations.csv`](examples/violations.csv), 설명 [`examples/README.md`](examples/README.md). CSV는 UTF-8과 한글 엑셀 기본 CSV(CP949)를 모두 읽습니다.

**데이터 ▾ 메뉴**
- **파일 불러오기…**: `.json`/`.csv`를 고르거나 화면에 끌어다 놓습니다. 성공하면 모든 데이터센터가 그 파일로 바뀌고 지도로 돌아갑니다. 치명 오류면 이유를 보여주고 기존 데이터를 유지합니다.
- **JSON 내보내기**: 저장 형식(트리)으로 받습니다. 다시 불러올 수 있습니다.
- **CSV 내보내기 (Excel)**: 위 레코드 형식으로 받습니다(UTF-8 BOM). 빈 랙은 장비 없는 행 1개, 장비·랙이 없는 빈 층/데이터센터는 레코드로 표현할 수 없어 빠집니다.
- **원본으로 되돌리기**: 브라우저 저장 데이터를 지우고 기본 파일(또는 `?data=`)을 다시 읽습니다.

**편집 버튼**을 누르면 오른쪽 패널에 현재 단계의 편집 양식이 나옵니다.

| 단계 | 할 수 있는 것 |
|---|---|
| 전체 뷰 | 데이터센터 이름 변경, 층 추가(1–9층), 데이터센터 추가(build_name + 첫 층), 데이터센터 삭제 |
| 층 | 랙 추가: `floorspace`(여러 칸은 쉼표)와 `rack_name`. 바닥의 빈 상면(점선)을 클릭하면 코드가 채워짐. 층 삭제 |
| 랙 | 장비 추가: 장비 이름·회사·장착 위치(`3U (29-31)`). 배치도의 빈 U를 클릭하면 `1U (u-u)`가 채워짐. 랙 삭제 |
| 장비 | 장비 이름·회사·장착 위치 수정, 장비 삭제 |

편집은 **위치를 정할 수 없는 입력만 거절**합니다(장착 위치 형식·높이·랙 범위, floorspace 형식·층 번호·연속성, 이미 랙이 있는 칸, 이름 중복). 장비 겹침은 저장한 뒤 경고와 빨간 표시로 알려 줍니다(불러온 데이터와 같은 처리).

## 컨테이너 / Kubernetes 배포

정적 빌드를 비루트 nginx(`nginxinc/nginx-unprivileged`, uid 101, 포트 **8080**)로 서빙하는 이미지입니다. 업로드·편집은 브라우저 안에서만 일어나므로 서버 쪽 저장소는 필요 없습니다.

```bash
docker build -t registry.example.com/dc-rack-3d:0.1.0 .
docker run --rm -p 8080:8080 registry.example.com/dc-rack-3d:0.1.0   # http://localhost:8080
docker push registry.example.com/dc-rack-3d:0.1.0

# 클러스터 노드가 amd64이고 빌드 장비가 arm64(예: 이 장비)일 때
docker build --platform linux/amd64 -t registry.example.com/dc-rack-3d:0.1.0 .
# amd64 + arm64 멀티 아키텍처 한 태그로
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/dc-rack-3d:0.1.0 --push .

# k8s/dc-rack-3d.yaml 의 image / host / ingressClassName 을 바꾼 뒤
kubectl apply -n <namespace> -f k8s/dc-rack-3d.yaml
```

| 파일 | 내용 |
|---|---|
| `Dockerfile` | `node:22-alpine`에서 `npm ci` + `vite build` → nginx 이미지로 `dist/`만 복사 (최종 약 54 MB) |
| `docker/nginx.conf` | `/healthz`(프로브), gzip, `/assets/` 1년 캐시(해시 파일명), `index.html`·`/data/`는 `no-cache` |
| `k8s/dc-rack-3d.yaml` | Deployment(replica 2, 프로브, 리소스, 비루트·읽기 전용 루트 FS·capability 전부 제거, `/tmp` emptyDir) + Service(ClusterIP 80→8080) + Ingress |

- **기본 데이터 교체**: 이미지에는 샘플 `datacenter.json`(현장 레코드 배열)이 들어 있습니다. 실데이터를 기본으로 보여주려면 빌드 전에 `public/data/datacenter.json`을 바꾸거나, Pod에서 `/usr/share/nginx/html/data`에 볼륨을 마운트하세요(매니페스트에 주석으로 예시). ConfigMap은 1 MiB 제한이 있어 큰 파일은 PVC 등을 쓰세요.
- 브라우저에서 수정한 내용은 **각 사용자 브라우저(IndexedDB)** 에만 저장됩니다. 팀 전체가 같은 데이터를 보려면 내보낸 JSON/CSV로 위 기본 데이터를 교체해 다시 배포하세요.
- TLS는 Ingress의 `tls:` 주석을 풀고 Secret 이름을 지정하면 됩니다.

## 디버그 훅

URL에 `?debug=1`을 붙이거나 dev 서버에서 실행하면 `window.__dc`가 노출됩니다. e2e 테스트는 이 훅으로 결정적 검증을 합니다.

| API | 설명 |
|---|---|
| `state()`, `mode()` | 현재 `{dc, floor, rack, server}` / `map·overview·floor·rack·server` |
| `currentDc()`, `dcIds()`, `builtDc()`, `builtFloorIds()` | 현재·전체 데이터센터, 씬에 만들어진 데이터센터와 층 |
| `navigate(s)` | 해시 쓰기. `s.dc`가 없으면 현재 데이터센터, `{dc: null}`이면 지도 |
| `isSettled()` | 지도: SVG 렌더 완료 / 3D: 카메라·페이드·슬라이드 종료 |
| `theme()`, `shadows()`, `paused()`, `background()`, `fog()` | 테마와 렌더 상태 (지도에서는 3D 렌더 일시정지) |
| `zoneIds(floorId)`, `wallCount(floorId)`, `bandCount(floorId)` | 구역, 구역 벽, 점유율 띠(밝은 테마) 수 |
| `violationRackIds()`, `rackFootprint(id)` | 빨간 테두리 랙 / 랙 중심·폭(여러 칸 랙) |
| `visibleRackIds()`, `culledRackIds()`, `selectedRackId()`, `rackInstanceColor(id)`, `emptySlotCount(floorId)` | 랙 가시성·색, 빈 상면 수 |
| `camera()`, `rackCenter(id)`, `frontNormal(id)`, `rackScreenPos(id)`, `floorLabelScreenPos(id)`, `toScreen(p)` | 좌표 |
| `serverMeshes()`, `serverScreenPos(id)`, `unitScreenPos(u)`, `serverEmissive(id)`, `pickAt(x, y)` | 선택 랙 장비와 피킹 |
| `revision()`, `data()`, `gpuMemory()` | 데이터 교체 횟수, 현재 데이터(저장 형식), GPU 메모리 |

> 이 훅은 **프로덕션 빌드에서도 `?debug=1`로 접근할 수 있습니다.** 내부용 정적 도구이고 노출되는 것이 읽기 위주 API와 일반 네비게이션뿐이므로 이를 허용했습니다.

## 성능

층별 `InstancedMesh`(밝은 테마는 점유율 띠 1개 추가), 층당 병합 점선 1개, 장비 지오메트리는 선택 랙만 생성합니다. 그림자는 한 층만 보이는 floor/rack/server 모드에서만 켜고 overview에서는 끕니다. 지도 화면에서는 3D 렌더를 멈춥니다.

**자동 게이트** (`tests/e2e/perf.spec.js`): 첫 데이터센터 overview가 준비될 때까지의 시간(3회 중앙값)이 변경 전 기준(`tests/e2e/perf.baseline.json`, 커밋 57cd944에서 같은 headless SwiftShader 환경으로 측정한 중앙값 473 ms)의 1.5배 이하여야 합니다. headless 수치는 실제 GPU 성능을 대표하지 않으므로 같은 환경끼리 비교합니다.

**수동 FPS 확인 (실제 GPU)**: `npm run build && npm run preview` → 데스크톱 Chrome에서 DevTools Rendering → Frame Rendering Stats를 켜고 overview·floor에서 10초간 궤도 회전, 평균 ≥ 55fps면 통과. 미달이면 `renderer.setPixelRatio(1)`, 그림자 맵 크기 축소(`src/scene/setup.js`) 순서로 조정합니다.

## 지도 데이터

`src/geo/seoul-gyeonggi.geo.json`은 [southkorea/southkorea-maps](https://github.com/southkorea/southkorea-maps)의 `kostat/2013/json/skorea_municipalities_geo_simple.json`(통계청 KOSTAT 2013 시군구 경계)에서 서울(11)·경기(31)·인천(23) 시군구만 뽑고 좌표를 소수 4자리로 줄인 파일입니다(약 40 KB). 빌드 시 JS 번들에 들어가므로 실행 중 네트워크 요청이 없습니다. 2013년 경계라 이후 행정구역 변경은 반영되어 있지 않습니다.

핀 좌표(`src/domain/sites.js`)는 근사값입니다(가산디지털단지역 · 영등포역 · 파주시청 부근, ±0.02°). 실제 IDC 주소가 정해지면 이 파일의 위경도만 바꾸면 됩니다.

## 테스트

- 단위(Vitest, `tests/unit/`): 상면 코드·장착 규칙·레코드 변환·스키마·CSV 왕복·편집·검색·레이아웃(여러 칸 랙 폭, 공유 U 반분)·스토어(지도 상태).
- e2e(Playwright, `tests/e2e/`, 어두운/밝은 테마 프로젝트 각각): 기존 화면 흐름 + `map.spec.js`(지도·핀·미등록 DC·복귀), `mount.spec.js`(위반 표시·공유 U·여러 칸 피킹), `theme.spec.js`(전환·유지·그림자), `offline.spec.js`(외부 요청 0건, 오프라인 지도), `perf.spec.js`(위 게이트). 모든 e2e는 콘솔 에러 0건을 확인합니다.
- 다른 e2e 실행과 겹치지 않게 하려면 `E2E_PORT=4191 npm run test:e2e`처럼 포트를 바꾸세요(그 경우 빌드 결과도 별도 폴더에 만듭니다).

## v2 변경점

- **첫 화면이 지도**: 이전의 데이터센터 선택 상자를 없애고 지도 + 목록으로 바꿨습니다. `dc`가 없거나 없는 `dc`를 가리키는 해시는 지도(`#map`)로 갑니다.
- **데이터 형식**: 서버/서비스(hostname·ip·services) 대신 현장 레코드 형식만 씁니다. 저장·내보내기 JSON은 `version: 3` 트리이며 원본 코드(`floorspaces`, `device_position`)를 그대로 보존하고, 격자 좌표는 화면용으로 매번 계산합니다.
- **규칙 위반은 경고**: 이전에는 겹친 서버/중복 슬롯 랙을 제외하거나 편집을 막았지만, 이제는 그리고 경고만 합니다.
- **화면**: 구역 바닥 타일·낮은 벽·그라데이션 배경·안개·그림자, 밝은/어두운 테마. 테마를 바꾸면 현재 데이터센터 씬을 그 자리에서 다시 만듭니다(카메라 유지).
- **공유 U 표시**: U를 위아래 반으로 나눠 그립니다(구멍 3개 단위가 아니라 반 U 단위).
