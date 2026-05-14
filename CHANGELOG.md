# CHANGELOG

ttimes-editor 의 운영 변경 이력. 큐레이션된 형식 — 증상/원인/수정/검증을 한 항목에 묶어 후속 trace 비용을 낮춤.
세부 diff 는 `git log` / 인라인 주석 (단계 표기 R3.e-2-fix 등) 참고.

---

## 2026-05-09 — lab 방향 전환 (코드 복사 → fresh v2 설계, 다 세션)

### 17. ops(lab): 방향 전환 — prod 코드 복사 → fresh v2 설계 (사료 전수 정독 기반)

- **사용자 명시 방향**: "v1 에서 겹겹이 쌓아올린 v2 말고 fresh 하게 새롭게 설계한 v2 가 필요한 단계. 코드를 더욱 효율화 해서 v2 를 새롭게 설계해서 만드는게 향후 v3, v4 로 가는데 도움이 될 수 있다."
- **방법**: `cms-v2-plan/` 188 개 .md + 8 옛 앱 (ttimes-*) + prod 코드 **전수 정독** → 본질 추출 → 효율화 설계 → 모듈별 구현. **빈 곳 0**.
- **속도**: "절대로 빠른 방법이 아니라 완벽한 최선의 방향" — 다 세션 (수십 시간) 작업.
- **옛 ops 사료** ([`ops/lab-setup-2026-05-09.md`](./ops/lab-setup-2026-05-09.md)) **superseded 표시 + 보존**:
  - Phase 0 인프라 (GitHub PAT / Cloudflare Worker `lab` / KV `lab-sessions`) 는 새 방향에서도 사용 → 사료 가치
  - Phase 1.1 commit (`0b4711d`) 의 결정 매트릭스 박제 보존
  - 옛 → 새 흐름 추적 가능
- **새 master 사료**: [`ops/lab-v2-fresh-2026-05-09.md`](./ops/lab-v2-fresh-2026-05-09.md) — 사료 정독 + 본질 + 설계 + 구현 계획이 자라며 누적
- **사용자 약속 (사료의 헌장)**:
  1. 전수 정독 — 188 개 + 8 옛 앱 + prod 코드. 빠뜨림 0
  2. 빈 곳 0 — 모든 사료 내용이 구현 가능한 형태로 박제
  3. 최선 vs 빠름 — 빠른 길 명시적 거부
  4. 사료 박제 디시플린 — 정독/설계/계획 모두 누적
- **본 commit 의 박제**:
  - `ops/lab-setup-2026-05-09.md` superseded 표시 (보존)
  - `ops/lab-v2-fresh-2026-05-09.md` 신설 (master doc, Stage 0 ~ Stage 6 윤곽 + 인프라 박제 + 사료 우선순위)
  - `ops/README.md` 인덱스 갱신 (★ 신, 옛 superseded 표시)
  - `CLAUDE.md` lab 섹션 — 방향 전환 박제 + 새 master doc 참조
  - 본 entry — CHANGELOG 박제

---

## 2026-05-09 — test 환경 재설계 시작 (`lab` 신설, Phase 1 시작)

### 16. ops(lab): test 환경 재설계 — 옛 `editor` (test) → 새 `lab` 환경 신설 시작

- **배경**: prod editor v2 안정화 (#1~#15) 완료 → 사용자 명시 "test 도 prod v2 기반으로 시금석 재설계". 옛 test 측 (worker `editor` / KV `editor-sessions` / repo `ttimes-editor`) 의 단어 충돌 ("editor" prod 로컬 폴더와 동일) + 5/6 코드 stale 문제 해소.
- **사용자 결정 매트릭스**: 이름 `lab` (모든 레벨 일관) / KV 90 keys 마이그레이션 / OPENAI·GEMINI 키 공유, JWT_SECRET 별도 / Pages prod 동일 형식 / 첫 baseline = HEAD (`3ab1184` + 본 commit) / 옛 환경 정리 = Phase 3 deferred.
- **Phase 0 (사용자 직접 완료)**: lab/ 폴더 + GitHub `ttimesvibe/lab` + Worker `lab` (`lab.ttimes.workers.dev`) + KV `lab-sessions` (`fbb8da8a...`) 신설.
- **Phase 1 (이번 작업 — 본 commit 은 시작 박제)**: prod HEAD 코드 → lab 복사 + 인프라 설정 + KV 마이그레이션 + Pages 활성 + 라이브 검증.
- **Phase 3 (deferred)**: 옛 worker `editor` / `ttimes-edit` 폐기 + GitHub `ttimes-editor` 삭제 + KV 정리. 사용자 명시 "복잡하니 맨 마지막".
- **본 commit 의 박제**:
  - **새 `editor/ops/` 폴더 신설** — 다단계 절차 사료 누적용 + `README.md` (인덱스 / 형식 규약 / 디시플린)
  - **`editor/ops/lab-setup-2026-05-09.md` 신설** — lab 신설 작업의 결정/단계/진행 로그 사료
  - **`editor/CLAUDE.md` 갱신** — lab 섹션 + 옛 test (Phase 3 폐기 예정) 섹션 분리 박제
  - **본 entry** — CHANGELOG 에서 ops 사료 참조
- **디시플린 박제 (이번 세션 3차 누수)**: 작은 commit 이라고 CHANGELOG skip → 사고 발생 시에도 박제 누락 → 큰 작업 (lab 재설계) 도 사료 없이 진행 직전 사용자 지적. 이후 모든 ops 작업 = 사료 (`ops/`) + commit (CHANGELOG) + 운영 메모 (CLAUDE.md) 3 군데 동시 박제 의무.

---

## 2026-05-09 — OneDrive 동기화 사고 + chimera 차단 + 롤백 (★ 사고 보고)

### 15. ops(incident): OneDrive 가 working dir 18 파일을 옛 캐시로 덮어쓰기 → chimera 위험 → 롤백

- **사건**: 마지막 commit `3ab1184` (05:08:54) 이후, 14:03:54 에 OneDrive 가 batch sync 로 working dir 의 18 파일을 옛 캐시 버전으로 덮어쓰기. 이 PC 의 신 버전은 `*-MAIN-HONG.*` 사본 17개로 백업됨 (PC 호스트명 접미사)
- **chimera 위험**: 옛 회귀된 working dir 위에 view toggle Edit (App.jsx 1줄 + Dashboard.jsx ~25줄) 추가 → 옛 자체 정의 STATUS_MAP + 신 view toggle 변경 mix. 빌드는 syntax 통과로 성공 → "정상" 오판 위험. commit/push 했다면 단계 정의 통합 (#11) 등 무효화 위험
- **발견**: 빌드 시 `STEP_KEYS not exported by tabs.js` 에러 → 사용자 의심 제기 → 정밀 검증 (HEAD vs working dir vs MAIN-HONG 3-way diff + 파일별 timestamp 분석 + 11 marker 검증) → OneDrive 사고 확정
- **결정 (사용자 명시)**: "코드 패치 X, 히스토리 롤백만"
  - `git reset --hard HEAD` + `git clean -fd` (3ab1184 시점으로 완전 회귀)
  - View toggle WIP 변경 (~26 줄) 손실 수용. 다시 요청 후 진행
- **결정 기록 (재발 방지)**:
  - **OneDrive 동기화 폴더에서 git 작업 시 위험 인지** — sync 사고 시 chimera. 작업 중엔 OneDrive 일시 중지 권장
  - **빌드 통과 ≠ 정상**. syntax error 만 잡고 의미 회귀 (옛 자체 정의 vs 신 import 등) 는 못 잡음
  - **Edit 전 Read 도구로 file 재검증 의무** — OneDrive 회귀 즉시 발견 가능
  - **CHANGELOG 박제 누수가 사고 detection 지연**. 모든 commit + 절차/사고 자체에 박제 의무 (이 항목 #15 가 그 약속의 박제)

---

## 2026-05-09 — 캘린더 동기화 Apps Script 권한 만료 (외부 작업)

### 14. ops(calendar): Apps Script OAuth 재승인 + `appsscript.json` manifest oauthScopes 락

- **증상**: 일정 등록 시 메일은 오는데 Google Calendar (ttimes6000@gmail.com) 에 이벤트 등록 안 됨
- **진단** (`wrangler tail` 라이브 로그):
  ```
  [shoot create] Apps Script status: 403
  [shoot create] Apps Script response: <!DOCTYPE html>... (Google 권한 거부 페이지)
  ```
- **원인**: Apps Script 코드에 새 API/scope 추가 → OAuth 자동 무효화. 같은 패턴 `4a74c3c` (4/20) fix 후 재발
- **조치 (Worker 코드 변경 0)**:
  1. Apps Script 에디터 → "권한 검토" 클릭 → 재승인
  2. `appsscript.json` manifest 에 `oauthScopes` 명시 락 (`calendar` / `calendar.events` / `script.external_request`) → 코드 수정 시 자동 scope 추가 차단
  3. 배포 형식: `executeAs: "USER_DEPLOYING"` + `access: "ANYONE_ANONYMOUS"`
- **재발 방지**: manifest 락 후 코드 수정 시 재승인 거의 X. 다음 비슷한 증상 시 `wrangler tail` 의 Apps Script `status` code 부터 점검 → 95% 진단 가능

---

## 2026-05-09 — 상태 배지 justifySelf:start (grid stretch 차단)

### 13. fix(board): 상태 배지 `justifySelf:"start"` — grid item stretch 차단 — `3ab1184`

- **증상**: 80px 컬럼 확장 후 모든 배지 ("세트", "편집가이드", "자료·그래픽" 등) 가 cell 폭 거의 가득 채워 길어 보임
- **원인**: `<span style={{display:"inline-block"}}>` 가 grid cell 직접 자식 → grid item 으로 승격되어 inline-level box 도 blockified, default `justify-self: stretch` 로 cell 너비 채움. 72px 시절엔 텍스트가 거의 cell 채워 안 보였던 것이 80px 로 늘리니 빈 공간 생겨 stretch 효과 명확히 보임
- **수정**: `renderStatusBadge` + Trash row "삭제됨" 배지 둘 다 `justifySelf:"start"` 추가. 자체 폭만 차지하고 좌측 sticky
- **회귀**: 0 — CSS 속성 추가만. 짧은 라벨 ("세트") 부터 긴 라벨 ("자료·그래픽") 까지 자체 폭으로 표시

---

## 2026-05-09 — 게시판 상태 컬럼 폭 조정

### 12. style(board): 상태 컬럼 72px → 80px (배지 침범 해소) — `7b71c92`

- **증상**: "편집가이드" / "하이라이트" 5자 배지가 72px 컬럼 거의 가득 (text 55px + padding 16px ≈ 71px) → 프로젝트명 컬럼 침범 보임
- **수정**: `BOARD_GRID` 의 상태 컬럼 `72px → 80px`. 9px 여백 확보
- **회귀**: 1fr 프로젝트명에서 8px 양보. truncate 40자 영향 0
- **후속 발견**: 80px 확장 후 grid stretch 효과로 모든 배지가 cell 가득 채우는 별 문제 (#13) 발견 → 같은 날 fix

---

## 2026-05-09 — 단계 정의 단일 소스 통합 (4-5곳 산재 → tabs.js 한 곳)

### 11. refactor(steps): STEP_KEYS/LABELS/COLORS/MAP/STATUS_MAP 단일 소스 통합

- **배경**: 단계 정의가 5곳 산재 → 라벨/색 변경 시 다 잊지 말고 손봐야 했음. visual mismatch 버그 (#10) 가 정확히 그 결과 (Dashboard STATUS_MAP 만 visual=guide 로 박혀 있어서 다른 곳과 어긋남).
- **인벤토리** (통합 전):
  - `Dashboard.jsx` STATUS_MAP / STEP_LABELS / STEP_KEYS
  - `KanbanView.jsx` STEP_KEYS / STEP_LABELS / STEP_COLORS
  - `App.jsx` STEP_MAP (인덱스) + 편집 탭 인라인 배열 `[["review","0차 검토"], ...]`
  - `utils/tabs.js` TAB_MAP + STEP_MAP (이미 단일 소스 의도였으나 활용 미완)
- **사용자 결정**: 단일 소스 = `tabs.js` 의 TAB_MAP 확장 (새 파일 안 만듦). 라벨 통일 — "편집 가이드" / "편집가이드" 띄어쓰기 차이를 모두 "편집가이드" (붙임) 로 통일.
- **변경**:
  - `utils/tabs.js`: TAB_MAP 에 `label` / `statusLabel` / `color` 필드 추가. derived export 4개 (`STEP_KEYS`, `STEP_LABELS`, `STEP_COLORS`, `STATUS_MAP`) + `STEP_MAP` (기존 유지). `DONE_STATE` 별 객체 (단계가 아니라 상태).
  - `Dashboard.jsx`: 자체 STATUS_MAP / STEP_LABELS / STEP_KEYS 정의 제거 → `import { STEP_KEYS, STEP_LABELS, STATUS_MAP } from "../utils/tabs.js"`
  - `KanbanView.jsx`: 자체 STEP_KEYS / STEP_LABELS / STEP_COLORS 정의 제거 → import
  - `App.jsx`: 자체 STEP_MAP 제거 + 편집 탭 인라인 배열 → `STEP_KEYS.map(id => ... STEP_LABELS[id] ...)`
- **회귀 검증** (1:1 매핑 확인):
  - STEP_KEYS 8개 동일 순서: review/correction/script/guide/visual/modify/highlight/setgen
  - STEP_COLORS / STATUS_MAP 색 모두 동일
  - **유일한 의도된 변화**: STEP_LABELS guide "편집 가이드" → "편집가이드" (사용자 통일 결정 — 게시판 배지/현재 단계 컬럼/편집 탭/칸반 카드 모두 일관)
- **누더기 회피**: 다음에 단계 추가/이름 변경/색 변경 시 `tabs.js` TAB_MAP 한 곳 수정.

---

## 2026-05-09 — visual 단계 mismatch 버그 + 편집 탭 ✓ 일관성

### 10. fix(steps): STATUS_MAP visual 분리 + 편집 탭 ✓ 단계별 일관성

- **버그**: 게시판에서 visual ("자료·그래픽") 단계 프로젝트가 상태 배지 / 좌측 색 막대 / 진행바 색이 모두 guide ("편집가이드") 로 표시. 사용자 보고: "자료-그래픽 단계 프로젝트도 상태 바에 편집가이드로 나옴"
- **원인** (Dashboard.jsx L20-21):
  ```js
  guide:  { label: "편집가이드", color: "#3B82F6" },
  visual: { label: "편집가이드", color: "#3B82F6" },  // ★ guide 와 동일
  ```
  STEP_LABELS 만 "자료·그래픽" 으로 분리되어 "현재 단계" 컬럼만 정상 표시 → mismatch.
- **부가** (편집 탭 ✓): App.jsx L1922 `id==="guide"&&gReady?" ✓":""` — guide 탭에만 ✓ 표시. 다른 단계 (review/correction/visual/modify/...) 는 ✓ 표시 로직 없어 사용자 직관 어긋남.
- **사용자 결정**: 라벨/색 분리 (visual = "자료·그래픽" + 보라 #A855F7) + 편집 탭 ✓ 단계별 데이터 기반 일관성. 스파게티 통합 (단계 정의 4-5곳 산재) 은 별 commit 으로 분리.
- **변경**:
  - `Dashboard.jsx` STATUS_MAP: `visual: { label: "자료·그래픽", color: "#A855F7" }`
  - `KanbanView.jsx` STEP_COLORS: `visual: "#A855F7"`
  - `App.jsx` 편집 탭: 인라인 IIFE 로 `stepDone[id]` 매핑 (review reviewData / correction diffs / script scriptEdits|blockDeletions / guide gReady / visual visualGuides|insertCuts|manualResources / modify cards / highlight clips / setgen result) → 각 탭에 ✓
- **회귀**: 빌드 통과. 기존 동작 영향:
  - 게시판 visual row 색이 보라로 바뀜 (의도된 변화)
  - 편집 탭에서 guide 외 단계도 데이터 있으면 ✓ 표시 (의도된 추가 정보)

---

## 2026-05-09 — 게시판 zebra + 좌측 status 막대 + 라이트모드 활성탭 버그 정리

### 9. style(board): 라이트모드 활성탭 가시성 + zebra + 좌측 status 색 막대 + 코드 정리

- **요청**: "게시판 탭에도 음영이나 색을 줘서 구분 + 스파게티 스캔"
- **스파게티 스캔 (Dashboard.jsx 1064줄)**:
  - **★ 라이트모드 미지원** — 필터 탭 활성 색 `#fff` (라이트 흰 배경에 흰 글자 = 안 보임), `#3A3F52` (very dark), `#5E6380 / #8B8FA3` 다수 하드코딩
  - **★ Trash row + Project row 구조 중복** (~150줄) — 같은 grid, 컬럼 의미만 분기
  - **★ 액션 버튼 색조 4곳 중복** (~80줄) — 복구/영구삭제/완료/삭제 같은 템플릿 인라인 반복
  - 중간 — `gridTemplateColumns` 같은 string 3곳 중복
- **사용자 결정**: (마) Zebra + 좌측 status 색 막대 / (iii) 시각 + 다크색 정리 + 추출 모두
- **변경**:
  - 필터 탭: `#fff` / `#3A3F52` → `C.tx` / `C.txD` / `C.txM` — 라이트모드 활성탭 검정으로 또렷이 보임 (★ 핵심 버그 fix)
  - `BOARD_GRID` 상수 추출 (3곳 중복 → 1곳)
  - `ActionButton` 헬퍼 — 4곳 인라인 → 1 컴포넌트 (color prop 받아 alpha hex suffix 로 hover/border 자동 계산: `+ "4D"` = 30%, `+ "26"` = 15%)
  - `BoardRow` 래퍼 — Trash row + Project row 의 grid/hover/zebra/좌측 막대 통합. children 으로 column slot.
  - **Zebra**: 짝수 idx 에 `C.glass` 배경, hover 와 충돌 회피 (mouseLeave 시 idx 기준 baseBg 복원). 라이트/다크 양쪽 적용 (가독성 둘 다 도움)
  - **좌측 status 색 막대**: `borderLeft: 4px solid ${barColor}` — Project 는 `STATUS_MAP[step].color`, Trash 는 `TRASH_BAR_COLOR` (#8B8FA3)
  - 다크색 hex (`#5E6380` / `#8B8FA3`) 게시판 영역 인라인 → `C.txD` / `C.txM`. 의미있는 색 정의 4건 (STATUS_MAP done, TRASH_BAR_COLOR, avatar 흰 글자, pagination 활성 흰 글자) 보존.
- **회귀**: 빌드 통과. row 형식/액션 동작 동등 (인라인 → 컴포넌트만 추출). Zebra/좌측 막대는 시각 추가만.
- **누더기 지수**: ~230줄 중복 → 0. 미래 row/액션 형식 변경 시 한 곳만 수정.

---

## 2026-05-09 — Kanban 일정 라이트모드 색조 + 스파게티 정리

### 8. style(kanban): 라이트모드 카드 은은한 색조 + 다크색 하드코딩 정리 + DoneCard 추출

- **요청**: "일정 라이트모드가 너무 다 하얀색. 각 카드에 은은한 색을 입히고 싶다 + 일정탭 코드 스파게티 스캔"
- **스파게티 스캔 결과** (KanbanView.jsx 802 줄):
  - **주요 결함 1** — 다크색 hex 직박 (라이트/다크 분기 X): `#0F1117 / #454B66 / #5E6380 / #8B90A5 / #B8BDD1`. 라이트모드에서 카드 안 검정 영역으로 튐 (사용자 보고와 직결)
  - **주요 결함 2** — Done 컬럼 sub-card 인라인 중복 (L453-486)
  - 중간 결함 — `allRoles` 펼치기 패턴 두 곳, `+ "20"` 알파 suffix 산재 (over-engineering 위험으로 미처리)
- **사용자 결정**: (a) 라이트모드만 색조 / (가) 컬럼 색 source / (iii) 본 작업 + 1번 + 2번 결함 정리
- **변경**:
  - `styles.js`: `bdHover` 추가 (DARK `#454B66` / LIGHT `#A0A4B5`) — hover 식별 보더
  - `KanbanView.jsx`:
    - 하드코딩 hex 색을 `C.txD / C.txM / C.bg / C.bdHover / C.ac / C.acS` 로 교체 (의미있는 색 정의 4건은 보존)
    - `DoneCard` 컴포넌트 추출 — shoot/project 통합, 인라인 중복 제거
    - `stageColor(stage)` + `cardBg(stage)` 헬퍼 신설 — 라이트모드 한정 컬럼 색 5% alpha 적용 (`+ "0d"`), 다크모드는 `C.sf` 그대로
    - `ProjectCard` 시그니처에 `stage` prop 추가 (호출처 KanbanView 에서 col.key 전달)
    - 4종 카드 (Shoot / Transition / Project / Done) 모두 `cardBg(stage)` 사용
- **회귀**: 빌드 통과. 다크모드 동작 동등 (cardBg 가 `C.sf` 반환). 라이트모드만 카드별 컬럼 색 옅게 입힘.

---

## 2026-05-09 — 내보내기 HTML 통합 가이드 섹션 추가 + 카드 렌더 헬퍼 추출

### 7. feat(export): 🧩 통합 가이드 섹션 신설 (편집자 요청)

- **요청**: "편집가이드의 추가 콘텐츠(자막)와 자료/그래픽의 추가 콘텐츠(자료)를 한꺼번에 보고 싶다"
- **분석**: 두 섹션은 같은 블록 텍스트(`getCorrectedPlain`) 기반. 차이는 (1) 마커 source(`hlMarkers` vs `visualMarkers`), (2) 카드 source(자막 / 시각화 / 인서트 컷 / 수동 자료) 두 가지뿐.
- **사용자 결정**:
  - 위치: `편집가이드 → 자료&그래픽 → 통합` (분리 → 통합 순서)
  - 마커 충돌: 단순 합치기, 시작 빠른 쪽 표시 (불편 감수 명시)
- **변경**:
  - `exportHTML.js` 의 카드 색상 상수 (`TYPE_COLORS / IC_LABELS / IC_COLORS / RES_LABELS / RES_COLORS`) 를 함수 상위로 lift
  - 카드 렌더 헬퍼 4종 추출 (`renderGuideCard / renderVisCard / renderIcCard / renderResCard`) — 모두 verdict==="use" 필터 통합
  - `guideSection` / `visualSection` 인라인 카드 → 헬퍼 호출로 교체 (시각 결과 동등)
  - 새 `combinedSection` — `hlMarkers` + `visualMarkers` prefix 합친 후 `applyMarkers`, 카드는 자막 → 시각화 → 인서트 컷 → 수동 자료 순 stack
  - 기본 접힘 (`open=false`) — 분리 view 가 메인, 통합은 보조 view
- **검증**: 빌드 통과. 리팩터부 출력 동등성 — 헬퍼는 인라인 코드를 그대로 옮긴 것 (string template 내용 동일).
- **누더기 회피**: 카드 코드 ~80 줄 중복을 4 헬퍼로 통합. 이후 카드 형식 변경 시 한 곳만 수정.

---

## 2026-05-09 — SessionListModal 폐기 (Dashboard 게시판 superset)

### 6. cleanup(sessions): /sessions 라우트 + SessionListModal + updateSessionIndex 일괄 제거

- **배경**: CMS 우상단 📋 "작업 히스토리" 버튼 → `SessionListModal` → `/sessions` GET → `session_index` KV 의 단순 목록 표시. v1 시절 진입로.
- **중복 검토**: Dashboard 게시판 뷰 (`/projects` + `project_index`) 가 superset — 검색/필터/휴지통/권한/편집자 표시 모두 추가 제공. SessionListModal 은 v1→v2 이행 잔재.
- **Orphan 검증** (정공법 우선): KV 실측으로 session_index vs project_index 좌비 14건 발견.
  - 12 좀비 (entity 0, 인덱스만 잔존) — 4/24 KV drift 사고 흔적 등
  - 2 V1 레거시 (`save_<id>`, "(자료) 허진호2 컷편" 4/16 두 번)
- **사용자 결정**: KV 데이터 화석 보존 + 코드 일괄 제거 (자연 만료 또는 영구). 폐기 X.
- **변경**:
  - `App.jsx`: import / `showSessions` state / 📋 버튼 / 모달 렌더 4군 제거
  - `components/Modals.jsx`: `SessionListModal` 함수 + export 제거 (다른 export 영향 0)
  - `worker/index.js`: `/sessions` GET + `/sessions/delete` POST 라우트 / `handleSessionList` / `handleSessionDelete` / `updateSessionIndex` 함수 + 두 호출처 (handleSave, handleSaveLegacy) / stale 주석 1건 — 7군 제거
- **검증**: 94/94 worker 테스트 pass. 빌드 통과 (1026 KB → -4 KB 감소).
- **결정 기록**: 코드 dead 정리는 _코드만_ 정리하고 KV 데이터는 보존하는 것이 정공법. KV 부담 무시 (~25KB), 미래 forensic 가치 보존, 누더기 0.

---

## 2026-05-09 — 라이브 데이터 손실 + 휴지통 정합 묶음

이번 묶음의 일관 주제: **누더기 회피 + 정공법으로 데이터 손실 차단**.
사용자 보고 (modify/highlight/visual 탭에서 저장→나갔다 들어오면 항목이 마지막 1개만 남음) 의 두 갈래 원인 + 휴지통 정책 모순 + RestoreModal 재출현 — 4건을 동시 정리.

### 1. fix(merge): id-fallback dedupe — `9a6cef0`

- **증상**: 사용자 추가한 cards/clips 가 저장→재진입 후 마지막 1개만 남음
- **원인** (worker/merge.js): `MERGE_STRATEGIES.modify.cards` 의 `entityType: "manualResources"` 와 `highlight.clips` 의 `entityType: "hl"` 이 `fallbackKeySync` 의 키 필드 (blockIndex|type|query|url, subtitle|speaker|startMs) 와 mismatch. 사용자 생성 항목은 `_stableId` 가 없어 fallback 으로 추락 → 모두 같은 키 (e.g. `"|||"`) → arrayIdUnion Map 이 마지막 항목으로 덮어씌움
- **수정**: `fallbackKeySync` 첫 줄에 universal id 우선 분기 추가
  ```js
  if (item && item.id != null && item.id !== "") return `id:${item.id}`;
  ```
  AI 생성 항목은 `_stableId` 가 먼저 잡혀 영향 없음. `docs/src/utils/_mergeImpl.js` (클라 미러) 동기화
- **검증**: `worker/__tests__/mergeTabData.test.js` id-fallback 회귀 6 케이스 추가 (47 → 47 pass)

### 2. fix(autosave): tabDataStateRef 부활 — `b4d1063`

- **증상**: ★ 위 (1) 적용 후에도 데이터 손실 재발. 라이브 로그에서 `modify onSave called, cards=2` → `save PAYLOAD modify: cards=1` 격차 확인
- **원인** (App.jsx): `saveDirtyTabsToKV` 가 `useCallback([tabDataState, ...])` 라 매 state 변경마다 새 함수 reference. cascading 30s autoSave timer 가 schedule 시점 reference 를 holds → 30s 후 fire 시 OLD closure 의 OLD `tabDataState` 사용 → 사용자가 그 사이 입력한 데이터 누락 PUT
- **수정**:
  - `tabDataStateRef = useRef(tabDataState)` 부활 + `useEffect` 로 매 render mirror
  - `saveDirtyTabsToKV` 내부 read 를 `tabDataStateRef.current` 로 (closure 무관)
  - `useCallback` deps 에서 `tabDataState` 제거 → 함수 reference 안정 → timer 가 capture 해도 ref read 라 항상 최신
  - 같은 stale-closure 가능성 `pagehide` 핸들러에도 동시 적용
- **결정 기록**: R3.d.2.e 단계의 "useCallback 직접 read 로 ref 영역 사용 0" 가정이 잘못된 가정이었음. closure capture 의 timing 무시. **다음에 ref 폐기 결정할 때 timer/이벤트 핸들러 측 capture 경로까지 사고실험 의무**
- **검증**: 사용자 라이브 재시도 → "와!! 드디어 안 없어진다!" 보고

### 3. fix(trash): B안 정공법 정합 — `5e012ae`

- **배경**: 휴지통 영구삭제 정책이 두 주석 모순
  - `handleProjectDelete` L984: "scheduled cron이 30일 경과분 수행" — 자동삭제 가정
  - `handleProjectTrash` L1047: "자동 영구삭제 없음, 관리자 수동" — 수동 가정
  - 실제: scheduled() 핸들러 미구현 + entity TTL 30일 단축됨 → entity 만료 후 index 좀비 발생
- **측정**: `project_index` 25.3KB / KV 무료 1GB 의 0.0025%. 자동삭제 가치 < 위험
- **수정** (B 안 = 영구 보존 + admin 수동):
  - `handleProjectDelete`: entity TTL 단축 + `purgeEligibleAt` 박제 제거
  - `handleProjectTrash`: 응답 `purgeEligibleAt` 필드 제거 (클라 미사용 확인)
  - `handleProjectRestore`: 옛 엔트리 호환 주석 (TTL 1년 복원 로직 유지 — 옛 단축 키 자동 정리)
  - `wrangler.toml`: `[triggers] crons = []` 명시 → dashboard 잔여 cron 동기 제거
- **운영 정책 명시**: 영구삭제는 admin 이 `/projects/trash/purge` 로 수동 호출 (이미 구현). 자동 cron 없음
- **검증**: 94/94 pass. 배포 시 wrangler 가 dashboard cron `0 18 * * *` 자동 제거 확인

### 4. fix(backup): RestoreModal "무시" → totalCount 기반 분기 — (이번 commit)

- **증상**: Mount 팝업 "총 N개의 백업이 있습니다" 보고 "무시하고 새로 시작" 클릭 → 작업 → 재진입 시 또 출현
- **원인** (App.jsx onSkip): 보여준 1 개만 `deleteBackup` → 잔존 N-1 개로 매 진입 재트리거. 모달 framing ("총 N개" + "새로 시작") 과 코드 동작 불일치
- **수정**: `totalCount` 기반 분기로 모달 framing 과 코드 동작 정합
  - Mount 팝업 N>1: sid 의 N개 일괄 삭제 (프로젝트 reset)
  - 단일 컨텍스트 (mount-N=1 / BackupListModal 개별 선택, totalCount=1): 1개만 삭제 (옛 동작 유지)
- **footgun 차단**: BackupListModal 에서 1개 선택해 "무시" 시 다른 backup 보존 (이전 검토안의 일괄삭제 버전이 가졌던 문제 — 재검토로 분리)
- **검증**: 빌드 성공, 흐름 7 경로 매트릭스 회귀 0 확인

---

## 이전 변경 이력 (요약)

세부는 git log 참고. 큰 흐름:

- **M1 ~ M6** (헌장 v1.1 §1-§6 정식 충족): cascading throttle, justLoadedRef, setTabWithFreshness, ConflictModal 2 옵션, pagehide fetch keepalive, active-users UI
- **R Phase**: 11 탭 동등 단일 store (`tabDataState`), `patchTab` 단일 setter, schemaVersion 3.0
- **약속 W**: 4중 백업 (W1 자동재시도 / W2 localStorage / W3 다운로드 / W4 beforeunload)
- **약속 X**: 탭 진입 시 fresh fetch
- **약속 Y**: justLoadedRef 명시 신호 — 복원/load 가 dirty 만들지 않음

---

## 형식 규약

새 항목 추가 시:

```
## YYYY-MM-DD — 한 줄 요약 (큰 주제)

### N. fix(scope): 짧은 제목 — `<short-sha>`

- **증상**: 사용자 시점에서 무엇이 잘못 보였나
- **원인**: 어디 코드 / 왜 그렇게 됐나 (필요시 옛 결정의 가정 박제)
- **수정**: 무엇을 어떻게
- **검증**: 테스트 / 라이브 / 측정값
- **결정 기록** (선택): 미래 자아가 다시 같은 함정 안 빠지게
```
