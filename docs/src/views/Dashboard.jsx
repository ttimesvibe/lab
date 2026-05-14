import { useState, useEffect, useCallback, useRef } from "react";
import { C, FN } from "../utils/styles.js";
import { KanbanView } from "./KanbanView.jsx";
import { deleteBackupsForSession } from "../utils/backup.js";
import { STEP_KEYS, STEP_LABELS, STATUS_MAP } from "../utils/tabs.js";

// ── Constants ──
// (STEP_KEYS / STEP_LABELS / STATUS_MAP 는 utils/tabs.js 단일 소스에서 import — 2026-05-09 통합)

const AVATAR_COLORS = ["#4A6CF7","#7C3AED","#EC4899","#F59E0B","#10B981","#EF4444","#06B6D4","#8B5CF6"];

const FILTER_TABS = [
  { key: "all",  label: "전체" },
  { key: "wip",  label: "진행중" },
  { key: "done", label: "완료" },
  { key: "mine", label: "내 프로젝트" },
];

const PER_PAGE = 20;

// ── Helpers ──

function authHeaders() {
  const token = localStorage.getItem("ttimes_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function relativeDate(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}주`;
  const mo = Math.floor(d / 30);
  return `${mo}개월`;
}

function shortDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ── Action Button (board row 우측 액션, 4종 색조 패턴 통합) ──
// 이전: 복구/영구삭제/완료/삭제 4 곳 인라인 중복 (~80줄). hex + alpha hex suffix 활용.
// alpha 변환: 0.30 → "4D" / 0.15 → "26" (8-bit hex alpha).
function ActionButton({ color, label, title, onClick, disabled }) {
  const bdAlpha = color + "4D"; // 30% — base border
  const bgAlpha = color + "26"; // 15% — hover bg
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: "none", border: `1px solid ${bdAlpha}`,
        cursor: disabled ? "not-allowed" : "pointer",
        color, fontSize: 11, padding: "2px 8px", lineHeight: 1.4,
        borderRadius: 4, fontFamily: FN, fontWeight: 500,
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = bgAlpha; e.currentTarget.style.borderColor = color; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = bdAlpha; }}
    >
      {label}
    </button>
  );
}

// ── Board Row 색조 컬러 매핑 (status step → 좌측 막대 색) ──
// STATUS_MAP 의 color 를 그대로 활용. trash 는 별 grey 색.
const TRASH_BAR_COLOR = "#8B8FA3";

// 보드 grid 컬럼 폭 (header / row / trash row 모두 동일 — 상수로 통일)
// 상태 컬럼 80px: "편집가이드"/"하이라이트" 5자 + padding 이 72px 채워 프로젝트명 침범했던 것 해소.
const BOARD_GRID = "40px 80px 1fr 160px 100px 100px 72px 96px";

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════

export function Dashboard({ authUser, cfg, onSelectProject, onNewProject, onEditProject, onNewShoot, onEditShoot, onNewProjectWithShoot, onLogout, toggleTheme, theme, viewMode, setViewMode, kanbanRefreshKey, projectRefreshKey }) {
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, wip: 0, done: 0, mine: 0 });
  const [filter, setFilter] = useState("wip");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [kanbanMineOnly, setKanbanMineOnly] = useState(() => {
    try { return localStorage.getItem("kanban_mine_only") === "true"; } catch { return false; }
  });

  // Editor edit popup state
  const [editingProject, setEditingProject] = useState(null); // { id, editors }
  const [teamMembers, setTeamMembers] = useState([]);
  const [editorsSaving, setEditorsSaving] = useState(false);
  const [deletingProject, setDeletingProject] = useState(null); // project object for delete confirm
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const popupRef = useRef(null);

  // Trash (admin only)
  const isAdmin = authUser?.role === "admin";
  const [trashList, setTrashList] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [purgingProject, setPurgingProject] = useState(null); // 영구삭제 confirm 대상

  // ── Sync body background with theme ──
  useEffect(() => {
    document.body.style.background = C.bg;
    document.documentElement.style.background = C.bg;
  }, [theme]);

  // ── Data Fetching ──

  const fetchProjects = useCallback(async () => {
    if (!cfg?.workerUrl) return;
    if (filter === "trash") return; // 휴지통은 별도 경로
    setLoading(true);
    try {
      // "wip" → Worker expects "active"
      const apiFilter = filter === "wip" ? "active" : filter;
      const url = `${cfg.workerUrl}/projects?page=${page}&per_page=${PER_PAGE}&filter=${apiFilter}&search=${encodeURIComponent(search)}`;
      const r = await fetch(url, { headers: { ...authHeaders() } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProjects(data.projects || []);
      setTotal(data.total || 0);
      const wip = data.activeCount ?? 0;
      const done = data.doneCount ?? 0;
      setCounts({
        all:  wip + done,
        wip,
        done,
        mine: data.mineCount ?? 0,
      });
    } catch (err) {
      console.error("[Dashboard] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [cfg, page, filter, search, projectRefreshKey]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // ── Trash 조회 (admin 전용) ──
  const fetchTrash = useCallback(async () => {
    if (!cfg?.workerUrl || !isAdmin) return;
    setTrashLoading(true);
    try {
      const r = await fetch(`${cfg.workerUrl}/projects/trash`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setTrashList(data.trash || []);
    } catch (err) {
      console.error("[Dashboard] trash fetch error:", err);
    } finally {
      setTrashLoading(false);
    }
  }, [cfg, isAdmin]);

  // admin 이 접속하면 휴지통도 미리 한 번 가져와서 탭 카운트 표시
  useEffect(() => { if (isAdmin) fetchTrash(); }, [fetchTrash, isAdmin, projectRefreshKey]);

  // ── 복구 ──
  const restoreProject = async (id) => {
    try {
      const r = await fetch(`${cfg.workerUrl}/projects/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) { alert("복구 실패: " + r.status); return; }
      fetchTrash();
      fetchProjects();
    } catch (err) {
      console.error("프로젝트 복구 실패:", err);
      alert("복구 실패: " + err.message);
    }
  };

  // ── 영구 삭제 (admin 전용) ──
  const purgeProject = async (id) => {
    try {
      const r = await fetch(`${cfg.workerUrl}/projects/trash/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!r.ok) { alert("영구삭제 실패: " + r.status); return; }
      // CMS v2 — W-3: 영구 삭제 시 해당 sessionId 의 localStorage 백업 키도 정리
      try {
        const removed = deleteBackupsForSession(id);
        if (removed > 0) console.log(`[backup] 영구 삭제 시 ${removed}개 백업 키 정리`);
      } catch (e) { console.warn("[backup] 영구 삭제 백업 정리 실패:", e?.message); }
      setPurgingProject(null);
      fetchTrash();
    } catch (err) {
      console.error("영구 삭제 실패:", err);
      alert("영구삭제 실패: " + err.message);
    }
  };

  // Reset page when filter or search changes
  useEffect(() => { setPage(1); }, [filter, search]);

  // Fetch team members for editor assignment
  useEffect(() => {
    if (!cfg?.workerUrl) return;
    fetch(`${cfg.workerUrl}/team/members`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (d?.members) setTeamMembers(d.members); })
      .catch(() => {});
  }, [cfg]);

  // Close popup on outside click
  useEffect(() => {
    if (!editingProject) return;
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setEditingProject(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingProject]);

  // Save editors to server
  const saveEditors = async (projectId, newEditors) => {
    setEditorsSaving(true);
    try {
      await fetch(`${cfg.workerUrl}/projects/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id: projectId, editors: newEditors }),
      });
      fetchProjects();
    } catch (err) {
      console.error("편집자 업데이트 실패:", err);
    } finally {
      setEditorsSaving(false);
    }
  };

  const addEditorToProject = (member) => {
    if (!editingProject) return;
    const current = editingProject.editors || [];
    if (current.some(e => (e.email || e.id) === (member.email || member.id))) return;
    const updated = [...current, { email: member.email || member.id, name: member.name || member.email }];
    setEditingProject({ ...editingProject, editors: updated });
    saveEditors(editingProject.id, updated);
  };

  const removeEditorFromProject = (email) => {
    if (!editingProject) return;
    const updated = (editingProject.editors || []).filter(e => (e.email || e.id) !== email);
    setEditingProject({ ...editingProject, editors: updated });
    saveEditors(editingProject.id, updated);
  };

  // Delete project
  const deleteProject = async (id) => {
    try {
      await fetch(`${cfg.workerUrl}/projects/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id }),
      });
      setDeletingProject(null);
      fetchProjects();
    } catch (err) {
      console.error("프로젝트 삭제 실패:", err);
    }
  };

  // Mark project as done/undone
  // isDone 은 status 기준 (currentStep 은 작업 단계로 완료 시에도 보존됨).
  // worker 가 step==="done" / wasDone 복원 케이스 모두 currentStep 을 건드리지 않도록 처리.
  const toggleDone = async (projId, isDone) => {
    const newStep = isDone ? "review" : "done";
    try {
      await fetch(`${cfg.workerUrl}/projects/update-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id: projId, step: newStep }),
      });
      fetchProjects();
    } catch (err) {
      console.error("완료 처리 실패:", err);
    }
  };

  // ── Derived ──

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // ── Render Helpers ──

  function renderStatusBadge(step) {
    const info = STATUS_MAP[step] || STATUS_MAP.review;
    return (
      <span style={{
        // justifySelf: "start" — 그리드 cell 의 직접 자식이라 default stretch (inline-block 도 blockified) →
        // cell 너비만큼 늘어나 80px 컬럼에서 박스 길어 보였던 문제 해소. 자체 폭만 차지하고 좌측 sticky.
        display: "inline-block", justifySelf: "start", padding: "2px 8px", borderRadius: 4,
        fontSize: 11, fontWeight: 600, lineHeight: "18px",
        color: info.color,
        background: info.color + "1A",
      }}>
        {info.label}
      </span>
    );
  }

  function renderEditors(editors, projId, project) {
    const names = (editors && editors.length > 0)
      ? editors.map(e => typeof e === "string" ? e : (e.name || e.email || "?"))
      : [];
    const display = names.length === 0
      ? "-"
      : names.length > 2
        ? `${names[0]} 외 ${names.length - 1}명`
        : names.join(", ");

    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          if (onEditProject && project) {
            onEditProject(project);
          } else {
            setEditingProject({ id: projId, editors: editors || [] });
          }
        }}
        title="프로젝트 수정"
      >
        {names.length > 0 ? (
          <>
            <div style={{ display: "flex" }}>
              {names.slice(0, 3).map((name, i) => (
                <div key={i} style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: avatarColor(name),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: "#fff",
                  marginLeft: i > 0 ? -6 : 0,
                  border: `2px solid ${C.bg}`,
                  zIndex: 3 - i,
                  position: "relative",
                }}>
                  {name.charAt(0)}
                </div>
              ))}
            </div>
            <span style={{ fontSize: 12, color: C.tx, whiteSpace: "nowrap" }}>{display}</span>
          </>
        ) : (
          <span style={{ color: C.txD, fontSize: 12 }}>-</span>
        )}
        <span style={{ fontSize: 10, color: C.txD, marginLeft: 2 }}>✎</span>
      </div>
    );
  }

  function renderProgress(currentStep) {
    const currentIdx = STEP_KEYS.indexOf(currentStep);
    const stepColor = (STATUS_MAP[currentStep] || STATUS_MAP.review).color;
    return (
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {STEP_KEYS.map((_, i) => (
          <div key={i} style={{
            width: 14, height: 3, borderRadius: 1,
            background: i <= currentIdx ? stepColor : C.bd,
          }} />
        ))}
      </div>
    );
  }

  function renderPagination() {
    if (totalPages <= 1) return null;
    const pages = [];
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);

    for (let i = start; i <= end; i++) pages.push(i);

    const btnBase = {
      width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
      border: "none", borderRadius: 6, cursor: "pointer",
      fontSize: 13, fontFamily: FN, fontWeight: 500,
      transition: "background 0.15s",
    };

    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, padding: "24px 0 16px" }}>
        <button
          style={{ ...btnBase, background: "transparent", color: page === 1 ? C.bd : C.txD }}
          disabled={page === 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
        >
          ‹
        </button>
        {pages.map(p => (
          <button
            key={p}
            style={{
              ...btnBase,
              background: p === page ? C.ac : "transparent",
              color: p === page ? "#fff" : C.txD,
            }}
            onClick={() => setPage(p)}
          >
            {p}
          </button>
        ))}
        <button
          style={{ ...btnBase, background: "transparent", color: page === totalPages ? C.bd : C.txD }}
          disabled={page === totalPages}
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        >
          ›
        </button>
      </div>
    );
  }

  // ── Computed Counts for Header ──

  const wipCount = counts.wip;
  const doneCount = counts.done;
  const allCount = counts.all;
  const trashCount = trashList.length;

  // 휴지통은 admin 에게만 노출 (FILTER_TABS 는 기본 4개, 여기에 admin 때만 +1)
  const filterTabs = isAdmin
    ? [...FILTER_TABS, { key: "trash", label: "휴지통" }]
    : FILTER_TABS;

  // 휴지통 모드의 표시 대상 (클라 side fn 검색)
  const isTrashMode = filter === "trash";
  const searchedTrash = search
    ? trashList.filter(t => (t.fn || "").toLowerCase().includes(search.toLowerCase()))
    : trashList;

  // ── Main Render ──

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FN, color: C.tx }}>

      {/* ── Top Bar ── */}
      <header style={{
        display: "flex", alignItems: "center", height: 48,
        padding: "0 24px",
        borderBottom: `1px solid ${C.bd}`,
        background: C.sf,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, letterSpacing: -0.3 }}>
          티타임즈 편집 CMS
        </span>
        <div style={{ flex: 1 }} />
        {authUser && (
          <span style={{ fontSize: 12, color: "#8B8FA3", marginRight: 16 }}>
            {authUser.name || authUser.email}
          </span>
        )}
        <button
          onClick={toggleTheme}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 16, color: "#8B8FA3", marginRight: 12, padding: 4,
          }}
          title="테마 전환"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          onClick={onLogout}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "#5E6380", padding: "4px 8px",
          }}
        >
          로그아웃
        </button>
      </header>

      {/* ── Content Area ── */}
      <div style={{ maxWidth: viewMode === "kanban" ? "none" : 960, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── Page Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingBottom: 20, borderBottom: `1px solid ${C.bd}`,
        }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
              대담 편집
            </h1>
            <p style={{ fontSize: 13, color: "#8B8FA3", margin: "4px 0 0" }}>
              총 {allCount}개 · 진행중 {wipCount} · 완료 {doneCount}
              {isAdmin && trashCount > 0 && <> · 휴지통 {trashCount}</>}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {/* View Toggle */}
            <div style={{ display: "flex", border: `1px solid ${C.bd}` }}>
              <button
                onClick={() => setViewMode("board")}
                style={{
                  padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: "none", fontFamily: FN,
                  background: viewMode === "board" ? "#E8E9ED" : "transparent",
                  color: viewMode === "board" ? "#0F1117" : "#5E6380",
                }}
              >게시판</button>
              <button
                onClick={() => setViewMode("kanban")}
                style={{
                  padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: "none", fontFamily: FN,
                  background: viewMode === "kanban" ? "#E8E9ED" : "transparent",
                  color: viewMode === "kanban" ? "#0F1117" : "#5E6380",
                }}
              >일정</button>
            </div>

            {/* Mine-only toggle (kanban only) */}
            {viewMode === "kanban" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
                <span
                  onClick={() => setKanbanMineOnly(v => { const next = !v; try { localStorage.setItem("kanban_mine_only", String(next)); } catch {} return next; })}
                  style={{
                    width: 34, height: 18, borderRadius: 9, position: "relative",
                    background: kanbanMineOnly ? "#4A6CF7" : C.bd,
                    transition: "background 0.2s", display: "inline-block", flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, left: kanbanMineOnly ? 18 : 2,
                    width: 14, height: 14, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  }} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: kanbanMineOnly ? C.tx : "#5E6380", whiteSpace: "nowrap" }}>
                  내 프로젝트만
                </span>
              </label>
            )}

            {/* Action button */}
            <button
              onClick={viewMode === "kanban" ? onNewShoot : onNewProject}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 18px",
                border: "none", cursor: "pointer",
                background: "#E8E9ED", color: "#0F1117",
                fontSize: 13, fontWeight: 600, fontFamily: FN,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >
              {viewMode === "kanban" ? "+ 촬영 일정" : "+ 새 프로젝트"}
            </button>
          </div>
        </div>

        {/* ── Kanban View ── */}
        {viewMode === "kanban" && (
          <div style={{ marginTop: 20 }}>
            <KanbanView
              authUser={authUser}
              cfg={cfg}
              onSelectProject={onSelectProject}
              onNewShoot={onNewShoot}
              onEditShoot={onEditShoot}
              onNewProject={(parentShootId) => onNewProjectWithShoot?.(parentShootId)}
              mineOnly={kanbanMineOnly}
              refreshKey={kanbanRefreshKey}
            />
          </div>
        )}

        {/* ── Board View ── */}
        {viewMode !== "kanban" && <>

        {/* ── Filter Tabs + Search ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 20, marginBottom: 16,
        }}>
          <div style={{ display: "flex", gap: 0 }}>
            {filterTabs.map(tab => {
              const isActive = filter === tab.key;
              const count = tab.key === "all" ? allCount
                : tab.key === "wip" ? wipCount
                : tab.key === "done" ? doneCount
                : tab.key === "trash" ? trashCount
                : counts.mine;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "8px 16px", fontFamily: FN,
                    fontSize: 13, fontWeight: isActive ? 600 : 400,
                    color: isActive ? C.tx : C.txD,
                    borderBottom: isActive ? `2px solid ${C.tx}` : "2px solid transparent",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                >
                  {tab.label}
                  <span style={{
                    marginLeft: 5, fontSize: 11,
                    color: isActive ? C.txM : C.txD,
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: 200, padding: "6px 0", fontFamily: FN,
              fontSize: 13, color: C.tx,
              background: "transparent",
              border: "none", borderBottom: `1px solid ${C.bd}`,
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={e => e.target.style.borderBottomColor = C.ac}
            onBlur={e => e.target.style.borderBottomColor = C.bd}
          />
        </div>

        {/* ── Table ── */}
        <div style={{ overflowX: "auto" }}>
          {/* Table Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: BOARD_GRID,
            gap: 0, padding: "10px 12px 10px 16px",  // +좌측 4px 상쇄 (row 의 좌측 status bar 너비)
            borderBottom: `1px solid ${C.bd}`,
            fontSize: 11, fontWeight: 600, color: C.txD,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>
            <span>#</span>
            <span>상태</span>
            <span>프로젝트</span>
            <span>{isTrashMode ? "편집자" : "편집자"}</span>
            <span>{isTrashMode ? "삭제자" : "현재 단계"}</span>
            <span>{isTrashMode ? "경과" : "진행"}</span>
            <span>{isTrashMode ? "삭제일" : "날짜"}</span>
            <span></span>
          </div>

          {/* Loading State */}
          {((isTrashMode && trashLoading) || (!isTrashMode && loading)) && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.txD, fontSize: 13 }}>
              불러오는 중...
            </div>
          )}

          {/* Empty State */}
          {!loading && !isTrashMode && projects.length === 0 && (
            <div style={{ padding: "60px 0", textAlign: "center", color: C.txD, fontSize: 13 }}>
              {search ? "검색 결과가 없습니다." : "프로젝트가 없습니다."}
            </div>
          )}
          {!trashLoading && isTrashMode && searchedTrash.length === 0 && (
            <div style={{ padding: "60px 0", textAlign: "center", color: C.txD, fontSize: 13 }}>
              {search ? "검색 결과가 없습니다." : "휴지통이 비어있습니다."}
            </div>
          )}

          {/* ── Trash Rows ── */}
          {!trashLoading && isTrashMode && searchedTrash.map((t, idx) => {
            const rowNum = searchedTrash.length - idx;
            const editors = t.editors || [];
            return (
              <BoardRow key={t.id || idx} idx={idx} barColor={TRASH_BAR_COLOR}>
                <span style={{ fontSize: 12, color: C.txD, fontVariantNumeric: "tabular-nums" }}>{rowNum}</span>
                <span style={{
                  display: "inline-block", justifySelf: "start", padding: "2px 8px", borderRadius: 4,
                  fontSize: 11, fontWeight: 600, lineHeight: "18px",
                  color: TRASH_BAR_COLOR, background: TRASH_BAR_COLOR + "26",
                }}>삭제됨</span>
                <span style={{
                  fontSize: 13, fontWeight: 500, color: C.tx,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  paddingRight: 12,
                }} title={t.fn}>
                  {truncate(t.fn || "제목 없음", 40)}
                </span>
                {renderEditors(editors, t.id, null)}
                <span style={{ fontSize: 12, color: C.txM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={t.deletedBy || ""}>
                  {(t.deletedBy || "-").split("@")[0]}
                </span>
                <span style={{ fontSize: 12, color: C.txM }}>
                  {typeof t.daysInTrash === "number" ? `${t.daysInTrash}일` : "-"}
                </span>
                <div style={{ textAlign: "right", lineHeight: 1.4 }}>
                  <div style={{ fontSize: 11, color: C.txD }}>{shortDate(t.deletedAt)}</div>
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <ActionButton
                    color="#22C55E"
                    label="복구"
                    title="프로젝트 복구"
                    onClick={(e) => { e.stopPropagation(); restoreProject(t.id); }}
                  />
                  <ActionButton
                    color="#EF4444"
                    label="영구삭제"
                    title="영구 삭제 (되돌릴 수 없음)"
                    onClick={(e) => { e.stopPropagation(); setPurgingProject(t); }}
                  />
                </div>
              </BoardRow>
            );
          })}

          {/* Project Rows (일반 모드) */}
          {!loading && !isTrashMode && projects.map((proj, idx) => {
            const step = proj.currentStep || proj.step || "review";
            // 완료 여부는 status 기준 (step 은 작업 단계 표시용으로 보존됨)
            const isDone = proj.status === "done";
            const rowNum = total - ((page - 1) * PER_PAGE + idx);
            const editors = proj.editors || (proj.editor ? [proj.editor] : []);
            const statusKey = isDone ? "done" : step;
            const barColor = STATUS_MAP[statusKey]?.color || TRASH_BAR_COLOR;
            const canDeleteProj = proj.creatorEmail === authUser?.email || authUser?.role === "admin";

            return (
              <BoardRow
                key={proj.id || idx}
                idx={idx}
                barColor={barColor}
                onClick={() => onSelectProject(proj.id)}
                clickable
                opacity={(isDone && filter !== "done") ? 0.35 : 1}
              >
                {/* Row Number */}
                <span style={{ fontSize: 12, color: C.txD, fontVariantNumeric: "tabular-nums" }}>
                  {rowNum}
                </span>

                {/* Status Badge — 완료 탭에서 "완료" 로, 그 외엔 현재 작업 단계로 */}
                {renderStatusBadge(statusKey)}

                {/* Project Name */}
                <span style={{
                  fontSize: 13, fontWeight: 500, color: C.tx,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  paddingRight: 12,
                }} title={proj.fn || proj.filename || proj.name}>
                  {truncate(proj.fn || proj.filename || proj.name || "제목 없음", 40)}
                </span>

                {/* Editors */}
                {renderEditors(editors, proj.id, proj)}

                {/* Current Step */}
                <span style={{ fontSize: 12, color: C.txM }}>
                  {STEP_LABELS[step] || step}
                </span>

                {/* Progress Bar */}
                {renderProgress(step)}

                {/* Date: 등록일 + 최종수정 */}
                <div style={{ textAlign: "right", lineHeight: 1.4 }}>
                  <div style={{ fontSize: 11, color: C.txD }}>{shortDate(proj.createdAt)}</div>
                  <div style={{ fontSize: 10, color: C.txD }}>{proj.updatedAt ? relativeDate(proj.updatedAt) : "-"}</div>
                </div>

                {/* Actions: 완료 + 삭제 */}
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <ActionButton
                    color={isDone ? TRASH_BAR_COLOR : "#22C55E"}
                    label={isDone ? "복원" : "완료"}
                    title={isDone ? "진행중으로 되돌리기" : "완료 처리"}
                    onClick={(e) => { e.stopPropagation(); toggleDone(proj.id, isDone); }}
                  />
                  {canDeleteProj && (
                    <ActionButton
                      color="#EF4444"
                      label="삭제"
                      title="프로젝트 삭제"
                      onClick={(e) => { e.stopPropagation(); setDeletingProject(proj); }}
                    />
                  )}
                </div>
              </BoardRow>
            );
          })}
        </div>

        {/* ── Pagination (일반 모드만) ── */}
        {!isTrashMode && renderPagination()}

        </>}
      </div>

      {/* Editor Edit Modal */}
      {editingProject && (() => {
        const currentEditors = editingProject.editors || [];
        const availableMembers = teamMembers.filter(
          m => !currentEditors.some(e => (e.email || e.id) === (m.email || m.id))
        );
        return (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setEditingProject(null)}
        >
          <div
            ref={popupRef}
            style={{
              background: C.sf, borderRadius: 12, padding: 24,
              border: `1px solid ${C.bd}`, maxWidth: 360, width: "100%",
              fontFamily: FN,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.tx }}>편집자 관리</div>
              <button onClick={() => setEditingProject(null)} style={{
                background: "none", border: "none", color: "#5E6380",
                fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1,
              }}>✕</button>
            </div>

            {/* Current editors */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {currentEditors.map((ed, i) => {
                const edName = typeof ed === "string" ? ed : (ed.name || ed.email || "?");
                const edEmail = typeof ed === "string" ? ed : (ed.email || ed.id);
                return (
                  <span key={edEmail || i} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "rgba(74,108,247,0.15)", color: "#4A6CF7",
                    borderRadius: 12, padding: "4px 10px", fontSize: 12,
                  }}>
                    {edName}
                    <button
                      onClick={() => removeEditorFromProject(edEmail)}
                      style={{
                        background: "none", border: "none", color: "#4A6CF7",
                        cursor: "pointer", padding: 0, fontSize: 12,
                        fontWeight: 700, lineHeight: 1,
                      }}
                    >✕</button>
                  </span>
                );
              })}
              {currentEditors.length === 0 && (
                <span style={{ fontSize: 12, color: "#5E6380" }}>편집자 없음</span>
              )}
            </div>

            {/* Add member dropdown */}
            {availableMembers.length > 0 && (
              <select
                value=""
                onChange={e => {
                  const member = teamMembers.find(m => (m.email || m.id) === e.target.value);
                  if (member) addEditorToProject(member);
                }}
                style={{
                  width: "100%", padding: 8, borderRadius: 6,
                  border: `1px solid ${C.bd}`, background: C.inputBg,
                  color: C.tx, fontSize: 13, cursor: "pointer",
                  outline: "none", boxSizing: "border-box",
                }}
              >
                <option value="" disabled>+ 팀원 추가</option>
                {availableMembers.map(m => (
                  <option key={m.email || m.id} value={m.email || m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            )}

            {editorsSaving && (
              <div style={{ fontSize: 11, color: "#5E6380", marginTop: 6 }}>저장 중...</div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Purge Confirmation Modal (영구 삭제, 약한 확인) */}
      {purgingProject && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: C.sf, borderRadius: 12, padding: 24,
            border: `1px solid ${C.bd}`, maxWidth: 400, width: "100%",
            fontFamily: FN,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#EF4444", marginBottom: 12 }}>
              영구 삭제
            </div>
            <div style={{ fontSize: 13, color: C.txM, marginBottom: 8, lineHeight: 1.5 }}>
              <strong style={{ color: C.tx }}>{truncate(purgingProject.fn || "", 30)}</strong> 프로젝트를 영구 삭제합니다.
            </div>
            <div style={{ fontSize: 13, color: C.txM, marginBottom: 16, lineHeight: 1.5 }}>
              휴지통에서 완전히 제거되며, <strong style={{ color: "#EF4444" }}>복구할 수 없습니다</strong>.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setPurgingProject(null)}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.bd}`,
                  background: "transparent", color: C.tx, fontSize: 13,
                  cursor: "pointer", fontFamily: FN,
                }}
              >취소</button>
              <button
                onClick={() => purgeProject(purgingProject.id)}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none",
                  background: "#EF4444", color: "#fff",
                  fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: FN,
                }}
              >영구 삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProject && (() => {
        const projName = deletingProject.fn || deletingProject.filename || deletingProject.name || "";
        const canDelete = deleteConfirmText === "삭제";
        return (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: C.sf, borderRadius: 12, padding: 24,
            border: `1px solid ${C.bd}`, maxWidth: 400, width: "100%",
            fontFamily: FN,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#EF4444", marginBottom: 12 }}>
              프로젝트 삭제
            </div>
            <div style={{ fontSize: 13, color: C.txM, marginBottom: 8, lineHeight: 1.5 }}>
              <strong style={{ color: C.tx }}>{truncate(projName, 30)}</strong> 프로젝트의 모든 데이터가 영구 삭제됩니다.
            </div>
            <div style={{ fontSize: 13, color: C.txM, marginBottom: 16, lineHeight: 1.5 }}>
              이 작업은 되돌릴 수 없습니다. 삭제하려면 아래에 <strong style={{ color: "#EF4444" }}>삭제</strong>를 입력하세요.
            </div>
            <input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="삭제"
              autoFocus
              style={{
                width: "100%", padding: 10, borderRadius: 6,
                border: `1px solid ${canDelete ? "#EF4444" : C.bd}`,
                background: C.inputBg, color: C.tx, fontSize: 14,
                fontFamily: FN, outline: "none", boxSizing: "border-box",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setDeletingProject(null); setDeleteConfirmText(""); }}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.bd}`,
                  background: "transparent", color: C.tx, fontSize: 13,
                  cursor: "pointer", fontFamily: FN,
                }}
              >
                취소
              </button>
              <button
                onClick={() => { if (canDelete) { deleteProject(deletingProject.id); setDeleteConfirmText(""); } }}
                disabled={!canDelete}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none",
                  background: canDelete ? "#EF4444" : "rgba(239,68,68,0.3)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: canDelete ? "pointer" : "not-allowed", fontFamily: FN,
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════
// BOARD ROW (게시판 row 공통 wrapper — zebra + 좌측 status 색 막대)
// ═══════════════════════════════════════════════
// 이전: Project row + Trash row 가 같은 grid 구조를 두 곳에 인라인 작성 (~150줄 중복).
// 변경 (2026-05-09): grid layout / hover / zebra / 좌측 status 막대 통합. children 으로 column slot.
//   barColor: 좌측 4px status 색 막대. STATUS_MAP[step].color (project) 또는 TRASH_BAR_COLOR (trash).
//   zebra: 짝수 idx 에 C.glass 배경. 라이트/다크 모두 적용 — 가독성 양쪽 모두 도움.
//   hover 와 zebra 충돌 회피: mouseLeave 시 zebra 색 복원 (idx 기준).
function BoardRow({ idx, barColor, onClick, clickable, opacity, children }) {
  const isZebra = idx % 2 === 1;  // 0 transparent / 1 C.glass — 첫 row 는 깨끗
  const baseBg = isZebra ? C.glass : "transparent";
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: BOARD_GRID,
        gap: 0, padding: "12px 12px",
        borderLeft: `4px solid ${barColor || "transparent"}`,  // 좌측 status 색 막대
        borderBottom: `1px solid ${C.bd}`,
        alignItems: "center",
        cursor: clickable ? "pointer" : "default",
        opacity: opacity ?? 1,
        background: baseBg,
        transition: "background 0.12s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = C.glassHover}
      onMouseLeave={e => e.currentTarget.style.background = baseBg}
    >
      {children}
    </div>
  );
}
