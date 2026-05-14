// CMS v2 — 에러 메시지 한글 매핑 (D2 요구: 컴맹 친화)
// 묶음 ① ½ + ⑦
// 사용: import { translateError } from "./errorMessages";

export const ERROR_MESSAGES = {
  // 네트워크
  "Failed to fetch": "인터넷 연결이 끊어졌을 수 있습니다.",
  "NetworkError": "네트워크 오류가 발생했습니다. 와이파이를 확인하세요.",
  "TypeError: Failed to fetch": "인터넷 연결이 끊어졌을 수 있습니다.",
  "AbortError": "요청이 취소되었습니다.",
  // HTTP 상태 코드
  "401": "로그인이 만료되었습니다. 다시 로그인해주세요.",
  "403": "이 프로젝트에 저장 권한이 없습니다.",
  "404": "프로젝트를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.",
  "409": "다른 편집자가 먼저 저장했습니다.",  // 별도 ConflictModal 트리거
  "413": "데이터가 너무 큽니다. 작은 단위로 나누어 저장해주세요.",
  "429": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "500": "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.",
  "502": "서버 연결이 일시적으로 불안정합니다.",
  "503": "서버가 잠시 점검 중입니다. 잠시 후 다시 시도해주세요.",
  "504": "서버 응답이 늦습니다. 잠시 후 다시 시도해주세요.",
  // Worker / 인프라
  "KV not configured": "서버 저장소 설정에 문제가 있습니다. 관리자에게 알려주세요.",
  "id required": "프로젝트가 선택되지 않았습니다. 대시보드에서 다시 선택해주세요.",
  "deleted": "이 프로젝트는 삭제되었습니다.",
  "conflict": "다른 편집자가 먼저 저장했습니다.",
  // 머지 무결성
  "merge invariant violation": "데이터 검증에 실패했습니다. 작업 내용을 백업한 뒤 새로고침하세요.",
};

export const DEFAULT_MESSAGE = "알 수 없는 문제가 발생했습니다. 백업 파일을 먼저 저장해주세요.";

/**
 * 에러 객체 또는 status code 를 한글 메시지로 변환.
 * @param {Error|string|number} err
 * @returns {string}
 */
export function translateError(err) {
  if (err == null) return DEFAULT_MESSAGE;
  // 숫자 status code
  if (typeof err === "number") return ERROR_MESSAGES[String(err)] || DEFAULT_MESSAGE;
  // Error 객체
  const status = err.status || err.code;
  if (status && ERROR_MESSAGES[String(status)]) return ERROR_MESSAGES[String(status)];
  const msg = err.message || (typeof err === "string" ? err : "");
  // 정확 매칭
  if (ERROR_MESSAGES[msg]) return ERROR_MESSAGES[msg];
  // 부분 매칭 (포함 여부)
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (msg.includes(key)) return value;
  }
  return DEFAULT_MESSAGE;
}

// 탭 ID → 한글 라벨
export const TAB_LABELS = {
  meta: "메타",
  manuscript: "원고",
  correction: "1차 교정",
  subtitle: "자막",
  script: "스크립트",
  review: "0차 검토",
  highlight: "하이라이트",
  guide: "편집 가이드",
  setgen: "세트",
  metadata: "메타데이터",
  visual: "자료·그래픽",
  modify: "수정사항",
};

export function tabLabel(tabId) {
  return TAB_LABELS[tabId] || tabId;
}
