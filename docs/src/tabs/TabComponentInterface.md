# TabComponentInterface — 11 탭 컴포넌트 props 표준

> 헌장 v1.1 §5 (11 탭 동등) / §6 (부모/자식 카테고리 거부) 의 영구 보장.
> 본 인터페이스 변경 시 사용자 명시 승인 필수.

---

## 책임

모든 탭 컴포넌트 (`ReviewTab` / `CorrectionTab` / `ScriptTab` / `GuideTab` / `HighlightTab` / `SetgenTab` / `VisualTab` / `ModifyTab` / `MetadataTab` / `ManuscriptTab` / `SubtitleTab`) 는 본 인터페이스를 따른다. 새 탭 추가 시 본 인터페이스 준수.

---

## 필수 props

| prop | 타입 | 설명 |
|---|---|---|
| `tabId` | `string` | 11 탭 중 하나 (`utils/tabSchemas.js` 의 `TAB_IDS`) |
| `data` | `object` \| `undefined` | 현재 탭 데이터. `TAB_SCHEMAS[tabId].fields` 의 객체 |
| `onSave` | `(newData: object) => void` | 사용자 입력 발생 시 호출. 부모가 `tabData[tabId]` 갱신 |

## 선택 props

| prop | 타입 | 설명 |
|---|---|---|
| `currentTab` | `string` | 현재 활성 탭 (display 분기 / 자체 fetch 가드 등) |
| `sessionId` | `string` | KV 세션 ID (자체 KV 호출 시) |
| `config` | `object` | Worker URL / API 모드 등 |
| `authUser` | `object` | 인증 정보 (필요 시) |
| `onAction` | `Record<string, function>` | 탭별 특화 액션 (예: review 의 `onProceedToCorrection`) |

---

## 사용 예시

```jsx
<ReviewTab
  tabId="review"
  data={tabData.review}
  onSave={(d) => updateTabData("review", d)}
  onAction={{
    onProceedToCorrection: () => { ... },
  }}
/>
```

---

## 절대 금지

- **부모 탭 / 자식 탭 카테고리 자체 X** — 모든 탭이 동일 시그니처. 외부에서 카테고리 구분 불가.
- **자체 KV PUT 직접 호출 X** — 데이터 저장은 `onSave` 통해 부모가 처리. 자체 fetch 도 부모가 trigger (M3 정식 후).
- **부모 state 직접 참조 X** — props 외 외부 closure 의존 X. 단 `utils/*` 의 헬퍼 / 컴포넌트 (`v2_modals` 등) import 는 OK.

---

## 변경 이력

- 2026-05-07 (R2.a 진입 시점) — 초안. ReviewTab 추출 시 신설.
