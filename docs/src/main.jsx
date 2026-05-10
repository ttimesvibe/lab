// lab fresh v2 — React 진입점 + ErrorBoundary
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S5.1 A12)

import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[error-boundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", textAlign: "center" }}>
          <h1 style={{ fontSize: "32px", color: "#DC2626" }}>
            🚨 일시적인 오류가 발생했습니다
          </h1>
          <p style={{ fontSize: "18px", marginTop: "16px" }}>
            걱정하지 마세요. 작업물은 저장되어 있을 가능성이 높습니다.
            <br />
            페이지를 새로고침해보세요.
          </p>
          <button
            style={{
              fontSize: "18px",
              padding: "14px 24px",
              backgroundColor: "#3B82F6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "24px",
            }}
            onClick={() => window.location.reload()}
          >
            🔄 새로고침
          </button>
          <details style={{ marginTop: "24px", textAlign: "left", maxWidth: "600px", margin: "24px auto" }}>
            <summary style={{ cursor: "pointer", color: "#6B7280" }}>기술 정보</summary>
            <pre style={{ backgroundColor: "#F3F4F6", padding: "12px", borderRadius: "8px", overflow: "auto" }}>
              {String(this.state.error)}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
