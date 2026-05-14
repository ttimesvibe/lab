// lab fresh v2 — App.jsx (★ baseline 통합 — 인증 + 라우팅 + engine)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S5.1 A12: Frontend baseline (App.jsx 책임 = React state + UI + 라우팅)
//   - 헌장 §1~§5: engine 단일 책임 (App.jsx 는 markDirty / enterTab / saveNow 만 호출)
//   - S1.6 사고 D 회피: useCallback 안정화 + deps chain 0
//   - S2.4.1 라우팅: ?s=<sessionId> → editor / 없으면 dashboard
//   - 묶음 ① ½ D2 모달 4종 통합
//   - P0-05: handle401 — silent reload X, 모달 trigger
//
// 책임:
//   - 인증 (JWT decode + localStorage `ttimes_token`)
//   - 라우팅 (Login / Dashboard / Editor)
//   - engine 인스턴스 + bootstrap + dispose
//   - 11 탭 라우팅 (TAB_COMPONENTS)
//   - 4 모달 통합 (Save/Conflict/Restore/BackupList)
//   - polling 시작 + visibilitychange + pagehide leave + beforeunload 가드
//   - 다른 사용자 토스트
//
// 상태 모델:
//   tabData: { [tab]: data }   (★ 헌장 §6 단일 store)

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, saveConfig } from "./utils/config.js";
import {
  setToken, ApiError, apiErrorMessage,
  apiSaveTab, apiLoadTab, apiHeartbeat, apiLeave, apiLoadMeta,
  apiProjectList, apiProjectCreate, apiProjectDelete,
} from "./utils/api.js";
import { listBackups, getLatestBackup, deleteBackup } from "./utils/backup.js";
import { tabLabelKo } from "./utils/errorMessages.js";
import { TAB_KEYS, TAB_MAP, UI_TABS, uiToWorker, workerToUi } from "./save/tabs.js";
import { createSaveEngine } from "./save/engine.js";
import { TAB_COMPONENTS, getTabComponent } from "./tabs/index.js";
import {
  SaveFailModal, ConflictModal, RestoreModal, BackupListModal,
} from "./components/v2_modals.jsx";

// ─── JWT 디코딩 (검증 X — 서버 측 검증, 클라는 표시용) ──────────────────

function decodeJWT(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padding = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + padding).replace(/-/g, "+").replace(/_/g, "/");
    // ★ UTF-8 디코딩 — 한글 등 multi-byte 문자 정확 처리
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}

// ─── 메인 App ────────────────────────────────────────────────────────────

export function App() {
  const [config, setConfig] = useState(() => loadConfig());
  const [authUser, setAuthUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [view, setView] = useState("loading");  // loading / login / dashboard / editor

  // editor 상태
  const [sessionId, setSessionId] = useState(null);
  const [currentUiTab, setCurrentUiTab] = useState("review");  // UI 탭 (8 user-facing)
  const [tabData, setTabData] = useState({});

  // 모달 상태
  const [saveFailModal, setSaveFailModal] = useState(null);
  const [conflictModal, setConflictModal] = useState(null);
  const [restoreModal, setRestoreModal] = useState(null);
  const [backupListModal, setBackupListModal] = useState(false);

  // 다른 사용자 인디케이터
  const [activeUsers, setActiveUsers] = useState([]);

  // engine ref (★ 단일 인스턴스, 사고 D 회피)
  const engineRef = useRef(null);
  const tabDataRef = useRef(tabData);
  tabDataRef.current = tabData;

  // ─── 인증 ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem("ttimes_token");
    if (!token) {
      setView("login");
      return;
    }
    const payload = decodeJWT(token);
    if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
      localStorage.removeItem("ttimes_token");
      setView("login");
      return;
    }
    setAuthToken(token);
    setAuthUser({ sub: payload.sub, name: payload.name, role: payload.role });
    setToken(token);  // utils/api 의 _token 박제

    // URL ?s=<id> → editor
    const url = new URL(window.location.href);
    const s = url.searchParams.get("s");
    if (s) {
      setSessionId(s);
      setView("editor");
    } else {
      setView("dashboard");
    }
  }, []);

  // ─── engine 인스턴스 (★ 사고 D 회피 — sessionId/authUser 변경 시만) ──

  useEffect(() => {
    if (view !== "editor" || !sessionId || !authUser) return;
    if (!config.workerUrl) return;

    // RestoreModal — 진입 시 백업 검색
    const backups = listBackups().filter((b) => b.sessionId === sessionId);
    if (backups.length > 0) {
      const latest = getLatestBackup();
      if (latest && latest.sessionId === sessionId) {
        setRestoreModal({ backup: latest, totalCount: backups.length });
      }
    }

    const engine = createSaveEngine({
      sessionId,
      cfg: config,
      getUser: () => authUser,
      getState: () => ({ tabData: tabDataRef.current }),
      applyState: (tab, data) => {
        setTabData((prev) => ({ ...prev, [tab]: data }));
      },
      getCurrentTab: () => uiToWorker(currentUiTab),
      apiSaveTab,
      apiLoadTab,
      apiHeartbeat,
      apiLeave,
      apiLoadMeta,
      showConflictModal: (tab, modalData) => {
        setConflictModal({ tab, ...modalData });
      },
      onActiveUsers: setActiveUsers,
      onOtherUserToast: (info) => {
        // 토스트 — 5분 debounce 는 polling 안에서 자동
        console.log(`[multiuser] ${info.name}님이 ${tabLabelKo(info.tab)} 탭을 수정했습니다.`);
      },
      on401: () => {
        // P0-05: silent reload X — 모달 trigger
        localStorage.removeItem("ttimes_token");
        setAuthToken(null);
        setAuthUser(null);
        setView("login");
      },
      onMerged: (tab, mergedBy) => {
        // ★ N6 B10 토스트
        console.log(`[merged] ${mergedBy.name}님의 변경사항도 함께 저장되었습니다 (${tabLabelKo(tab)}).`);
      },
      onError: (err, ctx) => {
        if (err instanceof ApiError && err.status === 409) return;  // conflict 는 모달
        // 자동 저장 실패 — 토스트 또는 SaveFailModal
        if (ctx?.tab) {
          setSaveFailModal({
            failedTabs: [ctx.tab],
            error: err,
            payload: tabDataRef.current,
          });
        }
      },
    });

    engineRef.current = engine;
    engine.bootstrap(uiToWorker(currentUiTab));
    engine.startPolling();

    // visibilitychange + pagehide
    const onVisChange = () => engine.onVisibilityChange();
    const onPageHide = () => engine.leave();
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("pagehide", onPageHide);

    // beforeunload 가드 (★ 1차 백업, dirty 있을 때만)
    const onBeforeUnload = (e) => {
      if (engine.getDirtyTabs().size > 0) {
        e.preventDefault();
        e.returnValue = "저장되지 않은 변경사항이 있습니다. 정말 떠나시겠습니까?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      engine.dispose();
      engineRef.current = null;
    };
  }, [view, sessionId, authUser, config.workerUrl]);

  // ─── 콜백 (★ useCallback 안정화 — 사고 D 회피) ─────────────────────────

  const handleTabSave = useCallback((workerTab, newData) => {
    // 자식 탭 컴포넌트의 onSave callback
    setTabData((prev) => ({ ...prev, [workerTab]: newData }));
    if (engineRef.current) {
      engineRef.current.markDirty(workerTab);
    }
  }, []);

  // ★ 실 UI Phase 1: 다중 탭 동시 갱신 (ManuscriptTab 업로드 → manuscript + review)
  const handleMultiTabSave = useCallback((updates) => {
    if (!updates || typeof updates !== "object") return;
    setTabData((prev) => ({ ...prev, ...updates }));
    if (engineRef.current) {
      for (const tab of Object.keys(updates)) {
        engineRef.current.markDirty(tab);
      }
    }
  }, []);

  const handleUiTabChange = useCallback(async (newUiTab) => {
    setCurrentUiTab(newUiTab);
    const workerTab = uiToWorker(newUiTab);
    if (engineRef.current && workerTab) {
      // ★ 헌장 §2 탭 이동이 저장 막지 않음 (engine 가 자동 처리)
      // ★ 헌장 약속 X 탭 진입 fetch (dirty=false 일 때만)
      await engineRef.current.enterTab(workerTab);
    }
  }, []);

  const handleSaveButton = useCallback(async () => {
    if (!engineRef.current) return;
    const r = await engineRef.current.saveNow({ manual: true });
    if (r && r.failed.length > 0) {
      setSaveFailModal({
        failedTabs: r.failed.map((f) => f.tab),
        error: r.failed[0].error,
        payload: tabDataRef.current,
      });
    }
  }, []);

  // ─── 라우팅 ───────────────────────────────────────────────────────────

  if (view === "loading") {
    return <div style={{ padding: 32 }}>로딩 중…</div>;
  }
  if (view === "login") {
    return <LoginScreen onLogin={(token) => {
      const payload = decodeJWT(token);
      if (!payload) return;
      localStorage.setItem("ttimes_token", token);
      setAuthToken(token);
      setAuthUser({ sub: payload.sub, name: payload.name, role: payload.role });
      setToken(token);
      setView("dashboard");
    }} />;
  }
  if (view === "dashboard") {
    return <Dashboard
      authUser={authUser}
      config={config}
      onSelectProject={(id) => {
        setSessionId(id);
        setCurrentUiTab("review");
        setTabData({});
        const url = new URL(window.location.href);
        url.searchParams.set("s", id);
        window.history.pushState({}, "", url);
        setView("editor");
      }}
      onLogout={() => {
        localStorage.removeItem("ttimes_token");
        setAuthToken(null);
        setAuthUser(null);
        setView("login");
      }}
    />;
  }

  // editor
  const workerTab = uiToWorker(currentUiTab);
  const TabComponent = workerTab ? getTabComponent(workerTab) : null;
  const currentTabData = workerTab ? tabData[workerTab] : null;

  return (
    <div className="app-editor">
      <Header
        authUser={authUser}
        sessionId={sessionId}
        activeUsers={activeUsers}
        onSave={handleSaveButton}
        onBackToDashboard={() => {
          if (engineRef.current && engineRef.current.getDirtyTabs().size > 0) {
            if (!confirm("저장되지 않은 변경사항이 있습니다. 대시보드로 돌아가시겠습니까?")) return;
          }
          const url = new URL(window.location.href);
          url.searchParams.delete("s");
          window.history.pushState({}, "", url);
          setSessionId(null);
          setView("dashboard");
        }}
        onShowBackups={() => setBackupListModal(true)}
      />
      <TabBar uiTabs={UI_TABS} currentUiTab={currentUiTab} onChange={handleUiTabChange} />
      <main style={{ padding: 16 }}>
        {TabComponent ? (
          <TabComponent
            tabId={workerTab}
            data={currentTabData}
            allTabData={tabData}
            onSave={(newData) => handleTabSave(workerTab, newData)}
            onMultiSave={handleMultiTabSave}
            sessionId={sessionId}
            config={config}
            currentTab={workerTab}
            authUser={authUser}
          />
        ) : (
          <div>알 수 없는 탭: {currentUiTab}</div>
        )}
      </main>

      {/* ★ 4 모달 통합 */}
      <SaveFailModal
        visible={!!saveFailModal}
        failedTabs={saveFailModal?.failedTabs || []}
        error={saveFailModal?.error}
        payload={saveFailModal?.payload}
        sessionId={sessionId}
        projectName={tabData.meta?.fn}
        onRetry={async () => {
          setSaveFailModal(null);
          await handleSaveButton();
        }}
        onClose={() => setSaveFailModal(null)}
      />
      <ConflictModal
        visible={!!conflictModal}
        tab={conflictModal?.tab}
        serverUpdatedBy={conflictModal?.serverUpdatedBy}
        onForceSave={async () => {
          if (conflictModal?.forceSaveTab) {
            try {
              await conflictModal.forceSaveTab();
            } catch (e) {
              setSaveFailModal({
                failedTabs: [conflictModal.tab],
                error: e,
                payload: tabDataRef.current,
              });
            }
          }
          setConflictModal(null);
        }}
        onReceiveServer={() => {
          if (conflictModal?.receiveServer) conflictModal.receiveServer();
          setConflictModal(null);
        }}
        onClose={() => setConflictModal(null)}
      />
      <RestoreModal
        visible={!!restoreModal}
        backup={restoreModal?.backup}
        totalCount={restoreModal?.totalCount || 0}
        onRestore={() => {
          // 백업 복원
          if (restoreModal?.backup?.payload) {
            setTabData(restoreModal.backup.payload);
          }
          setRestoreModal(null);
        }}
        onShowList={() => {
          setRestoreModal(null);
          setBackupListModal(true);
        }}
        onSkip={() => setRestoreModal(null)}
      />
      <BackupListModal
        visible={backupListModal}
        onRestore={(key) => {
          // (생략 — 단순 stub)
          setBackupListModal(false);
        }}
        onClose={() => setBackupListModal(false)}
      />
    </div>
  );
}

// ─── LoginScreen (baseline stub) ─────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [token, setToken] = useState("");
  return (
    <div style={{ maxWidth: 400, margin: "80px auto", padding: 32, textAlign: "center" }}>
      <h1>lab fresh v2 로그인</h1>
      <p>★ baseline stub — auth Worker 연동 후속 마일스톤.</p>
      <input
        type="text"
        placeholder="JWT 토큰 직접 입력 (개발용)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        style={{ width: "100%", padding: 12, fontSize: 14, marginBottom: 12 }}
      />
      <button
        style={{ width: "100%", padding: 12, fontSize: 16, backgroundColor: "#3B82F6", color: "white", border: "none", borderRadius: 8 }}
        onClick={() => token && onLogin(token)}
      >
        로그인
      </button>
    </div>
  );
}

// ─── Dashboard (baseline stub) ───────────────────────────────────────────

function Dashboard({ authUser, config, onSelectProject, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await apiProjectList(config);
        if (!cancelled) setProjects(r.projects || []);
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [config]);

  async function handleCreate() {
    const fn = prompt("프로젝트 이름 (파일명):");
    if (!fn) return;
    try {
      const r = await apiProjectCreate({ fn }, config);
      if (r.id) onSelectProject(r.id);
    } catch (e) {
      alert(apiErrorMessage(e));
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "32px auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>lab fresh v2 Dashboard</h1>
        <div>
          {authUser?.name} <button onClick={onLogout}>로그아웃</button>
        </div>
      </header>

      <div style={{ marginTop: 16 }}>
        <button onClick={handleCreate}>+ 새 프로젝트</button>
      </div>

      {loading ? (
        <p>로딩 중…</p>
      ) : error ? (
        <p style={{ color: "red" }}>{error}</p>
      ) : projects.length === 0 ? (
        <p>프로젝트가 없습니다. [+ 새 프로젝트] 를 누르세요.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
          {projects.map((p) => (
            <li key={p.id} style={{
              padding: 12, marginBottom: 8, borderRadius: 8,
              border: "1px solid #E5E7EB", cursor: "pointer",
            }} onClick={() => onSelectProject(p.id)}>
              <strong>{p.fn || "(이름 없음)"}</strong>
              <small style={{ marginLeft: 8, color: "#6B7280" }}>
                · {p.creatorEmail} · {p.updatedAt ? new Date(p.updatedAt).toLocaleString("ko-KR") : "-"}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Header / TabBar ─────────────────────────────────────────────────────

function Header({ authUser, sessionId, activeUsers, onSave, onBackToDashboard, onShowBackups }) {
  return (
    <header style={{
      padding: "12px 16px",
      borderBottom: "1px solid #E5E7EB",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}>
      <div>
        <button onClick={onBackToDashboard}>◀ 대시보드</button>
        <span style={{ marginLeft: 12 }}>세션: {sessionId}</span>
      </div>
      <div>
        {/* 다른 사용자 인디케이터 (★ 단계 A) */}
        {activeUsers.length > 1 && (
          <span style={{ marginRight: 12 }}>
            👥 동시 편집: {activeUsers
              .filter((u) => u.sub !== authUser?.sub)
              .map((u) => `${u.name} → ${tabLabelKo(u.tabs?.[0])}`)
              .join(", ")}
          </span>
        )}
        <button onClick={onShowBackups}>📚 백업</button>
        <button onClick={onSave} style={{
          marginLeft: 8, padding: "6px 12px", backgroundColor: "#16A34A",
          color: "white", border: "none", borderRadius: 6,
        }}>💾 저장</button>
      </div>
    </header>
  );
}

function TabBar({ uiTabs, currentUiTab, onChange }) {
  return (
    <nav style={{ display: "flex", gap: 4, padding: "8px 16px", borderBottom: "1px solid #E5E7EB" }}>
      {uiTabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: "8px 12px",
            backgroundColor: t === currentUiTab ? "#3B82F6" : "transparent",
            color: t === currentUiTab ? "white" : "#374151",
            border: "1px solid #E5E7EB",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {/* ★ UI key 의 한글 라벨 직접 표시 (script → "스크립트", 사료 §4.2.c 정합) */}
          {tabLabelKo(t)}
        </button>
      ))}
    </nav>
  );
}
