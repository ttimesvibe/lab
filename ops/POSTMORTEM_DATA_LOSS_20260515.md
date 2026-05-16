# POSTMORTEM — 1차 교정 결과 손실 + 0차 검토 탭 죽음 (2026-05-15)

## 1. 증상

### 증상 A — 1차 교정 결과 손실
- 사용자가 1차 교정 진행 → 빨간 줄(diffs) 가득한 정상 상태 박제
- 다른 탭 갔다 오거나 공유 링크로 새 창 진입 시 빨간 줄 사라짐
- "LLM이 수행했던 모든 게 초기화" — diffs/anal 영역 손실

### 증상 B — 0차 검토 탭 죽음
- 새 프로젝트 + docx 업로드 → 0차 검토 탭 정상 활성화
- 1차 교정/하이라이트 등 다른 작업 정상
- CMS(프로젝트 목록)로 나갔다 다시 들어오면 0차 검토 탭 비활성화

## 2. 원인 — 두 가지 별 영역

### 원인 A — `_stableId` 누락 (worker 머지 로직)

`worker/merge.js` 의 `array_stable_id_union` 머지 전략:
```js
const idFn = (item) => item._stableId ?? fallbackKeySync(item, "diffs");
// fallbackKey for diffs = `${blockIndex}|${posStart}|${posEnd}|${kind}`
```

- 코드 주석에 "AI 생성 항목 (correction.diffs) 은 이미 _stableId 가 박혀 있다" 명시
- 실제론 `_stableId` 박제 코드가 코드베이스 전체에 0건
- 또한 `/correct` 응답의 chunk 구조에 `blockIndex/posStart/posEnd/kind` 필드 없음
- → 모든 diffs 항목이 fallback key `"||||"` 동일 → `arrayIdUnion` Map에서 1개로 압축
- log 증거: PUT `diffs=29` → fresh load `diffs=1`

다른 `array_stable_id_union` 영역 (hl/clips/visualGuides 등) 은 fallback key 필드가 실제 데이터에 박혀 있어 손실 없음. diffs만 비대칭 결함.

### 원인 B — mount load의 자동 0차 검토 생성 영역에서 PUT 누락

새 프로젝트 흐름:
1. NewProjectModal → `/projects/create` → App.jsx `handleFile(text, fn)`
2. 다음 mount 시 L766-797 분기 진입 (correction 비어있음 + manuscript 있음 조건)
3. 자동으로 `setReviewData(...)` 호출 — 0차 검토 탭 활성화

문제: 이 호출 시점이 mount load 도중 = `isInitialLoad.current = true`
- dirty 마킹 useEffect (L843) 가 `if (isInitialLoad.current) return;` 로 skip
- 사용자 변경이 아니라고 판단해서 dirty 안 만듦
- 30초 자동저장 fire 안 됨 → **KV.review 영원히 빈 상태**

다음 mount 시 영향:
- mount load의 stages filter (L716-718): `meta.stages` 키만 KV에서 fetch
- KV.review가 한 번도 저장 안 됐으니 `stages.review = false`
- review 탭 fetch X → state.reviewData = null → 탭 비활성화
- 같은 분기가 또 발동해도 또 PUT 안 됨 → 닭-달걀 영역

## 3. 부수 원인 — L1493 await 누락

1차 교정 완료 (`handleCorrectStart` L1469-1496) 영역:
```js
setDiffs(ad);
autoSaveToKV({ diffs: ad });    // ← await 없음, fire-and-forget
```

- PUT 완료 전 사용자 탭 이동 → fresh fetch 가 빈 KV 덮어쓰기 위험
- _stableId 본질 fix와 별 영역이지만 race 잠재 영역으로 묶어서 봉합

## 4. 수정 — 5 commit

| commit | 영역 | 내용 |
|---|---|---|
| `e459696` | App.jsx L1493 | `await autoSaveToKV({ diffs: ad })` — PUT 완료 보장 |
| `9e0b3b4` | App.jsx L1004 | `save PAYLOAD correction` sizeHint에 `diffs=N anal=Y/N` 추가 |
| `e9d8332` | App.jsx L1491 | `ad.map((d,i) => ({ ...d, _stableId: ... }))` — 진짜 본질 봉합 |
| `1868317` | App.jsx L1871/1888/1898 | `onFileUpload` 영역 setReviewData 직후 `await autoSaveToKV({reviewData})` |
| `fd38643` | App.jsx L780/797 | **mount load 자동 0차 검토 생성 영역** setReviewData 직후 `await autoSaveToKV({reviewData})` ★ 진짜 본질 |

## 5. 검증

### 1차 교정 손실 (원인 A)
log 박제:
```
[L1493 본 fix PUT] save PAYLOAD correction: blocks=31 diffs=22 anal=Y
[save RESULT] success=1
[fresh fetch] tabFresh loaded: correction ... blocks=31 diffs=22 anal=Y   ← ★ 22 그대로
```
화면: 빨간 줄 정상 유지 ✓

### 0차 검토 (원인 B)
log 박제:
```
[mount load 후] save PAYLOAD review: keys=[hasTrackChanges,...,reviewBlocks,...]
[save RESULT] success=1
[다음 mount] load LOADED review: keys=[...]   ← ★ KV.review 정상 박제
```
화면: 0차 검토 탭 활성화 유지 ✓

## 6. 누적 분석 패턴 박제

### 추측 누적 → 사용자 명시 원칙 위반

본 세션 중반까지 가설 박제 → 사용자 데이터 반증 → 또 가설 → 또 반증 패턴 반복. 사용자 명시 원칙 ("추측 X") 위반.

진짜 본질 식별 시점 = log + 코드 + 사용자 시나리오 결합 박제 시점:
1. **build hash 구분 의무** — `yx4nysrZ` / `CwVbFKr-` / `CDwa8A9Q` / `CteE38P-` / `COK78JpD` — 사용자가 보내는 log의 build hash를 매번 확인하지 않아 시점 혼동
2. **session id 구분 의무** — `1v5410251n6d6` / `642j4z2c2o4d5` / `3v1u38w3bu16` / `cyw264t123q` / `7111ze6o2u3r` — 한 콘솔에 여러 세션 log 혼재
3. **호출 경로 추적 의무** — `handleProcessFile` (없음) / `onFileUpload` / `handleFile` / mount load 자동 생성 분기. 어느 경로가 실제 fire되는지 확인 없이 fix 적용
4. **빌드 직접 검증 의무** — fix 적용 후 빌드 산물에 실제 박제됐는지 grep 검증

### 진짜 본질 식별 트리거 — 사용자 직관

| 시점 | 사용자 직관 | 효과 |
|---|---|---|
| "1차 수정 끝나면 바로 저장 명령 하나 넣으면?" | L1493 await 발견 |
| "당신의 가설이 틀렸다는 거 아님?" (hl/clips 손실 X) | _stableId 본질 발견 |
| "다른 작업 하고 CMS 나갔다 들어오면 0차 검토 죽음" | mount load 자동 생성 분기 발견 |

사용자 시나리오 명시가 가설 영역을 매번 좁힘. 추측 누적보다 사용자 시나리오 박제 우선.

## 7. 잠재 영역 (미 fix)

- **L1714 하이라이트 생성 영역** — 같은 await 누락 패턴. 단 손실 보고 X → 미 fix (사용자 명시 원칙)
- **L1449 Step 0 metadata 영역** — 같은 await 누락 패턴. 단 손실 보고 X → 미 fix
- **다른 AI 생성 항목의 _stableId** — guide.hl / highlight.clips / visualGuides 등. 단 fallback key 필드가 실제 데이터에 박혀 손실 X → 미 fix

## 8. prod editor repo cherry-pick 의무

lab = prod editor clone 영역. 본 5 commit 모두 prod에 같은 결함 잠재. 사용자 명시 원칙 8 (test → prod promote) 정합 — lab 검증 완료 후 prod cherry-pick 의무.

대상 commit:
- `e459696` L1493 await
- `9e0b3b4` 진단 log
- `e9d8332` _stableId 박제 ★
- `1868317` onFileUpload review PUT
- `fd38643` mount load review PUT ★

## 9. 사후 의무

- **`_stableId` 박제 위치 박제** — AI 생성 항목 응답 시점 / 클라 setter 직전 중 단일 위치 결정. 본 fix는 클라 setter 직전. worker `/correct` 응답에서 박제하는 영역으로 옮기면 일관성 강화 가능 (추후 검토)
- **mount load 자동 생성 분기 영역 일반화** — 0차 검토 외 다른 자동 생성 분기 있는지 검토 (현재 review만 발견)
- **isInitialLoad 영역의 dirty skip 정합 영역 재검토** — 약속 Y 의미론과 충돌. 본 fix는 명시 await PUT으로 우회. 의미론 정리 의무

---

## 10. 추가 발견 — highlight.clips 삭제 박스 부활 결함 (2026-05-15 영역 2)

### 증상
사용자 보고 — highlight 탭에서 박스 생성 → X 클릭 삭제 → 새 박스 추가 시 삭제된 박스와 새 박스가 동시 표시. fresh load 후 삭제 박스 부활.

log 박제 (prod build `BJVOmFuU`):
```
clips=13 → 8 → 7 → 6 (사용자 삭제 진행)
fresh load → clips=13 (부활)
```

### 원인 — worker `array_stable_id_union` 의 union 의미론

```js
// worker/merge.js
highlight: { clips: { kind: "array_stable_id_union", entityType: "hl" } }
```

`arrayIdUnion(existingArr, incomingArr, idFn)` = **합집합**. PUT body에 없는 항목도 KV에 있으면 보존.

시나리오 정합:
1. state.clips = [A, B, C, D] → PUT [A,B,C,D] → KV [A,B,C,D]
2. 사용자 C 삭제 → state.clips = [A, B, D] → PUT [A,B,D]
3. worker union: KV[A,B,C,D] ∪ PUT[A,B,D] = ★ [A,B,C,D] (C 부활)
4. fresh load → state [A,B,C,D] → 화면 4개 (삭제 박스 부활)

### 옛 앱과의 비교

`ttimes-hilight/worker/index.js` L135:
```js
await env.SESSIONS.put("save_" + id, JSON.stringify(body.session));
```

= 통째 덮어쓰기 (last_write_wins). 단일 사용자 정상 동작. **본 결함 없음**.

### 정밀 분석 — R3 / 자식 추출 / 스파게티 정리 영역에서 왜 못 봤나

#### 영역 1 — 같은 머지 함수의 결함이 이미 한 번 봉합됨 (commit `9a6cef0`, 2026-05-09)
- 이전 사용자 보고: "저장 → 나갔다 들어오면 마지막 1개만 남음"
- 원인: fallbackKeySync 키 mismatch → 모든 항목 `"|||"` 충돌 → Map.set 마지막 덮어쓰기
- fix: `id` universal 분기 추가 (`fallbackKeySync` 첫 줄)
- ★ **단 union 의미론 자체는 그대로** — "추가 손실" 봉합에만 집중, "삭제 손실" 영역 미검증

#### 영역 2 — 같은 결함 3회 발견, 의미론 전체 재검토 영역 X

| 시점 | 표면 결함 | fix | 머지 의미론 |
|---|---|---|---|
| `9a6cef0` (2026-05-09) | 추가 1개로 압축 | id 분기 | 그대로 |
| 본 세션 #1 (2026-05-15) | diffs 1개로 압축 | `_stableId` 박제 | 그대로 |
| 본 보고 #2 (2026-05-15) | 삭제 박스 부활 | 미 fix | 그대로 ★ |

★ 매번 별 표면 결함으로 진단 + 봉합. 머지 함수 전체 재검토 영역 의무 박제 X.

#### 영역 3 — 옛 앱과의 의미론 비교 부재
- 옛 앱 (ttimes-hilight) = `last_write_wins` (통째 PUT) — 단일 사용자 정상
- 통합 CMS = `array_stable_id_union` — 멀티유저 union 도입
- R3 / 통합 시점에 머지 의미론을 **의도적으로 변경** — 단 trade-off 박제 X:
  - 얻은 영역 (멀티유저 동시 추가 보존) 명시
  - **잃은 영역 (단일 사용자 삭제 의미론) 박제 X**

#### 영역 4 — 테스트 시나리오 영역 부족
worker `__tests__/mergeTabData.test.js` 47 PASS:
- ✓ 두 클라가 추가 → 합집합
- ✓ 한 클라 추가, 다른 클라 수정 → 머지
- ✓ id-fallback 회귀 (1개로 압축 회피)
- ★ **한 클라가 삭제 시나리오 — 박제 0**

= 테스트가 union의 "추가만" 의미론 전제. "삭제" 시나리오 박제 의무 X.

#### 영역 5 — R3 검증 영역의 범위
R3.b-diag / R3.c-prep / R3.d.2.* 모두 **클라이언트 영역** 사고 (무한 루프 / closure stale / useState 통합 / dirty 마킹). worker `merge.js` 영역의 검증 = R3 범위 밖. 헌장 §5/§6 "11 탭 동등"도 클라 영역만 박제.

#### 영역 6 — 헌장의 의미론 명시 부재
- §1 30s cascading throttle
- §2 약속 X (fresh fetch)
- §5/§6 11 탭 동등 dispatch
- ★ **"삭제 시 KV 정합" 영역 박제 0**

사용자 의도 영역 (삭제 동작) 명시 X → 머지 의미론 검증 의무 박제 X.

### 영향 잠재 영역

같은 union 머지 영역의 모든 항목 = 같은 결함 잠재:

| 탭.필드 | 결함 발현 |
|---|---|
| **highlight.clips** | ★ 사용자 보고 발현 |
| guide.hl | (AI 생성, 사용자 삭제 영역 사용 X) — 잠재 |
| visual.visualGuides / insertCuts / manualResources | 사용자 삭제 영역 사용 시 발현 |
| modify.cards | 사용자 삭제 영역 사용 시 발현 |
| correction.diffs | (AI 생성, 사용자 삭제 영역 X) — 잠재 |

### 해결 옵션

**옵션 A** — `highlight.clips: { kind: "last_write_wins" }` (옛 앱 정합)
- 장점: 단일 사용자 정상, 단순, 위험 0
- 단점: 멀티유저 동시 추가 영역 손실 (실제 사용 빈도 거의 0)

**옵션 B** — Tombstone 메커니즘 (CRDT)
- 장점: 멀티유저 + 삭제 둘 다 정합
- 단점: 클라/worker 양쪽 영역 변경 큼

**옵션 C** — Hybrid (PUT body `_replace` flag)
- 장점: 멀티유저 보존 + 사용자 명시 영역 정합
- 단점: 클라 영역 영역 영역 변경 의무

### 사후 의무 (본 영역)
- 머지 의미론 trade-off 박제 (사용자 결정 박제)
- 헌장 영역에 "삭제 시 KV 정합" 영역 추가 박제
- 테스트 영역에 삭제 시나리오 박제 의무
- 옛 앱과 통합 CMS 의미론 비교 사료 박제

---

## §11. 추가 발견 — dead 분기 audit (2026-05-16 영역 3)

### 증상
사용자 명시 — "자료 탭이 옛 영역에 박제됐다가 중간에 없앴음". 단 자료 탭 재도입 의무 영역에서 코드 영역 박제:

| 위치 | 상태 |
|---|---|
| `BlockComponents.jsx` L162 드롭다운 | 제거됨 (현재 [A,B,C_user] 박제) |
| `App.jsx` L1546 `type === "C1"` 분기 | ★ **코드에 남아있음 (dead)** |
| `GuideTab.jsx` L352 `type==="C1"` placeholder 분기 | ★ **코드에 남아있음 (dead)** |
| `GuideTab.jsx` L329 자막 추가 폼 탭 `["C1","자료"]` | 제거됨 |

= UI 입구만 막고 처리 로직은 안 지운 절반 청소. 사용자 눈에 안 보이지만 코드에는 잔존.

### git log 추적
- `dab4ec6` (2026-04-07): 자료 탭 추가 (type="C1")
- `5e91d7c` (2026-04-14): 라벨 "자료" → "추가 삭제" 변경
- (그 후): C1 탭 자체 제거 — commit 박제 못 찾음 (사료 영역 부재)

### R3 / 스파게티 정리에서 못 본 이유 (4 영역)

1. **정리 작업의 정의가 좁았음** — R3 / 스파게티 정리는 dirty 마킹 / closure stale / useState 통합 / 11 탭 동등 dispatch 영역에 초점. 단순 UI 라벨 / addForm 분기 / dead code 청소 영역 미포함
2. **자동 검출 불가** — `addForm.type === "C1"` 분기는 문법상 실행 가능 (외부 데이터로 type="C1" 들어올 수 있음) → ESLint dead code 검출 영역 X. 수동 audit 의무 영역
3. **C1 탭 제거 commit의 사료 부재** — 추가/라벨변경 commit은 박제됐는데 탭 자체 제거 commit 박제 영역 부재
4. **사용자 명시 원칙의 부작용** — "사용자 보고한 영역만 fix" 원칙 정합. 단 ★ 사용자에게 보이지 않는 결함은 검증 의무에서도 빠짐

### 본 fix 영역의 처리
C_user 신설 + C1 분기 유지 (옛 KV 데이터 정합 보존):
- 새 자료 항목 = type="C_user" 박제 → "자료" 표시
- 옛 KV의 type="C1" 항목 = "자막" 표시 (옛 displayCat 의미론 보존)

### 사후 의무
- **dead code audit** — 본 세션처럼 표면적 UI 제거 후 처리 분기 잔존 영역 발견 의무. 전체 코드베이스 grep 영역 의무
- **머지 의미론 audit** — array_stable_id_union 사용하는 다른 항목 (modify.cards / visualGuides / insertCuts / manualResources / guide.hl) 영역의 삭제 시나리오 박제 의무
- **헌장 영역 확장** — "삭제 시 KV 정합" / "dead code 금지" / "UI 제거 시 처리 분기도 같이 제거" 영역 박제

---

## §12. 운영 영역 박제 — KV PUT 한도 + 단어장 누적 (2026-05-16 영역)

### KV PUT 한도 초과 (운영 사료)

**증상**: lab worker 모든 endpoint 500 — `{"error":"KV put() limit exceeded for the day."}`

**원인**: Cloudflare Workers 무료 플랜 KV 한도:
- PUT (쓰기): 1,000/일
- READ: 100,000/일

본 세션 동안 lab 영역 PUT 누적:
- 1차 교정 / 0차 검토 재현 테스트 (여러 세션)
- highlight.clips 삭제/추가 재현 (매 박제마다 PUT)
- 자료 탭 재도입 재현 (hl=2→4→5→6, 매번 PUT)
- 30s cascading throttle 영역의 PUT 빈도

**본 세션 fix와 100% 무관** — 단순 운영 한도 초과.

**해결**: UTC 00:00 (한국 09:00) 카운터 리셋 대기 (사용자 명시 옵션 1).

**prod 영향 0**: prod (ttimes6000 계정) ≠ lab (ttimesvibe 계정) → 한도 별. lab 한도 초과 시 prod 정상 동작.

**잠재 개선 영역** (선택, 사용자 명시 X):
- 30s timer → 60s/120s 영역 영역
- 동일 데이터 PUT skip 영역 강화 (snapshot 비교 박제됨, 추가 강화 가능)
- 자동저장 dedupe 강화

### 단어장 누적의 정상 부수 효과

**증상**: Step 0 (사전 분석) 후 "AI 발견 오인식 후보 0건" 박제.

**원인**: handleAnalyze 영역 (L2057-2067):
```js
if (dictionary_words?.length > 0) {
  systemPrompt += "Team Dictionary (...) MUST EXCLUDE from term_corrections";
  for (const word of dictionary_words) {
    systemPrompt += `- "${word}"\n`;
  }
}
```

= AI에게 단어장 단어를 term_corrections에 포함하지 말 것 명시.

본 세션 동안 단어장 누적 박제 (log 영역):
```
📚 단어장에 5건 추가됨 (총 279건)
📚 단어장에 4건 추가됨 (총 288건)
📚 단어장에 1건 추가됨 (총 289건)
📚 단어장에 2건 추가됨 (총 291건)
```

같은 docx (박종천 테) 영역으로 여러 세션 재현 → term_corrections 단어가 모두 단어장에 자동 박제 → AI가 모두 제외 → **0건 박제 정합**.

**본 영역 = 결함 X, 정상 동작**. 모델 영역 / 본 세션 fix 영역과 모두 무관.

**검증 의무**: 다른 영상 (단어장에 없는 단어 박제 영역) 으로 검증 시 후보 박제 박제 가능.

**잠재 개선 영역** (선택):
- 단어장 일시 적용 안 함 옵션 (사용자 선택)
- 단어장 confidence 영역 (약한 매칭만 제외, 강한 매칭만 적용)

