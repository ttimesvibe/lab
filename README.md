# lab — fresh v2 영상 인터뷰 콘텐츠 후반 작업 통합 CMS

> ttimesvibe/editor (PROD) 의 v2 진화 사료를 fresh 시작 시점에서 재해석한 v2.
> evolution layers 0. v3/v4 의 디딤돌.

## 운영 사료 (★ 첫 정독 의무)

본 lab 의 모든 architecture / 모듈 / 구현 계획 / 검증 매트릭스는 다음 master doc 에 박제:

- **`editor/ops/lab-v2-fresh-2026-05-09.md`** — master doc (S1.0 ~ S5.9, ~3700 줄)
- **`cms-v2-plan/_meta/CHARTER_11TABS_EQUAL_v1.md`** — 헌장 v1.1
- **`cms-v2-plan/_meta/POSTMORTEM_20260506_HOTFIX_RACE.md`** — 영구 8 룰
- **`cms-v2-plan/03_PRD/revised_PRD.md`** — prod v2 PRD 1235 줄

## 환경

| 항목 | 값 |
|---|---|
| Worker | `lab` (Cloudflare account `fb0a10864393158e940b149b3ead37f6` ttimesvibe) |
| Worker URL | `https://lab.ttimes.workers.dev` |
| KV namespace | `lab-sessions` (id `fbb8da8adcae4ee0a555abff66f798ac`) |
| Pages | `https://ttimesvibe.github.io/lab/` (예정) |
| Git remote | `https://github.com/ttimesvibe/lab` |

## 디렉터리

- `worker/` — Cloudflare Worker (35+ endpoint + merge.js + permissions.js + 단위 테스트 88+)
- `docs/` — Frontend (React 18 + vite 6 + 11 탭 + save engine + 단위 테스트)
- `.githooks/pre-push` — drift guard 양방향 + 단위 테스트 통과 검증
- `ops/` — 운영 사료 (architecture / 마일스톤 / audit / postmortem) — 마일스톤마다 박제

## 명령

```bash
# 단위 테스트 (worker)
cd worker && node --test __tests__/*.test.js

# Frontend 빌드 (drift guard 양방향)
cd docs && npm install && npm run build

# Worker 배포 (사용자 명시 승인 후)
cd worker && CLOUDFLARE_ACCOUNT_ID=fb0a10864393158e940b149b3ead37f6 npx -y wrangler deploy

# Worker 로그 실시간
cd worker && CLOUDFLARE_ACCOUNT_ID=fb0a10864393158e940b149b3ead37f6 npx -y wrangler tail

# 헬스체크
curl -s https://lab.ttimes.workers.dev/health | head -3

# pre-push 검증 (수동)
bash .githooks/pre-push
```

## 절대 금지

- `wrangler.toml` 에 `[placement]` 블록 추가 (대시보드 region 설정 GCP US 가 덮어씀)
- 임시 디렉터리 (`%TEMP%/...`) 에서 빌드 (4/24 drift 사고 트리거)
- 사용자 명시 동의 없이 PROD editor (`alleditor.ttimes6000.workers.dev`) 영향 영역 변경
- 사용자 명시 동의 없이 git push (POSTMORTEM Rule 1)

## 디시플린 (POSTMORTEM 영구 8 룰)

1. **push 승인 분리** — commit OK, push 별도 명시 승인
2. **부수 효과 의무 검토** — useCallback/useEffect/useMemo deps 전이 그래프
3. **100+K~N 시나리오 의무** — 새 변경마다 검증, 결과 박제 후 push
4. **단위 테스트 → 라이브 분리** — 라이브 검증 없이 자신감 보고 X
5. **Postmortem 의무** — 사용자 분노 시 즉시 사후 분석 박제
6. **무단 push 시 즉시 자기 보고** — 사용자 발견 전 죄 인정
7. **사용자 질문 = 분석 요청** — 자의 코드 수정 X
8. **헌장 정합 사전 검증 의무** — 모든 plan/변경/결정 시점에 헌장 한 줄씩 대조

## 사용자 결정 ~40 건 (S3.8 + S5.6)

핵심 결정 (영구 박제):
- 이름 = `lab` (옵션 2, "editor" 단어 충돌 0)
- KV 마이그레이션 = 90 keys 전부 (옛 `editor-sessions` → `lab-sessions`)
- OPENAI/GEMINI 키 = prod 와 공유
- **JWT_SECRET = 별도** (test 토큰이 prod 와 안 섞이게)
- Pages = prod 동일 형식
- 로컬 폴더 = OneDrive 안
- Phase 3 옛 환경 정리 = 사용자 명시 "맨 마지막" defer
- Phase Option = **C** (모듈 분리 우선 + Phase 통합) — Stage 1~7 / M1~M4 마일스톤
