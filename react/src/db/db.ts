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
 * Banco local (IndexedDB) usando Dexie
 * - Funciona por perfil do Chrome automaticamente
 * - Aguenta volume (50k+) com índices bem definidos
 */
export class CrmIgnisDB extends Dexie {
  leads!: Table<Lead, string>;
  tasks!: Table<Task, string>;
  events!: Table<ActivityEvent, string>;

  constructor() {
    super("crm-ignis");

    this.version(1).stores({
      /**
       * Índices importantes:
       * - [workspaceId+usernameLower] => detectar duplicado rápido
       * - [workspaceId+board+stageId] => kanban por coluna
       * - *tags => multiEntry pra filtrar por tag
       * - [workspaceId+nextFollowUpAt] => follow-up
       */
      leads:
        "id, workspaceId, [workspaceId+usernameLower], [workspaceId+board+stageId], *tags, [workspaceId+nextFollowUpAt], createdAt, updatedAt",

      /**
       * Tasks:
       * - por status
       * - por data
       * - por lead
       */
      tasks: "id, workspaceId, [workspaceId+status], [workspaceId+dueAt], [workspaceId+leadId]",

      /**
       * Events:
       * - filtro por dia e etapa (base do seu filtro por “entrou na etapa em X dia”)
       */
      events:
        "id, workspaceId, [workspaceId+type+day], [workspaceId+type+toStageId+day], [workspaceId+leadId], at",
    });
  }
}

export const db = new CrmIgnisDB();

/**
 * Converte timestamp em "chave do dia" (yyyymmdd)
 * Observação: usa o fuso local do computador (Brasil, no seu caso).
 */
export function toDayKey(ts: number) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return Number(`${yyyy}${mm}${dd}`);
}
