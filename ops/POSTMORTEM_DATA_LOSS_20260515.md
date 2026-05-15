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
