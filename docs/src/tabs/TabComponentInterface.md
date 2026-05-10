# TabComponentInterface — lab fresh v2 11 탭 컴포넌트 표준

> **사료**: editor/ops/lab-v2-fresh-2026-05-09.md
> - 헌장 §5: 11 탭 동등
> - 헌장 §6: 부모/자식 카테고리 거부 (코드 위치 차이의 잔재 폐기, S1.10.2.a)
> - R Phase R2.a 보강: TabComponentInterface 박제
> - S5.1 A12: tabs/ 11 컴포넌트 단일 패턴

---

## 1. 모든 11 탭 컴포넌트의 표준 props 시그니처

```jsx
function <Name>Tab({
  tabId,         // string  — worker tab key (TAB_KEYS, "review" / "correction" / ...)
  data,          // object | null — 현재 탭 데이터 (TAB_SCHEMAS[tab].fields, KV envelope 포함 가능)
  onSave,        // (data) => void — 사용자 입력 시 호출 (★ engine.markDirty + applyState)
  sessionId,     // string  — 프로젝트 ID
  config,        // object  — { workerUrl, apiMode, ... }
  currentTab,    // string  — 현재 활성 탭 (display 분기용)
  authUser,      // object  — { sub, name, role } (인증)
}) {
  // ...
}
```

## 2. 절대 원칙 (헌장 §5 + §6)

### 2.1 모든 11 탭 동등 (헌장 §5)
- 모든 탭이 **같은 props 시그니처** (위 7 개)
- 모든 탭이 **같은 onSave 패턴** (★ engine 호출 → markDirty + applyState)
- 모든 탭이 **같은 컴포넌트 위치** (`tabs/` 폴더)

### 2.2 자체 fetch 금지 (헌장 약속 X)
- ★ 자식 컴포넌트가 자체 `apiLoadTab` 호출 X
- 모든 fetch = `engine.enterTab(tab)` 단일 책임 (호출자 = App.jsx)
- 자식은 `data` prop 만 사용

### 2.3 자체 자동저장 금지 (헌장 §1)
- ★ 자식 컴포넌트가 자체 setTimeout / debounce 호출 X
- 모든 throttle = `engine.markDirty(tab)` → `engine` 의 cascading throttle
- 자식은 `onSave(data)` 만 호출

### 2.4 부모/자식 카테고리 폐기 (헌장 §6 + S1.10.2.a)
- ★ 옛 prod 의 "부모 직접 state" vs "자식 exportCache" 분리 X
- 모든 탭 = 같은 컴포넌트 패턴 + 같은 state 위치 (`state.tabData[tab]`)

### 2.5 useCallback 안정화 (사고 D 회피, S1.6)
- onSave 콜백은 `useCallback` 으로 안정화 (호출자 책임)
- inline arrow 함수 X (★ 결함 A 회피)

## 3. 컴포넌트 안 패턴

### 3.1 데이터 변경 (사용자 입력 시)
```jsx
function CorrectionTab({ tabId, data, onSave, ...rest }) {
  const handleBlockChange = (blockIndex, newText) => {
    const newBlocks = data.blocks.map((b) =>
      b.index === blockIndex ? { ...b, text: newText } : b
    );
    onSave({ ...data, blocks: newBlocks });  // ★ engine.markDirty 자동
  };
  // ...
}
```

### 3.2 LLM 호출 (예: /correct)
```jsx
function CorrectionTab({ tabId, data, onSave, sessionId, config, ...rest }) {
  const handleAnalyze = async () => {
    const r = await apiAnalyze({ text: data.text }, config);
    if (r.success) {
      onSave({ ...data, anal: r.data });
    }
  };
  // ...
}
```

### 3.3 표시 분기 (currentTab 사용)
```jsx
function VisualTab({ tabId, currentTab, data, onSave, ...rest }) {
  // 본 탭이 활성 X → 무조건 렌더 안 함 (상위 라우팅이 처리)
  // currentTab 은 표시 영역 분기 (예: 인서트 sub-tab) 에 사용
  const subTab = ...;
  // ...
}
```

## 4. 11 탭 카탈로그

| Worker Tab | UI Tab | Step | Internal | Component |
|---|---|---:|---|---|
| `meta` | (X) | (X) | ✅ | (없음 — engine 자동 관리) |
| `manuscript` | (X) | (X) | ✅ | `ManuscriptTab.jsx` (raw 표시) |
| `review` | review | 0 | | `ReviewTab.jsx` |
| `correction` | correction | 1 | | `CorrectionTab.jsx` |
| `subtitle` | script | 2 | | `ScriptTab.jsx` (subtitle worker key 매핑) |
| `guide` | guide | 3 | | `GuideTab.jsx` |
| `visual` | visual | 4 | | `VisualTab.jsx` |
| `modify` | modify | 5 | | `ModifyTab.jsx` |
| `highlight` | highlight | 6 | | `HighlightTab.jsx` |
| `setgen` | setgen | 7 | | `SetgenTab.jsx` |
| `metadata` | (X) | (X) | ✅ | `MetadataTab.jsx` (자동 추출 + 수동 편집) |

## 5. §5 단위 테스트 의무 (R4 보강)

`save/__tests__/charter.test.js` 에서 자동 검증:

```js
test("§5-4: TabComponentInterface 의 props 시그니처가 모든 탭 컴포넌트와 일치", () => {
  for (const tab of TAB_KEYS) {
    if (TAB_MAP[tab].internal && tab === "meta") continue;  // meta 는 컴포넌트 X
    // 컴포넌트 정의 + props 시그니처 매핑 검증
  }
});
```

## 6. 변경 이력

- 2026-05-10: M2.4 baseline 박제 (M1 worker baseline 235/235 PASS + M2.1~M2.3 utils/save/components 완료 시점).
