# lab — ttimes-editor (test 환경)

★ 본 repo 는 `ttimesvibe/editor` (prod) 의 **clone**. 동일 application 코드 + lab 전용 인프라.

prod 와의 차이는 **인프라 분리만** — 코드 자체는 prod 와 동일.

## 인프라 매트릭스

| 영역 | prod | lab (현 repo) |
|---|---|---|
| 메인 Pages | `ttimesvibe.github.io/editor/` | `ttimesvibe.github.io/lab/` |
| Admin Pages | `ttimesvibe.github.io/admin/` (별 repo) | `ttimesvibe.github.io/lab/admin/` (본 repo 내 `docs/admin/`) |
| 메인 Worker | `alleditor.ttimes6000.workers.dev` (ttimes6000) | `lab.ttimes.workers.dev` (ttimesvibe) |
| Auth Worker | `auth.ttimes6000.workers.dev` (ttimes6000) | `lab-auth.ttimes.workers.dev` (ttimesvibe) |
| 메인 KV | `editor-session` (id `2892f3a4...`) | `lab-sessions` (id `fbb8da8a...`) |
| Auth KV | `auth-kv` (id `52ba7093...`) | `AUTH` (id `b3cf948f...`) |
| JWT_SECRET | prod 전용 | lab 전용 (★ 별 값 — 토큰 비호환) |

## 사용자 명시 원칙 (2026-05-11)

1. prod 와 같은 기능 구현
2. prod 의 데이터/URL 겹치면 X
3. worker 데이터 섞이면 X — **카니발 근원 모두 차단**

## 폐기된 옛 자원 (★ 2026-05-11 정리 완료)

| 자원 | 상태 |
|---|---|
| `ttimesvibe/ttimes-editor` (GitHub) | ✅ 삭제 (404) |
| Worker `editor` (editor.ttimes.workers.dev) | ✅ 삭제 |
| Worker `ttimes-edit` (옛 죽은 worker) | ✅ 삭제 |
| KV `editor-sessions` (옛 test, 82 keys) | ✅ 삭제 (lab-sessions 마이그레이션 완료 + 7.5MB 백업 보존) |
| KV `ttimes-editor-sessions` (legacy, 8 keys) | ✅ 삭제 |

★ 이전 lab fresh v2 시도 폐기 사후 분석 — `editor/ops/POSTMORTEM_LAB_FRESH_DECOMMISSION_20260511.md`

영상 편집/교정 CMS. 프론트엔드 (GitHub Pages) + 백엔드 (Cloudflare Worker) 독립 배포.

## 구조

```
editor/
├── docs/                ← GitHub Pages 배포 (main 브랜치 /docs 폴더)
│   ├── index.html
│   ├── assets/          ← Vite 빌드 산물
│   ├── dist/            ← 빌드 출력 (assets 와 sync)
│   ├── src/
│   │   ├── App.jsx          ← 11 탭 단일 store + 통합 저장 흐름
│   │   ├── tabs/            ← 11 탭 컴포넌트 (correction/guide/highlight/visual/modify/...)
│   │   ├── components/      ← 모달 (RestoreModal, ConflictModal, SaveFailModal, BackupListModal)
│   │   └── utils/
│   │       ├── backup.js        ← W2 localStorage 백업
│   │       ├── tabSchemas.js    ← 헌장 §5 11 탭 schema 단일 진실
│   │       ├── _mergeImpl.js    ← worker/merge.js 의 클라 미러 (M11)
│   │       └── config.js        ← workerUrl 박제
│   └── build.js         ← Vite 빌드 + drift guard (config.js workerUrl 자동 검증)
├── worker/              ← Cloudflare Worker
│   ├── index.js         ← 11 탭 dispatch + 통합 저장/조회/충돌
│   ├── merge.js         ← 머지 전략 (array_stable_id_union, fallbackKeySync 등)
│   ├── wrangler.toml
│   └── __tests__/       ← node --test (mergeTabData / permissions / errorMessages / xss / tabs)
├── CHANGELOG.md         ← 운영 변경 이력 (큐레이션)
├── CLAUDE.md            ← 운영 컨텍스트 (계정/KV/배포 — 헷갈리는 부분 메모)
└── README.md            ← 이 파일
```

## 배포

### 프론트엔드 (GitHub Pages)

`docs/` 폴더가 GitHub Pages 로 자동 배포 (`ttimesvibe/lab` 리포 / main 브랜치 / `/docs` 폴더).

```bash
cd docs && npm run build       # → dist/ 생성 + docs/ 루트로 복사
git add docs && git commit -m "..."
git push origin main           # → Pages 자동 배포 (~1-2분)
```

URL: https://ttimesvibe.github.io/lab/

⚠️ 임시 디렉터리에서 빌드 금지 — 과거 drift 사고 발생 (`docs/BUILD.md` 참고).

### 백엔드 (Cloudflare Worker)

```bash
cd worker

# 1) KV 네임스페이스 (최초 1회)
npx wrangler kv namespace create SESSIONS
# → 출력된 id 를 wrangler.toml 의 [[kv_namespaces]] 에 입력

# 2) Secrets (최초 1회)
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY

# 3) 배포
npx wrangler deploy
```

현재 운영 (lab/test): `lab.ttimes.workers.dev` (ttimesvibe 계정 `fb0a10864393158e940b149b3ead37f6`).
prod (alleditor.ttimes6000.workers.dev) 와 인프라 완전 분리.

### Worker URL 변경 시

`docs/src/utils/config.js` 와 `docs/build.js` 의 `CANONICAL_WORKER_URL` 두 곳 동시 수정 (drift guard 가 mismatch 자동 차단).

## 아키텍처 핵심 (요약)

- **단일 진실** — `tabDataState` 단일 store + `patchTab` 단일 setter (헌장 §5/§6)
- **30s cascading throttle** — 첫 dirty 시점 timer 시작, 입력 중에도 30s 주기 fire (헌장 §1조)
- **4중 백업** (Walls of Durability)
  - W1 auto-retry / W2 localStorage / W3 download / W4 beforeunload
- **약속 X** — 탭 진입 시 fresh fetch (dirty 시 skip)
- **약속 Y** — `justLoadedRef` 신호로 load 가 dirty 만들지 않음
- **휴지통** — soft-delete 무기한 보존, admin 이 `/projects/trash/purge` 수동 영구삭제

세부 결정/원인 추적: `CHANGELOG.md` + 인라인 단계 표기 (R3.e-2-fix, B 안 등) + commit 메시지.

## 환경 변수 (Worker Secrets)

| 이름 | 용도 |
|---|---|
| OPENAI_API_KEY | GPT API (교정/자막) |
| GEMINI_API_KEY | Gemini (편집가이드) |
| ADMIN_EMAILS | admin 이메일 화이트리스트 (휴지통 등 권한 제어) |

## KV 바인딩

| 바인딩 | 용도 |
|---|---|
| SESSIONS | 11 탭 데이터 (`s:<id>:<tab>`), `project_index`, `shoot_index`, 활성 사용자 (`active:<id>`), 단어장 (`shared_dict`), 팀 (`team_*`) |

## 테스트

```bash
cd worker
node --test __tests__/mergeTabData.test.js __tests__/errorMessages.test.js \
            __tests__/permissions.test.js __tests__/tabs.test.js \
            __tests__/xss_payloads.test.js
```

현재 94/94 pass.
