import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARDS,
  Board,
  Lead,
  loadLeadsState,
  removeLead,
  restoreLead,
  STAGES,
  Stage,
  upsertLead,
  updateLead,
} from "../../src/crm/leadsStore";

type ToastState =
  | { type: "none" }
  | { type: "deleted"; lead: Lead; index: number; until: number };

function parseInstagramProfile(url: string): { username: string; profileUrl: string } | null {
  const m = url.match(/https?:\/\/(www\.)?instagram\.com\/([^/?#]+)\/?/i);
  if (!m) return null;

  const username = m[2]?.trim();
  if (!username) return null;

  const blocked = new Set(["p", "reel", "tv", "stories", "explore", "direct", "accounts"]);
  if (blocked.has(username.toLowerCase())) return null;

  const profileUrl = `https://www.instagram.com/${username}/`;
  return { username, profileUrl };
}

export default function App() {
  const [activeBoard, setActiveBoard] = useState<Board>("OUTBOUND");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [toast, setToast] = useState<ToastState>({ type: "none" });

  const [confirmDelete, setConfirmDelete] = useState<null | { id: string; username: string }>(null);

  const noteTimers = useRef<Map<string, number>>(new Map());

  async function refresh() {
    setLoading(true);
    const state = await loadLeadsState();
    const list = state.order
      .map((id) => state.leadsById[id])
      .filter(Boolean);

    setLeads(list as Lead[]);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();

    // Atualiza automaticamente se algo mudar no storage (ex.: outra tela salvar)
    const handler = () => void refresh();
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return leads.filter((l) => {
      if (l.board !== activeBoard) return false;
      if (!q) return true;
      const hay = `${l.username} ${l.note} ${l.stage}`.toLowerCase();
      return hay.includes(q);
    });
  }, [leads, activeBoard, query]);

  const grouped = useMemo(() => {
    const map: Record<Stage, Lead[]> = Object.create(null);
    for (const s of STAGES) map[s.id] = [];
    for (const lead of filtered) map[lead.stage].push(lead);
    return map;
  }, [filtered]);

  async function onCapture() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      const url = tab?.url;

      if (!url) {
        alert(
          "Não consegui ler a URL da aba ativa.\n\nDica: abra um perfil do Instagram e tente de novo. Se persistir, precisamos conferir permissões (tabs/activeTab) no manifest."
        );
        return;
      }

      const parsed = parseInstagramProfile(url);
      if (!parsed) {
        alert("Isso não parece ser um perfil do Instagram.\n\nAbra o perfil (instagram.com/usuario/) e clique em Capturar.");
        return;
      }

      await upsertLead({ ...parsed, board: activeBoard });
      await refresh();
    } catch (e) {
      console.error(e);
      alert("Falha ao capturar. Veja o console da Dashboard.");
    }
  }

  function scheduleNoteSave(id: string, note: string) {
    const existing = noteTimers.current.get(id);
    if (existing) window.clearTimeout(existing);

    const t = window.setTimeout(() => {
      void updateLead(id, { note, updatedAt: new Date().toISOString() });
      noteTimers.current.delete(id);
    }, 550);

    noteTimers.current.set(id, t);
  }

  async function onChangeStage(id: string, stage: Stage) {
    await updateLead(id, { stage, updatedAt: new Date().toISOString() });
    await refresh();
  }

  function getNextStage(stage: Stage): Stage | null {
    const idx = STAGES.findIndex((s) => s.id === stage);
    if (idx < 0) return null;
    if (idx >= STAGES.length - 1) return null;
    return STAGES[idx + 1].id;
  }

  async function requestDelete(id: string, username: string) {
    setConfirmDelete({ id, username });
  }

  async function confirmDeleteNow(id: string) {
    // descobre o índice na lista atual (ordem global)
    const index = leads.findIndex((l) => l.id === id);

    const deleted = await removeLead(id);
    await refresh();
    setConfirmDelete(null);

    if (deleted) {
      const until = Date.now() + 10_000;
      setToast({ type: "deleted", lead: deleted, index: index < 0 ? 0 : index, until });
    }
  }

  async function undoDelete() {
    if (toast.type !== "deleted") return;
    await restoreLead(toast.lead, toast.index);
    await refresh();
    setToast({ type: "none" });
  }

  // auto-dismiss toast
  useEffect(() => {
    if (toast.type !== "deleted") return;
    const ms = Math.max(0, toast.until - Date.now());
    const t = window.setTimeout(() => setToast({ type: "none" }), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  const boardLabel = BOARDS.find((b) => b.id === activeBoard)?.label ?? activeBoard;

  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="logo" />
            <div>CRM IGNIS</div>
          </div>

          <div className="nav">
            {BOARDS.map((b) => (
              <button
                key={b.id}
                className={`navbtn ${activeBoard === b.id ? "active" : ""}`}
                onClick={() => setActiveBoard(b.id)}
                title={`Ver funil: ${b.label}`}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="spacer" />

          <input
            className="search"
            placeholder="Buscar por username, nota ou etapa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="actions">
            <select className="select" value={activeBoard} onChange={(e) => setActiveBoard(e.target.value as Board)}>
              {BOARDS.map((b) => (
                <option key={b.id} value={b.id}>
                  Capturar em: {b.label}
                </option>
              ))}
            </select>

            <button className="primary" onClick={onCapture}>
              + Capturar
            </button>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="boardHeader">
          <div>
            <h1 className="h1">Pipeline — {boardLabel}</h1>
            <p className="sub">
              {loading ? "Carregando..." : `${filtered.length} lead(s) no funil • Arraste mentalmente: por enquanto é por seletor/Next 🙂`}
            </p>
          </div>
        </div>

        <div className="hscroll">
          <div className="columns">
            {STAGES.map((col) => {
              const items = grouped[col.id] ?? [];
              return (
                <div className="column" key={col.id}>
                  <div className="colTop">
                    <div className="colTitle">
                      {col.label} <span className="badge">{items.length}</span>
                    </div>
                  </div>

                  <div className="colBody">
                    {items.length === 0 ? (
                      <div className="empty">Nenhum lead aqui</div>
                    ) : (
                      items.map((lead) => {
                        const next = getNextStage(lead.stage);
                        return (
                          <div className="card" key={lead.id}>
                            <div className="cardTop">
                              <div className="userBlock">
                                <a className="username" href={lead.profileUrl} target="_blank" rel="noreferrer">
                                  @{lead.username}
                                </a>
                                <div className="meta">
                                  <span className="pill">{lead.board}</span>
                                  <span className="pill">{new Date(lead.updatedAt).toLocaleString()}</span>
                                </div>
                              </div>

                              <div className="cardActions">
                                <button
                                  className="iconBtn danger"
                                  title="Remover lead"
                                  onClick={() => void requestDelete(lead.id, lead.username)}
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            {/* NOTA SEMPRE VISÍVEL */}
                            <textarea
                              className="note"
                              placeholder="Nota rápida (sempre visível)…"
                              defaultValue={lead.note}
                              onChange={(e) => scheduleNoteSave(lead.id, e.target.value)}
                            />

                            <div className="cardBottom">
                              <select
                                className="smallSelect"
                                value={lead.stage}
                                onChange={(e) => void onChangeStage(lead.id, e.target.value as Stage)}
                                title="Mover etapa"
                              >
                                {STAGES.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>

                              <button
                                className="nextBtn"
                                disabled={!next}
                                onClick={() => next && void onChangeStage(lead.id, next)}
                                title="Mover para a próxima etapa"
                              >
                                Next →
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toast de delete + undo */}
      {toast.type === "deleted" && (
        <div className="toast">
          <div>
            <strong>@{toast.lead.username}</strong> removido.
          </div>
          <button onClick={() => void undoDelete()}>Desfazer</button>
        </div>
      )}

      {/* Modal confirmação */}
      {confirmDelete && (
        <div className="modalOverlay" onMouseDown={() => setConfirmDelete(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Remover lead?</h3>
            <p>
              Você vai remover <strong>@{confirmDelete.username}</strong> do CRM.
            </p>
            <div className="modalActions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={() => void confirmDeleteNow(confirmDelete.id)}>
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
