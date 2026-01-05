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

function getDashboardUrl() {
  return chrome.runtime.getURL("dashboard.html");
}

async function openOrFocusDashboard() {
  const dashboardUrl = getDashboardUrl();

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url ? t.url.startsWith(dashboardUrl) : false));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: dashboardUrl, active: true });
}

function cx(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(" ");
}

export function SidePanelApp() {
  const [tab, setTab] = React.useState<Tab>("Outbound");
  const workspaceId = "default";

  const activeBoard = tabToBoard(tab);

  const [leads, setLeads] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState("");

  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | null>(null);

  function toast(m: string) {
    setToastMsg(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2500);
  }

  const reload = React.useCallback(async () => {
    if (!activeBoard) return;
    try {
      const items = await listLeadsByBoard(workspaceId, activeBoard);
      setLeads(items);
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar leads (veja o Console).");
    }
  }, [activeBoard]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  async function captureFromCurrentTab() {
    if (!activeBoard) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs?.[0]?.url;

    if (!url) {
      toast("Não consegui ler a URL da aba ativa.");
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
        stageId: "Leads novos",
        username: parsed.username,
      });

      if (result.status === "created") toast(`✅ Capturado: @${result.lead.username}`);
      if (result.status === "exists") toast(`⚠️ Já existe: @${result.lead.username}`);

      await reload();
    } catch (err) {
      console.error(err);
      toast("Erro ao adicionar lead (veja o Console).");
    }
  }

  async function onDelete(leadId: string, username: string) {
    try {
      await deleteLead({ workspaceId, leadId });
      toast(`🗑️ Lead @${username} excluído`);
      await reload();
    } catch (err) {
      console.error(err);
      toast("Erro ao excluir lead (veja o Console).");
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? leads.filter(
        (l) =>
          String(l.username || "").toLowerCase().includes(q) ||
          String(l.displayName || "").toLowerCase().includes(q),
      )
    : leads;

  return (
    <div className="min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))] p-3">
      <div className="flex items-center gap-2">
        <div className="font-black">CRM IGNIS</div>
        <div className="text-xs text-[rgb(var(--muted))]">• Padrão</div>
      </div>

      <div className="flex gap-2 mt-3">
        {(["Outbound", "Social", "Tasks", "Filtros", "Settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={cx(
              "text-xs px-3 py-1 rounded-[var(--radius)] border",
              tab === t ? "border-[rgb(var(--accent))] bg-white/5" : "border-[rgb(var(--border))] hover:bg-white/5",
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
          onClick={() => void captureFromCurrentTab()}
          disabled={!activeBoard}
        >
          Capturar lead da aba atual
        </button>

        <button
          className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
          onClick={() => void openOrFocusDashboard()}
        >
          Abrir Kanban
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          className="text-xs w-full px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar…"
        />
      </div>

      <div className="mt-3 border border-[rgb(var(--border))] rounded-[var(--radius)] overflow-hidden">
        <div className="p-2 text-xs font-bold border-b border-[rgb(var(--border))] bg-white/5">
          Leads ({filtered.length})
        </div>

        <div className="p-2 flex flex-col gap-2">
          {filtered.map((l) => (
            <div key={l.id} className="p-2 rounded-[var(--radius)] border border-[rgb(var(--border))] bg-white/5">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="text-xs font-extrabold">@{l.username}</div>
                  <div className="text-[11px] text-[rgb(var(--muted))]">{String(l.stageId || "")}</div>
                </div>
                <button
                  className="text-[11px] px-2 py-1 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
                  onClick={() => void onDelete(l.id, l.username)}
                >
                  Remover
                </button>
              </div>
            </div>
          ))}

          {filtered.length === 0 ? (
            <div className="text-xs text-[rgb(var(--muted))] mt-2">Nenhum lead encontrado.</div>
          ) : null}
        </div>
      </div>

      {toastMsg ? (
        <div className="fixed right-3 bottom-3 text-xs font-bold px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] bg-white/10 backdrop-blur shadow-[var(--shadow-sm)]">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}
