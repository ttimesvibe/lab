// lab fresh v2 — frontend 한글 에러 매핑
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S3.2 D2 + S4c.4 E9)
//
// 책임:
//   - 영문 에러 → 한글 매핑
//   - SaveFailModal / RestoreModal / 토스트 등 사용자 노출용
//   - 인프라 용어 ("KV not configured" 등) 차단

const ERROR_MAP = Object.freeze({
  "Failed to fetch": "인터넷 연결이 끊어졌을 수 있습니다.",
  "NetworkError": "네트워크 오류가 발생했습니다. 와이파이를 확인하세요.",
  "401": "로그인이 만료되었습니다. 다시 로그인해주세요.",
  "403": "이 프로젝트에 저장 권한이 없습니다.",
  "404": "프로젝트를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.",
  "409": "다른 편집자가 먼저 저장했습니다.",
  "500": "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.",
  "502": "서버 연결이 일시적으로 불안정합니다.",
  "503": "서버가 잠시 점검 중입니다. 잠시 후 다시 시도해주세요.",
  "KV not configured": "서버 저장소 설정에 문제가 있습니다. 관리자에게 알려주세요.",
});

const DEFAULT_MSG = "알 수 없는 문제가 발생했습니다. 백업 파일을 먼저 저장해주세요.";

/**
 * Translate an error to a Korean user-facing message.
 *
 * @param {string|Error|number|null|undefined} err
 * @returns {string}
 */
export function translateError(err) {
  if (err === null || err === undefined) return DEFAULT_MSG;

  let msg;
  if (typeof err === "string") msg = err;
  else if (typeof err === "number") msg = String(err);
  else if (err && err.message) msg = String(err.message);
  else msg = String(err);

  // exact match
  if (ERROR_MAP[msg]) return ERROR_MAP[msg];

  // status code (숫자만 ^\d{3}$)
  const numMatch = /^\s*(\d{3})\s*$/.exec(msg);
  if (numMatch && ERROR_MAP[numMatch[1]]) return ERROR_MAP[numMatch[1]];

  // partial match (substring)
  for (const key of Object.keys(ERROR_MAP)) {
    if (msg.includes(key)) return ERROR_MAP[key];
  }

  return DEFAULT_MSG;
}

/**
 * Translate a list of error labels (탭 이름 등) to user-friendly Korean labels.
 * 사료 S2.2.b PROJECT_TAB_KEYS 11 + 사용자 노출 한글 라벨.
 */
export const TAB_LABEL_KO = Object.freeze({
  meta: "메타",
  manuscript: "원고",
  review: "0차 검토",
  correction: "1차 교정",
  script: "스크립트",
  guide: "편집 가이드",
  highlight: "하이라이트",
  visual: "자료·그래픽",
  setgen: "세트",
  modify: "수정사항",
  metadata: "메타데이터",
  subtitle: "자막",
});

export function tabLabelKo(tab) {
  return TAB_LABEL_KO[tab] || tab || "(알 수 없음)";
}
