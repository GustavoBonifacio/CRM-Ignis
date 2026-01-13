import Dexie, { Table } from "dexie";

export type BoardType = "OUTBOUND" | "SOCIAL";

export type Lead = {
  id: string;
  workspaceId: string;

  board: BoardType;
  stageId: string;

  username: string;
  usernameLower: string;

  displayName?: string;

  // ✅ NOVO: foto de perfil (opcional)
  avatarUrl?: string;

  priority: "low" | "medium" | "high";
  tags: string[];

  notes: string;

  createdAt: number;
  updatedAt: number;
  lastTouchedAt: number;
  nextFollowUpAt?: number;
};

export type Task = {
  id: string;
  workspaceId: string;
  leadId: string;

  title: string;
  dueAt: number;
  doneAt?: number;

  status: "open" | "done" | "snoozed";
  snoozeUntil?: number;
};

export type ActivityEvent = {
  id: string;
  workspaceId: string;
  leadId: string;

  type:
    | "CREATED"
    | "MOVED_STAGE"
    | "NOTE_UPDATED"
    | "PRIORITY_CHANGED"
    | "TASK_CREATED"
    | "TASK_DONE";

  fromStageId?: string;
  toStageId?: string;

  at: number;
  day: number; // formato: yyyymmdd (para filtro por dia)
};

/**
 * Métricas diárias (controle igual planilha)
 * dateKey: "YYYY-MM-DD" (data local)
 */
export type DailyMetrics = {
  id: string; // `${workspaceId}:${board}:${dateKey}`
  workspaceId: string;
  board: BoardType;
  dateKey: string;

  // Novas abordagens
  msg1Disparos: number;
  msg1Respostas: number;
  msg2Disparos: number;
  msg2Respostas: number; // opcional (pode ficar 0)

  ctaDisparos: number;
  agendNovos: number;

  // Follow-up
  followEnviados: number;
  followRespostas: number;
  followCta: number;
  agendFollow: number;

  // controle
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
};

/**
 * Banco local (IndexedDB) usando Dexie
 */
export class CrmIgnisDB extends Dexie {
  leads!: Table<Lead, string>;
  tasks!: Table<Task, string>;
  events!: Table<ActivityEvent, string>;
  dailyMetrics!: Table<DailyMetrics, string>;

  constructor() {
    super("crm-ignis");

    this.version(1).stores({
      leads:
        "id, workspaceId, [workspaceId+usernameLower], [workspaceId+board+stageId], *tags, [workspaceId+nextFollowUpAt], createdAt, updatedAt",
      tasks: "id, workspaceId, [workspaceId+status], [workspaceId+dueAt], [workspaceId+leadId]",
      events:
        "id, workspaceId, [workspaceId+type+day], [workspaceId+type+toStageId+day], [workspaceId+leadId], at",
    });

    // v2: adiciona tabela de métricas diárias
    this.version(2).stores({
      leads:
        "id, workspaceId, [workspaceId+usernameLower], [workspaceId+board+stageId], *tags, [workspaceId+nextFollowUpAt], createdAt, updatedAt",
      tasks: "id, workspaceId, [workspaceId+status], [workspaceId+dueAt], [workspaceId+leadId]",
      events:
        "id, workspaceId, [workspaceId+type+day], [workspaceId+type+toStageId+day], [workspaceId+leadId], at",
      dailyMetrics:
        "id, workspaceId, [workspaceId+board+dateKey], [workspaceId+dateKey], [workspaceId+board+closedAt], dateKey, updatedAt, closedAt",
    });
  }
}

export const db = new CrmIgnisDB();

export function toDayKey(ts: number) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return Number(`${yyyy}${mm}${dd}`);
}
