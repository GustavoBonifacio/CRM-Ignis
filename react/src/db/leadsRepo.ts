import Dexie from "dexie";
import { db, Lead, ActivityEvent, BoardType, toDayKey } from "./db";

function newId() {
  return crypto.randomUUID();
}

export type AddLeadResult =
  | { status: "created"; lead: Lead }
  | { status: "exists"; lead: Lead };

export async function addLead(input: {
  workspaceId: string;
  board: BoardType;
  stageId: string;
  username: string;
  displayName?: string;
}): Promise<AddLeadResult> {
  const now = Date.now();
  const usernameLower = input.username.toLowerCase().trim();

  // 1) Checar duplicado: mesmo workspace + mesmo username
  const existing = await db.leads
    .where("[workspaceId+usernameLower]")
    .equals([input.workspaceId, usernameLower])
    .first();

  if (existing) {
    // Atualiza lastTouched porque você tentou adicionar de novo
    await db.leads.update(existing.id, { lastTouchedAt: now, updatedAt: now });
    const refreshed = (await db.leads.get(existing.id))!;
    return { status: "exists", lead: refreshed };
  }

  // 2) Criar lead novo
  const leadId = newId();

  const lead: Lead = {
    id: leadId,
    workspaceId: input.workspaceId,

    board: input.board,
    stageId: input.stageId,

    username: input.username.trim(),
    usernameLower,

    displayName: input.displayName ?? "",

    priority: "medium",
    tags: [],
    notes: "",

    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
  };

  // 3) Criar evento de auditoria (Activity Log)
  const event: ActivityEvent = {
    id: newId(),
    workspaceId: input.workspaceId,
    leadId: leadId,
    type: "CREATED",
    at: now,
    day: toDayKey(now),
  };

  // 4) Salvar tudo em transação (ou salva tudo ou nada)
  await db.transaction("rw", db.leads, db.events, async () => {
    await db.leads.add(lead);
    await db.events.add(event);
  });

  return { status: "created", lead };
}

/**
 * Lista leads APENAS do board selecionado (OUTBOUND ou SOCIAL)
 * Usa o índice [workspaceId+board+stageId] e pega o range inteiro.
 */
export async function listLeadsByBoard(workspaceId: string, board: BoardType) {
  const items = await db.leads
    .where("[workspaceId+board+stageId]")
    .between([workspaceId, board, Dexie.minKey], [workspaceId, board, Dexie.maxKey])
    .toArray();

  // Ordena por mais recente (updatedAt desc)
  items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return items;
}

/**
 * Exclui o lead + todos os registros ligados a ele:
 * - tasks do lead
 * - events do lead
 */
export async function deleteLead(input: {
  workspaceId: string;
  leadId: string;
}) {
  const lead = await db.leads.get(input.leadId);
  if (!lead) return;
  if (lead.workspaceId !== input.workspaceId) return;

  await db.transaction("rw", db.leads, db.tasks, db.events, async () => {
    await db.tasks.where("[workspaceId+leadId]").equals([input.workspaceId, input.leadId]).delete();
    await db.events.where("[workspaceId+leadId]").equals([input.workspaceId, input.leadId]).delete();
    await db.leads.delete(input.leadId);
  });
}
