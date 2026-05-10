// lab fresh v2 — tabs/ 단일 진입점
// 사료: TabComponentInterface.md
// 11 탭 (worker keys) 의 컴포넌트 매핑.
// meta 는 컴포넌트 X (engine 자동 관리).

import { ReviewTab } from "./ReviewTab.jsx";
import { CorrectionTab } from "./CorrectionTab.jsx";
import { ScriptTab } from "./ScriptTab.jsx";
import { GuideTab } from "./GuideTab.jsx";
import { VisualTab } from "./VisualTab.jsx";
import { ModifyTab } from "./ModifyTab.jsx";
import { HighlightTab } from "./HighlightTab.jsx";
import { SetgenTab } from "./SetgenTab.jsx";
import { MetadataTab } from "./MetadataTab.jsx";
import { ManuscriptTab } from "./ManuscriptTab.jsx";

export {
  ReviewTab, CorrectionTab, ScriptTab, GuideTab, VisualTab,
  ModifyTab, HighlightTab, SetgenTab, MetadataTab, ManuscriptTab,
};

/**
 * Worker tab key → Component map (★ 헌장 §5 11 탭 동등 dispatch).
 * meta 는 component 없음 (engine 자동 관리).
 */
export const TAB_COMPONENTS = Object.freeze({
  review: ReviewTab,
  correction: CorrectionTab,
  subtitle: ScriptTab,        // ★ worker subtitle 키 ↔ UI script 탭
  guide: GuideTab,
  visual: VisualTab,
  modify: ModifyTab,
  highlight: HighlightTab,
  setgen: SetgenTab,
  metadata: MetadataTab,
  manuscript: ManuscriptTab,
  // meta: (없음 — engine 자동 관리)
});

/**
 * Get component for a worker tab key.
 */
export function getTabComponent(workerTab) {
  return TAB_COMPONENTS[workerTab] || null;
}
