import React from "react";
import type { BoardType } from "../../src/db/db";
import { deleteLead, listLeadsByBoard, moveLeadStage, updateLead } from "../../src/db/leadsRepo";

const WORKSPACE_ID = "default";

const STAGES = [
  "Leads novos",
  "Abordagem enviada",
  "Abordagem respondida",
  "Pergunta enviada",
  "Pergunta respondida",
  "CTA realizado",
  "Aceitou call",
  "Agendamento completo",
  "Compareceu",
  "No-show",
  "Reagendar",
  "Fechado (ganho)",
  "Perdido",
] as const;

type Toast = { id: string; message: string; kind: "ok" | "warn" | "error" };
function newId() {
  return crypto.randomUUID();
}

export default function App() {
  const [board, setBoard] = React.useState<BoardType>("OUTBOUND");
  const [leads, setLeads] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState("");
  const [toast, setToast] = React.useState<Toast | null>(null);

  const showToast = React.useCallback((message: string, kind: Toast["kind"] = "ok") => {
    const t = { id: newId(), message, kind };
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur?.id === t.id ? null : cur)), 2500);
  }, []);

  const reload = React.useCallback(async () => {
    const items = await listLeadsByBoard(WORKSPACE_ID, board);
    setLeads(items);
  }, [board]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        String(l.username || "").toLowerCase().includes(q) ||
        String(l.displayName || "").toLowerCase().includes(q),
    );
  }, [leads, search]);

  const byStage = React.useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of STAGES) map.set(s, []);
    for (const l of filtered) {
      const sid = String(l.stageId || "Leads novos");
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(l);
    }
    return map;
  }, [filtered]);

  async function onDropLead(leadId: string, toStageId: string) {
    try {
      await moveLeadStage({ workspaceId: WORKSPACE_ID, leadId, toStageId });
      await reload();
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || "Erro ao mover lead", "error");
    }
  }

  async function onDeleteLead(leadId: string, username: string) {
    try {
      await deleteLead({ workspaceId: WORKSPACE_ID, leadId });
      showToast(`🗑️ Removido: @${username}`, "warn");
      await reload();
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || "Erro ao remover lead", "error");
    }
  }

  return (
    <div className="min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg))]/80 backdrop-blur">
        <div className="w-full px-3 md:px-4 py-3 flex items-center gap-3">
          <div className="font-black tracking-tight text-lg">CRM IGNIS • Kanban</div>

          <div className="flex items-center gap-2 ml-2">
            <button
              className={
                "text-xs px-3 py-1 rounded-[var(--radius)] border " +
                (board === "OUTBOUND"
                  ? "border-[rgb(var(--accent))] bg-white/5"
                  : "border-[rgb(var(--border))] hover:bg-white/5")
              }
              onClick={() => setBoard("OUTBOUND")}
            >
              Outbound
            </button>
            <button
              className={
                "text-xs px-3 py-1 rounded-[var(--radius)] border " +
                (board === "SOCIAL"
                  ? "border-[rgb(var(--accent))] bg-white/5"
                  : "border-[rgb(var(--border))] hover:bg-white/5")
              }
              onClick={() => setBoard("SOCIAL")}
            >
              Social Selling
            </button>
          </div>

          <div className="flex-1" />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar @username…"
            className="text-xs w-[260px] max-w-[45vw] px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
          />

          <button
            className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
            onClick={() => void reload()}
            title="Recarregar"
          >
            Recarregar
          </button>
        </div>
      </div>

      {/* Kanban */}
      <div className="w-full px-3 md:px-4 py-4">
        <div className="overflow-x-auto">
          <div className="flex gap-3 pb-4 min-w-max">
            {STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stageId={stage}
                title={stage}
                items={byStage.get(stage) ?? []}
                onDropLead={onDropLead}
                onDeleteLead={onDeleteLead}
                onUpdateNotes={async (leadId, notes) => {
                  await updateLead({ workspaceId: WORKSPACE_ID, leadId, patch: { notes } });
                }}
              />
            ))}
          </div>
        </div>

        <div className="text-xs text-[rgb(var(--muted))] mt-2">
          Arraste o card para outra coluna para mudar o estágio. A nota rápida fica sempre visível.
        </div>
      </div>

      {/* Toast */}
      {toast ? (
        <div className="fixed right-4 bottom-4 z-50">
          <div
            className={
              "text-xs font-bold px-3 py-2 rounded-[var(--radius)] border shadow-[var(--shadow-sm)] backdrop-blur " +
              (toast.kind === "error"
                ? "bg-red-500/20 border-red-500/30"
                : toast.kind === "warn"
                  ? "bg-yellow-500/15 border-yellow-500/25"
                  : "bg-emerald-500/15 border-emerald-500/25")
            }
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KanbanColumn(props: {
  stageId: string;
  title: string;
  items: any[];
  onDropLead: (leadId: string, toStageId: string) => Promise<void>;
  onDeleteLead: (leadId: string, username: string) => Promise<void>;
  onUpdateNotes: (leadId: string, notes: string) => Promise<void>;
}) {
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/leadId");
    if (!leadId) return;
    await props.onDropLead(leadId, props.stageId);
  }

  return (
    <div
      className="w-[320px] shrink-0 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] shadow-[var(--shadow-sm)]"
      onDragOver={onDragOver}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="px-3 py-2 border-b border-[rgb(var(--border))] flex items-center gap-2">
        <div className="text-xs font-extrabold">{props.title}</div>
        <div className="text-[10px] px-2 py-0.5 rounded-full border border-[rgb(var(--border))] text-[rgb(var(--muted))]">
          {props.items.length}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2 min-h-[90px]">
        {props.items.length === 0 ? (
          <div className="text-xs text-[rgb(var(--muted))]">Solte cards aqui…</div>
        ) : null}

        {props.items.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            onDelete={() => void props.onDeleteLead(l.id, l.username)}
            onUpdateNotes={(notes) => void props.onUpdateNotes(l.id, notes)}
          />
        ))}
      </div>
    </div>
  );
}

function LeadCard(props: { lead: any; onDelete: () => void; onUpdateNotes: (notes: string) => void }) {
  const { lead } = props;
  const [notes, setNotes] = React.useState<string>(lead.notes || "");
  const tRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setNotes(String(lead.notes || ""));
  }, [lead.notes]);

  function scheduleSave(next: string) {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => props.onUpdateNotes(next), 400);
  }

  return (
    <div
      className="rounded-[var(--radius)] bg-white/5 border border-[rgb(var(--border))] p-3 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/leadId", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-xs font-extrabold">
            <a
              className="hover:underline"
              href={`https://www.instagram.com/${lead.username}/`}
              target="_blank"
              rel="noreferrer"
            >
              @{lead.username}
            </a>
          </div>
          {lead.displayName ? (
            <div className="text-[11px] text-[rgb(var(--muted))]">{lead.displayName}</div>
          ) : null}
        </div>

        <button
          className="text-[11px] px-2 py-1 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
          onClick={props.onDelete}
          title="Remover lead"
        >
          Remover
        </button>
      </div>

      <div className="mt-2">
        <div className="text-[10px] text-[rgb(var(--muted))] mb-1">Nota rápida</div>
        <textarea
          value={notes}
          onChange={(e) => {
            const v = e.target.value;
            setNotes(v);
            scheduleSave(v);
          }}
          placeholder="Digite uma nota…"
          className="w-full text-xs min-h-[56px] max-h-[140px] resize-y px-2 py-2 rounded-[var(--radius)] bg-[rgb(var(--bg))]/40 border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
        />
      </div>
    </div>
  );
}
