import React from "react";
import type { BoardType } from "../../src/db/db";
import { deleteLead, listLeadsByBoard, moveLeadStage, updateLead } from "../../src/db/leadsRepo";
import { BackupRestorePanel } from "../../src/ui/BackupRestorePanel";

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

function openInstagramProfile(username: string) {
  const u = String(username || "").replace(/^@+/, "").trim();
  const url = `https://www.instagram.com/${u}/`;
  try {
    chrome.tabs.create({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function toLocalDayRange(dateStr: string): { start: number; end: number } | null {
  // dateStr vem do <input type="date"> no formato "YYYY-MM-DD"
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;

  // ⚠️ IMPORTANTE: montar a data manualmente evita bug de fuso (Date("YYYY-MM-DD") vira UTC)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

function todayAsInputDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function App() {
  const [board, setBoard] = React.useState<BoardType>("OUTBOUND");
  const [leads, setLeads] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState("");

  // ✅ NOVO: filtro por dia (leads criados em um dia específico)
  const [dayFilter, setDayFilter] = React.useState<string>(""); // formato: YYYY-MM-DD

  const [toast, setToast] = React.useState<Toast | null>(null);
  const [showBackup, setShowBackup] = React.useState(false);

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

  const dayRange = React.useMemo(() => toLocalDayRange(dayFilter), [dayFilter]);

  const filtered = React.useMemo(() => {
    let base = leads;

    // 1) filtro por dia (createdAt)
    if (dayRange) {
      base = base.filter((l) => {
        const createdAt = Number(l?.createdAt ?? 0);
        return createdAt >= dayRange.start && createdAt < dayRange.end;
      });
    }

    // 2) filtro por busca
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (l) =>
        String(l.username || "").toLowerCase().includes(q) ||
        String(l.displayName || "").toLowerCase().includes(q),
    );
  }, [leads, search, dayRange]);

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

  const dayLabel = React.useMemo(() => {
    if (!dayRange) return null;
    try {
      return new Date(dayRange.start).toLocaleDateString("pt-BR");
    } catch {
      return dayFilter;
    }
  }, [dayFilter, dayRange]);

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

          {/* ✅ NOVO: Filtro por dia */}
          <input
            type="date"
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            title="Mostra somente leads adicionados no dia selecionado"
            className="text-xs w-[170px] max-w-[40vw] px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
          />

          <button
            className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
            onClick={() => setDayFilter(todayAsInputDate())}
            title="Filtrar por hoje"
          >
            Hoje
          </button>

          {dayFilter ? (
            <button
              className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
              onClick={() => setDayFilter("")}
              title="Remover filtro de dia"
            >
              Limpar
            </button>
          ) : null}

          <button
            className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
            onClick={() => void reload()}
            title="Recarregar"
          >
            Recarregar
          </button>

          <button
            className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
            onClick={() => setShowBackup((v) => !v)}
            title="Abrir/Fechar Backup"
          >
            {showBackup ? "Fechar Backup" : "Backup/Restore"}
          </button>
        </div>

        {/* Linha auxiliar (opcional) mostrando o filtro ativo */}
        {dayLabel ? (
          <div className="px-3 md:px-4 pb-3 -mt-1 text-[11px] text-[rgb(var(--muted))]">
            Mostrando leads adicionados em <span className="font-bold">{dayLabel}</span>
          </div>
        ) : null}
      </div>

      <div className="w-full px-3 md:px-4 py-4">
        {showBackup ? (
          <div className="mb-4">
            <BackupRestorePanel />
          </div>
        ) : null}

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

  const firstLetter = (String(lead.username || "?")[0] || "?").toUpperCase();

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
        <button
          type="button"
          className="shrink-0"
          onClick={() => openInstagramProfile(lead.username)}
          title="Abrir perfil no Instagram"
        >
          <div className="w-9 h-9 rounded-full border border-[rgb(var(--border))] bg-white/5 grid place-items-center text-[11px] font-black">
            {firstLetter}
          </div>
        </button>

        <div className="flex-1">
          <div className="text-xs font-extrabold">
            <a
              className="hover:underline"
              href={`https://www.instagram.com/${String(lead.username || "").replace(/^@+/, "").trim()}/`}
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
