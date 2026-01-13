import React from "react";
import { addLead, deleteLead, listLeadsByBoard } from "../db/leadsRepo";
import type { BoardType, DailyMetrics } from "../db/db";
import {
  closeDailyMetrics,
  emptyDailyMetrics,
  getDailyMetrics,
  getWeekMetrics,
  reopenDailyMetrics,
  todayDateKey,
  upsertDailyMetrics,
} from "../db/metricsRepo";
import { parseInstagramUsername } from "../instagram/parseInstagram";
import { BackupRestorePanel } from "../ui/BackupRestorePanel";

type Tab = "Outbound" | "Social" | "Tasks" | "Filtros" | "Métricas" | "Settings";

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

function openInstagramProfile(username: string) {
  const u = String(username || "").replace(/^@+/, "").trim();
  if (!u) return;
  const url = `https://www.instagram.com/${u}/`;
  chrome.tabs.create({ url, active: true });
}

function cx(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(" ");
}

function toLocalDayRange(dateStr: string): { start: number; end: number } | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;

  // evita bug de fuso (Date("YYYY-MM-DD") vira UTC)
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

function safeInt(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

function pct(numer: number, denom: number): number {
  if (!denom) return 0;
  return (numer / denom) * 100;
}

// % para colunas de resposta (D e F no Sheets): 0 casas (ex.: 14%)
function fmtPctInt(p: number): string {
  if (!Number.isFinite(p)) return "0%";
  return `${Math.round(p)}%`;
}

// % para colunas de conversão (I e O no Sheets): 2 casas (ex.: 1,67%)
function fmtPct2(p: number): string {
  if (!Number.isFinite(p)) return "0,00%";
  return `${p.toFixed(2).replace(".", ",")}%`;
}

function shortDayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return names[dt.getDay()] ?? "";
}

function fullDayNamePT(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return names[dt.getDay()] ?? "";
}

async function copyToClipboard(text: string) {
  // preferencial (moderno)
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback (mais compatível)
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function SidePanelApp() {
  const [tab, setTab] = React.useState<Tab>("Outbound");
  const workspaceId = "default";
  const activeBoard = tabToBoard(tab);

  const [leads, setLeads] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState("");

  const [dayFilter, setDayFilter] = React.useState<string>(""); // YYYY-MM-DD

  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | null>(null);

  function toast(m: string) {
    setToastMsg(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2500);
  }

  const reload = React.useCallback(async () => {
    if (!activeBoard) {
      setLeads([]);
      return;
    }
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
    if (!activeBoard) return;
    const id = window.setInterval(() => {
      void reload();
    }, 1500);
    return () => window.clearInterval(id);
  }, [reload]);

  async function captureFromCurrentTab() {
    if (!activeBoard) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabInfo = tabs?.[0];
    const url = tabInfo?.url;

    if (!url) {
      toast("Não consegui ler a aba ativa.");
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

  // Só "Leads novos" (fila para abordagem)
  const leadsToApproach = React.useMemo(() => {
    return leads.filter((l) => String(l?.stageId ?? "").trim() === "Leads novos");
  }, [leads]);

  // filtro por dia (createdAt)
  const dayRange = React.useMemo(() => toLocalDayRange(dayFilter), [dayFilter]);
  const dayFiltered = React.useMemo(() => {
    const base = leadsToApproach;
    if (!dayRange) return base;
    return base.filter((l) => {
      const createdAt = Number(l?.createdAt ?? 0);
      return createdAt >= dayRange.start && createdAt < dayRange.end;
    });
  }, [leadsToApproach, dayRange]);

  // busca
  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const base = dayFiltered;
    if (!q) return base;
    return base.filter(
      (l) =>
        String(l.username || "").toLowerCase().includes(q) ||
        String(l.displayName || "").toLowerCase().includes(q),
    );
  }, [dayFiltered, q]);

  const dayLabel = React.useMemo(() => {
    if (!dayRange) return null;
    try {
      return new Date(dayRange.start).toLocaleDateString("pt-BR");
    } catch {
      return dayFilter;
    }
  }, [dayFilter, dayRange]);

  return (
    <div className="min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))] p-3">
      <div className="flex items-center gap-2">
        <div className="font-black">CRM IGNIS</div>
        <div className="text-xs text-[rgb(var(--muted))]">• Padrão</div>
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        {(["Outbound", "Social", "Tasks", "Filtros", "Métricas", "Settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={cx(
              "text-xs px-3 py-1 rounded-[var(--radius)] border",
              tab === t
                ? "border-[rgb(var(--accent))] bg-white/5"
                : "border-[rgb(var(--border))] hover:bg-white/5",
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

      {tab === "Métricas" ? (
        <MetricsPanel workspaceId={workspaceId} toast={toast} />
      ) : activeBoard ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="text-xs w-full px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="text-[11px] text-[rgb(var(--muted))] shrink-0">Filtrar por dia:</div>

            <input
              type="date"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className="text-xs w-full px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
              title="Mostra somente leads adicionados no dia selecionado"
            />

            <button
              type="button"
              className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
              onClick={() => setDayFilter(todayAsInputDate())}
              title="Filtrar por hoje"
            >
              Hoje
            </button>

            {dayFilter ? (
              <button
                type="button"
                className="text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
                onClick={() => setDayFilter("")}
                title="Remover filtro de dia"
              >
                Limpar
              </button>
            ) : null}
          </div>

          <div className="mt-3 border border-[rgb(var(--border))] rounded-[var(--radius)] overflow-hidden">
            <div className="p-2 text-xs font-bold border-b border-[rgb(var(--border))] bg-white/5">
              Leads para abordar ({filtered.length}){dayLabel ? ` • ${dayLabel}` : ""}
            </div>

            <div className="p-2 flex flex-col gap-2">
              {filtered.map((l) => {
                const firstLetter = (String(l.username || "?")[0] || "?").toUpperCase();

                return (
                  <div
                    key={l.id}
                    className="p-2 rounded-[var(--radius)] border border-[rgb(var(--border))] bg-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full border border-[rgb(var(--border))] bg-white/5 grid place-items-center text-[10px] font-black">
                        {firstLetter}
                      </div>

                      <div className="flex-1">
                        <button
                          type="button"
                          className="text-xs font-extrabold hover:underline text-left"
                          onClick={() => openInstagramProfile(l.username)}
                          title="Abrir perfil no Instagram"
                        >
                          @{l.username}
                        </button>

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
                );
              })}

              {filtered.length === 0 ? (
                <div className="text-xs text-[rgb(var(--muted))] mt-2">Nenhum lead encontrado.</div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="mt-3">
          {tab === "Settings" ? (
            <BackupRestorePanel />
          ) : (
            <div className="text-xs text-[rgb(var(--muted))]">
              Aba <span className="font-bold">{tab}</span> (em construção).
            </div>
          )}
        </div>
      )}

      {toastMsg ? (
        <div className="fixed right-3 bottom-3 text-xs font-bold px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] bg-white/10 backdrop-blur shadow-[var(--shadow-sm)]">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================
// MÉTRICAS
// =============================================================

function MetricsPanel({
  workspaceId,
  toast,
}: {
  workspaceId: string;
  toast: (msg: string) => void;
}) {
  const [board, setBoard] = React.useState<BoardType>("OUTBOUND");
  const [dateKey, setDateKey] = React.useState<string>(todayDateKey());
  const [metrics, setMetrics] = React.useState<DailyMetrics | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showMsg2Resp, setShowMsg2Resp] = React.useState(false);
  const [weekOpen, setWeekOpen] = React.useState(false);
  const [weekRows, setWeekRows] = React.useState<Array<{ dateKey: string; metrics: DailyMetrics | null }>>([]);

  const computed = React.useMemo(() => {
    const m = metrics;
    if (!m) {
      return {
        pctMsg1: 0,
        pctMsg2: 0,
        pctCta: 0,
        agendTotal: 0,
        contatosTotal: 0,
        pctAgendAcoes: 0,
      };
    }

    const pctMsg1 = pct(safeInt(m.msg1Respostas), safeInt(m.msg1Disparos));
    const pctMsg2 = pct(safeInt(m.msg2Respostas), safeInt(m.msg2Disparos));
    const pctCta = pct(safeInt(m.agendNovos), safeInt(m.ctaDisparos));
    const agendTotal = safeInt(m.agendNovos) + safeInt(m.agendFollow);
    const contatosTotal = safeInt(m.msg1Disparos) + safeInt(m.followEnviados);
    const pctAgendAcoes = pct(agendTotal, contatosTotal);
    return { pctMsg1, pctMsg2, pctCta, agendTotal, contatosTotal, pctAgendAcoes };
  }, [metrics]);

  async function load(dateKeyArg: string, boardArg: BoardType) {
    setBusy(true);
    try {
      const existing = await getDailyMetrics(workspaceId, boardArg, dateKeyArg);
      const base = existing ?? emptyDailyMetrics(workspaceId, boardArg, dateKeyArg);
      setMetrics(base);
      setShowMsg2Resp((base.msg2Respostas ?? 0) > 0);
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar métricas (veja o Console).");
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    void load(dateKey, board);
  }, [dateKey, board]);

  function patchField<K extends keyof DailyMetrics>(key: K, value: DailyMetrics[K]) {
    setMetrics((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
  }

  function incField<K extends keyof DailyMetrics>(key: K, step: number) {
    setMetrics((prev) => {
      if (!prev) return prev;
      const current = safeInt((prev as any)[key]);
      const next = safeInt(current + step);
      return { ...prev, [key]: next } as any;
    });
  }

  async function handleSave() {
    if (!metrics) return;
    try {
      setBusy(true);
      const saved = await upsertDailyMetrics(metrics);
      setMetrics(saved);
      toast("✅ Métricas salvas");
    } catch (err) {
      console.error(err);
      toast("Erro ao salvar métricas (veja o Console).");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    try {
      setBusy(true);
      const closed = await closeDailyMetrics(workspaceId, board, dateKey);
      setMetrics(closed);
      toast("✅ Dia fechado");
    } catch (err) {
      console.error(err);
      toast("Erro ao fechar o dia (veja o Console).");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    try {
      setBusy(true);
      const reopened = await reopenDailyMetrics(workspaceId, board, dateKey);
      if (reopened) {
        setMetrics(reopened);
        toast("Dia reaberto");
      }
    } catch (err) {
      console.error(err);
      toast("Erro ao reabrir o dia (veja o Console).");
    } finally {
      setBusy(false);
    }
  }

  async function toggleWeek() {
    const next = !weekOpen;
    setWeekOpen(next);
    if (!next) return;
    try {
      setBusy(true);
      const rows = await getWeekMetrics(workspaceId, board, dateKey);
      setWeekRows(rows);
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar semana (veja o Console).");
    } finally {
      setBusy(false);
    }
  }

  const isClosed = Boolean(metrics?.closedAt);
  const disableInputs = busy || isClosed;

  const MetricRow = ({
    label,
    value,
    onChange,
    onInc1,
    onInc5,
    disabled,
    hint,
  }: {
    label: string;
    value: number;
    onChange: (next: number) => void;
    onInc1: () => void;
    onInc5: () => void;
    disabled?: boolean;
    hint?: string;
  }) => (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1">
        <div className="text-xs">{label}</div>
        {hint ? <div className="text-[11px] text-[rgb(var(--muted))]">{hint}</div> : null}
      </div>

      <input
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        className={cx(
          "text-xs w-20 px-2 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]",
          disabled ? "opacity-60" : "",
        )}
        value={String(value)}
        onChange={(e) => onChange(safeInt(e.target.value))}
      />

      <button
        type="button"
        disabled={disabled}
        className={cx(
          "text-[11px] px-2 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
          disabled ? "opacity-50" : "",
        )}
        onClick={onInc1}
        title="+1"
      >
        +1
      </button>

      <button
        type="button"
        disabled={disabled}
        className={cx(
          "text-[11px] px-2 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
          disabled ? "opacity-50" : "",
        )}
        onClick={onInc5}
        title="+5"
      >
        +5
      </button>
    </div>
  );

  const Section = ({
    title,
    children,
    right,
    headerRight,
  }: {
    title: string;
    children: React.ReactNode;
    right?: React.ReactNode;
    headerRight?: React.ReactNode;
  }) => (
    <div className="mt-3 border border-[rgb(var(--border))] rounded-[var(--radius)] overflow-hidden">
      <div className="p-2 text-xs font-bold border-b border-[rgb(var(--border))] bg-white/5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div>{title}</div>
          {right ? <div className="text-[11px] text-[rgb(var(--muted))] font-normal">{right}</div> : null}
        </div>
        {headerRight ? <div>{headerRight}</div> : null}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );

  async function handleCopyForSheets() {
    if (!metrics) return;

    // Ordem EXATA do Sheets (A → P):
    // A dia da semana
    // B Disparos Msg1
    // C Respostas Msg1
    // D % Resp Msg1
    // E Disparos Msg2
    // F % Resp Msg2
    // G DISPARO CTA
    // H Agendamentos (Novos)
    // I Conversão CTA vs Agendamento
    // J follow up
    // K resposta followup
    // L CTA FEITO
    // M Agendamentos (Follow)
    // N agendamento total
    // O % de agendamentos sob ações totais
    // P contatos totais no dia (Novos + Follow Ups)

    const A = fullDayNamePT(dateKey);
    const B = safeInt(metrics.msg1Disparos);
    const C = safeInt(metrics.msg1Respostas);
    const D = fmtPctInt(computed.pctMsg1);
    const E = safeInt(metrics.msg2Disparos);
    const F = fmtPctInt(computed.pctMsg2);
    const G = safeInt(metrics.ctaDisparos);
    const H = safeInt(metrics.agendNovos);
    const I = fmtPct2(computed.pctCta);
    const J = safeInt(metrics.followEnviados);
    const K = safeInt(metrics.followRespostas);
    const L = safeInt(metrics.followCta);
    const M = safeInt(metrics.agendFollow);
    const N = safeInt(computed.agendTotal);
    const O = fmtPct2(computed.pctAgendAcoes);
    const P = safeInt(computed.contatosTotal);

    const tsv = [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P].join("\t") + "\n";
    const ok = await copyToClipboard(tsv);
    if (ok) toast("📋 Copiado! Cole no Sheets (coluna A da linha do dia)");
    else toast("Não consegui copiar. Tente novamente.");
  }

  const WeekPanel = () => {
    if (!weekOpen) return null;
    return (
      <div className="mt-3 border border-[rgb(var(--border))] rounded-[var(--radius)] overflow-hidden">
        <div className="p-2 text-xs font-bold border-b border-[rgb(var(--border))] bg-white/5">Semana</div>
        <div className="p-2 flex flex-col gap-2">
          {weekRows.map((r) => {
            const m = r.metrics;
            const contatosTotal = m ? safeInt(m.msg1Disparos) + safeInt(m.followEnviados) : 0;
            const agendTotal = m ? safeInt(m.agendNovos) + safeInt(m.agendFollow) : 0;
            const pctAg = pct(agendTotal, contatosTotal);

            const label = `${shortDayLabel(r.dateKey)} • ${r.dateKey.split("-").reverse().join("/")}`;
            return (
              <details
                key={r.dateKey}
                className="rounded-[var(--radius)] border border-[rgb(var(--border))] bg-white/5"
                open={false}
              >
                <summary className="cursor-pointer list-none p-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-bold">{label}</div>
                  <div className="text-[11px] text-[rgb(var(--muted))]">
                    Contatos: <span className="font-bold">{contatosTotal}</span> • Agend.:{" "}
                    <span className="font-bold">{agendTotal}</span> • {fmtPct2(pctAg)}
                  </div>
                </summary>
                <div className="p-2 text-[11px] text-[rgb(var(--muted))]">
                  {m ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="font-bold text-[rgb(var(--text))]">Novas</div>
                        <div>
                          Msg1: {m.msg1Disparos} | Resp1: {m.msg1Respostas} ({fmtPctInt(pct(m.msg1Respostas, m.msg1Disparos))})
                        </div>
                        <div>
                          Msg2: {m.msg2Disparos} | Resp2: {m.msg2Respostas} ({fmtPctInt(pct(m.msg2Respostas, m.msg2Disparos))})
                        </div>
                        <div>
                          CTA: {m.ctaDisparos} | Agend: {m.agendNovos} ({fmtPct2(pct(m.agendNovos, m.ctaDisparos))})
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-[rgb(var(--text))]">Follow</div>
                        <div>
                          Follow: {m.followEnviados} | Resp: {m.followRespostas}
                        </div>
                        <div>
                          CTA: {m.followCta} | Agend: {m.agendFollow}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>Sem dados</div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="text-[11px] text-[rgb(var(--muted))] shrink-0">Data:</div>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value || todayDateKey())}
            className="text-xs w-full px-3 py-2 rounded-[var(--radius)] bg-[rgb(var(--panel))] border border-[rgb(var(--border))] outline-none focus:border-[rgb(var(--accent))]"
            disabled={busy}
          />
        </div>

        <button
          className={cx(
            "text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
            busy ? "opacity-60" : "",
          )}
          onClick={() => void handleSave()}
          disabled={busy}
        >
          Salvar
        </button>

        {isClosed ? (
          <button
            className={cx(
              "text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
              busy ? "opacity-60" : "",
            )}
            onClick={() => void handleReopen()}
            disabled={busy}
            title="Reabrir para editar"
          >
            Reabrir
          </button>
        ) : (
          <button
            className={cx(
              "text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
              busy ? "opacity-60" : "",
            )}
            onClick={() => void handleClose()}
            disabled={busy}
          >
            Fechar dia
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {([
            { label: "Outbound", value: "OUTBOUND" as const },
            { label: "Social", value: "SOCIAL" as const },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              className={cx(
                "text-xs px-3 py-1 rounded-[var(--radius)] border",
                board === opt.value
                  ? "border-[rgb(var(--accent))] bg-white/5"
                  : "border-[rgb(var(--border))] hover:bg-white/5",
              )}
              onClick={() => setBoard(opt.value)}
              disabled={busy}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="text-xs text-[rgb(var(--accent))] hover:underline"
          onClick={() => void toggleWeek()}
          disabled={busy}
        >
          {weekOpen ? "Fechar semana" : "Ver semana"} →
        </button>
      </div>

      {isClosed ? (
        <div className="mt-2 text-[11px] text-[rgb(var(--muted))]">✅ Dia fechado • edição bloqueada</div>
      ) : null}

      <Section title="Novas abordagens" right={`% Resp Msg1: ${fmtPctInt(computed.pctMsg1)} • % Resp Msg2: ${fmtPctInt(computed.pctMsg2)}`}>
        {metrics ? (
          <>
            <div className="text-[11px] text-[rgb(var(--muted))] mb-1">Mensagem 1 (primeiro contato)</div>
            <MetricRow
              label="Disparos Mensagem 1"
              value={safeInt(metrics.msg1Disparos)}
              onChange={(v) => patchField("msg1Disparos", v)}
              onInc1={() => incField("msg1Disparos", 1)}
              onInc5={() => incField("msg1Disparos", 5)}
              disabled={disableInputs}
            />
            <MetricRow
              label="Respostas Mensagem 1"
              value={safeInt(metrics.msg1Respostas)}
              onChange={(v) => patchField("msg1Respostas", v)}
              onInc1={() => incField("msg1Respostas", 1)}
              onInc5={() => incField("msg1Respostas", 5)}
              disabled={disableInputs}
              hint={`% de Respostas (Msg 1): ${fmtPctInt(computed.pctMsg1)}`}
            />

            <div className="mt-2 text-[11px] text-[rgb(var(--muted))] mb-1">Mensagem 2</div>
            <MetricRow
              label="Disparos Mensagem 2"
              value={safeInt(metrics.msg2Disparos)}
              onChange={(v) => patchField("msg2Disparos", v)}
              onInc1={() => incField("msg2Disparos", 1)}
              onInc5={() => incField("msg2Disparos", 5)}
              disabled={disableInputs}
              hint={`% de Respostas (Msg 2): ${fmtPctInt(computed.pctMsg2)}`}
            />

            {!showMsg2Resp ? (
              <button
                type="button"
                className="mt-1 text-[11px] text-[rgb(var(--accent))] hover:underline"
                onClick={() => setShowMsg2Resp(true)}
                disabled={disableInputs}
              >
                + (Opcional) Adicionar respostas Msg 2
              </button>
            ) : (
              <MetricRow
                label="Respostas Msg 2"
                value={safeInt(metrics.msg2Respostas)}
                onChange={(v) => patchField("msg2Respostas", v)}
                onInc1={() => incField("msg2Respostas", 1)}
                onInc5={() => incField("msg2Respostas", 5)}
                disabled={disableInputs}
              />
            )}
          </>
        ) : (
          <div className="text-xs text-[rgb(var(--muted))]">Carregando…</div>
        )}
      </Section>

      <Section title="CTA → Agendamento (Novos)" right={`Conversão (CTA→Agendamento): ${fmtPct2(computed.pctCta)}`}>
        {metrics ? (
          <>
            <MetricRow
              label="DISPARO CTA"
              value={safeInt(metrics.ctaDisparos)}
              onChange={(v) => patchField("ctaDisparos", v)}
              onInc1={() => incField("ctaDisparos", 1)}
              onInc5={() => incField("ctaDisparos", 5)}
              disabled={disableInputs}
            />
            <MetricRow
              label="Agendamentos (Novos)"
              value={safeInt(metrics.agendNovos)}
              onChange={(v) => patchField("agendNovos", v)}
              onInc1={() => incField("agendNovos", 1)}
              onInc5={() => incField("agendNovos", 5)}
              disabled={disableInputs}
            />
          </>
        ) : null}
      </Section>

      <Section title="Follow-up">
        {metrics ? (
          <>
            <MetricRow
              label="Follow up"
              value={safeInt(metrics.followEnviados)}
              onChange={(v) => patchField("followEnviados", v)}
              onInc1={() => incField("followEnviados", 1)}
              onInc5={() => incField("followEnviados", 5)}
              disabled={disableInputs}
            />
            <MetricRow
              label="Resposta followup"
              value={safeInt(metrics.followRespostas)}
              onChange={(v) => patchField("followRespostas", v)}
              onInc1={() => incField("followRespostas", 1)}
              onInc5={() => incField("followRespostas", 5)}
              disabled={disableInputs}
            />
            <MetricRow
              label="CTA FEITO (follow)"
              value={safeInt(metrics.followCta)}
              onChange={(v) => patchField("followCta", v)}
              onInc1={() => incField("followCta", 1)}
              onInc5={() => incField("followCta", 5)}
              disabled={disableInputs}
            />
            <MetricRow
              label="Agendamentos (follow)"
              value={safeInt(metrics.agendFollow)}
              onChange={(v) => patchField("agendFollow", v)}
              onInc1={() => incField("agendFollow", 1)}
              onInc5={() => incField("agendFollow", 5)}
              disabled={disableInputs}
            />
          </>
        ) : null}
      </Section>

      <Section
        title="Fechamento do dia (sequência do Sheets)"
        headerRight={
          <button
            type="button"
            className={cx(
              "text-[11px] px-2 py-1 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5",
              !metrics ? "opacity-50 cursor-not-allowed" : "",
            )}
            onClick={() => void handleCopyForSheets()}
            disabled={!metrics}
            title="Copia uma linha tabulada pronta para colar no Google Sheets (coluna A)"
          >
            Copiar para Sheets
          </button>
        }
      >
        {metrics ? (
          <div className="text-[11px] text-[rgb(var(--muted))] flex flex-col gap-1">
            <div className="text-xs text-[rgb(var(--text))] font-bold mb-1">
              Cole no Sheets na linha do dia (começando na coluna A)
            </div>

            <div><span className="text-[rgb(var(--text))] font-semibold">A</span> Dia da semana: <span className="font-bold text-[rgb(var(--text))]">{fullDayNamePT(dateKey)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">B</span> Disparos Mensagem 1: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.msg1Disparos)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">C</span> Respostas Mensagem 1: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.msg1Respostas)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">D</span> % de Respostas (Msg 1): <span className="font-bold text-[rgb(var(--text))]">{fmtPctInt(computed.pctMsg1)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">E</span> Disparos Mensagem 2: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.msg2Disparos)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">F</span> % de Respostas (Msg 2): <span className="font-bold text-[rgb(var(--text))]">{fmtPctInt(computed.pctMsg2)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">G</span> DISPARO CTA: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.ctaDisparos)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">H</span> Agendamentos (Novos): <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.agendNovos)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">I</span> Conversão CTA vs Agendamento: <span className="font-bold text-[rgb(var(--text))]">{fmtPct2(computed.pctCta)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">J</span> follow up: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.followEnviados)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">K</span> resposta followup: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.followRespostas)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">L</span> CTA FEITO: <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.followCta)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">M</span> Agendamentos (follow): <span className="font-bold text-[rgb(var(--text))]">{safeInt(metrics.agendFollow)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">N</span> agendamento total: <span className="font-bold text-[rgb(var(--text))]">{safeInt(computed.agendTotal)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">O</span> % de agendamentos sob ações totais: <span className="font-bold text-[rgb(var(--text))]">{fmtPct2(computed.pctAgendAcoes)}</span></div>
            <div><span className="text-[rgb(var(--text))] font-semibold">P</span> contatos totais no dia (Novos + Follow Ups): <span className="font-bold text-[rgb(var(--text))]">{safeInt(computed.contatosTotal)}</span></div>
          </div>
        ) : (
          <div className="text-xs text-[rgb(var(--muted))]">Carregando…</div>
        )}
      </Section>

      <WeekPanel />
    </div>
  );
}
