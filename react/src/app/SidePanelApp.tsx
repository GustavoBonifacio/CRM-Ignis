import React from "react";
import { addLead, deleteLead, listLeadsByBoard } from "../db/leadsRepo";
import type { BoardType } from "../db/db";
import { parseInstagramUsername } from "../instagram/parseInstagram";

type Tab = "Outbound" | "Social" | "Tasks" | "Filtros" | "Settings";

function tabToBoard(tab: Tab): BoardType | null {
  if (tab === "Outbound") return "OUTBOUND";
  if (tab === "Social") return "SOCIAL";
  return null;
}

function defaultStageForBoard(board: BoardType) {
  return board === "OUTBOUND" ? "Leads novos" : "Leads novos (social)";
}

function cx(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(" ");
}

export function SidePanelApp() {
  const [tab, setTab] = React.useState<Tab>("Outbound");
  const [workspace, setWorkspace] = React.useState("Padrão");
  const workspaceId = "default";

  const activeBoard = tabToBoard(tab);

  const [leads, setLeads] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState("");
  const [toastMsg, setToastMsg] = React.useState<string>("");

  const tabs: { id: Tab; label: string }[] = [
    { id: "Outbound", label: "Outbound" },
    { id: "Social", label: "Social Selling" },
    { id: "Tasks", label: "Tasks" },
    { id: "Filtros", label: "Filtros" },
    { id: "Settings", label: "Settings" },
  ];

  function toast(msg: string) {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(""), 2500);
  }

  async function reload(boardOverride?: BoardType) {
    try {
      const boardToLoad: BoardType = boardOverride ?? activeBoard ?? "OUTBOUND";
      const items = await listLeadsByBoard(workspaceId, boardToLoad);
      setLeads(items);
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar leads (veja o Console).");
    }
  }

  React.useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Listener: recebe toast do background + muda de aba se precisar
  React.useEffect(() => {
    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type !== "CRM_IGNIS_TOAST") return;

      const message = msg.payload?.message as string | undefined;
      const board = msg.payload?.board as BoardType | undefined;

      if (message) toast(message);

      // Se veio um lead Social e eu estou no Outbound, troco a aba automaticamente
      if (board === "SOCIAL") setTab("Social");
      if (board === "OUTBOUND") setTab("Outbound");

      // recarrega a lista do board correto
      if (board) reload(board);
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getActiveTabUrl(): Promise<string | null> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs?.[0]?.url ?? null;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async function handleCaptureProfile() {
    if (!activeBoard) {
      toast("Vá para Outbound ou Social Selling para capturar.");
      return;
    }

    const url = await getActiveTabUrl();
    if (!url) {
      toast("Não consegui ler a aba ativa. Abra um perfil do Instagram e tente de novo.");
      return;
    }

    const parsed = parseInstagramUsername(url);
    if (!parsed.ok) {
      toast(parsed.reason);
      return;
    }

    try {
      const result = await addLead({
        workspaceId,
        board: activeBoard,
        stageId: defaultStageForBoard(activeBoard),
        username: parsed.username,
      });

      if (result.status === "created") toast(`✅ Capturado: @${result.lead.username} (${activeBoard})`);
      if (result.status === "exists") toast(`⚠️ Já existe: @${result.lead.username}`);

      await reload();
    } catch (err) {
      console.error(err);
      toast("Erro ao adicionar lead (veja o Console).");
    }
  }

  async function handleAddTestLead() {
    if (!activeBoard) {
      toast("Vá para Outbound ou Social Selling para adicionar.");
      return;
    }

    try {
      const username = `lead_${Math.floor(Math.random() * 99999)}`;
      const result = await addLead({
        workspaceId,
        board: activeBoard,
        stageId: defaultStageForBoard(activeBoard),
        username,
      });

      if (result.status === "created") toast(`✅ Lead @${result.lead.username} adicionado em ${activeBoard}`);
      if (result.status === "exists") toast(`⚠️ Já existe: @${result.lead.username}`);

      await reload();
    } catch (err) {
      console.error(err);
      toast("Erro ao adicionar lead (veja o Console).");
    }
  }

  async function handleDeleteLead(leadId: string, username: string) {
    const ok = window.confirm("Tem certeza que deseja excluir esse lead?");
    if (!ok) return;

    try {
      await deleteLead({ workspaceId, leadId });
      toast(`🗑️ Lead @${username} excluído`);
      await reload();
    } catch (err) {
      console.error(err);
      toast("Erro ao excluir lead (veja o Console).");
    }
  }

  const q = search.toLowerCase().trim();
  const filtered = leads.filter((l) => {
    if (!q) return true;
    return String(l.usernameLower || "").includes(q);
  });

  return (
    <div className="h-screen w-full bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[rgb(var(--border))] bg-[rgb(var(--panel))]">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-wide">CRM IGNIS</div>
          <div className="text-[11px] text-[rgb(var(--muted))]">IG Buttons (Passo 6)</div>
        </div>

        <select
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          className="text-xs rounded-[var(--radius)] bg-transparent border border-[rgb(var(--border))] px-2 py-1 outline-none"
        >
          <option value="Padrão">Workspace: Padrão</option>
        </select>

        <button
          onClick={handleCaptureProfile}
          className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5 active:bg-white/10 transition"
          title="Fallback: pega o @ pela URL da aba ativa"
        >
          Capturar perfil
        </button>
      </div>

      <div className="flex gap-2 px-3 py-2 border-b border-[rgb(var(--border))] bg-[rgb(var(--panel))] overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "text-xs px-3 py-2 rounded-full border transition whitespace-nowrap",
              tab === t.id
                ? "border-transparent bg-[rgb(var(--accent))] text-black"
                : "border-[rgb(var(--border))] hover:bg-white/5 active:bg-white/10"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {toastMsg ? (
        <div className="px-3 pt-3">
          <div className="text-xs rounded-[var(--radius)] border border-[rgb(var(--border))] px-3 py-2 bg-white/5">
            {toastMsg}
          </div>
        </div>
      ) : null}

      <div className="p-3 space-y-3">
        <div className="rounded-[var(--radius)] border border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-[var(--shadow-sm)] p-3">
          <div className="text-sm font-semibold">Leads</div>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleAddTestLead}
              className="text-xs px-3 py-2 rounded-full bg-[rgb(var(--accent))] text-black hover:opacity-90 active:opacity-80 transition"
            >
              + Adicionar lead teste
            </button>

            <button
              onClick={() => reload()}
              className="text-xs px-3 py-2 rounded-full border border-[rgb(var(--border))] hover:bg-white/5 active:bg-white/10 transition"
            >
              Recarregar
            </button>

            <div className="ml-auto text-[11px] text-[rgb(var(--muted))]">
              Board: <span className="font-semibold">{activeBoard ?? "-"}</span> • Total:{" "}
              <span className="font-semibold">{filtered.length}</span>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs text-[rgb(var(--muted))] mb-2">Buscar por username</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ex: fulano"
              className="w-full text-sm px-3 py-2 rounded-[var(--radius)] bg-transparent border border-[rgb(var(--border))] outline-none"
            />
          </div>

          <div className="mt-3 space-y-2">
            {filtered.slice(0, 20).map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-[var(--radius)] border border-[rgb(var(--border))] px-3 py-2"
              >
                <div className="text-xs">
                  <div className="font-semibold">@{l.username}</div>
                  <div className="text-[rgb(var(--muted))]">{l.stageId}</div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-1 rounded-full border border-[rgb(var(--border))]">
                    {l.board}
                  </span>

                  <button
                    onClick={() => handleDeleteLead(l.id, l.username)}
                    title="Excluir lead"
                    className="text-xs px-2 py-1 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5 active:bg-white/10 transition"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}

            {filtered.length === 0 ? (
              <div className="text-xs text-[rgb(var(--muted))] mt-2">Nenhum lead encontrado.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
