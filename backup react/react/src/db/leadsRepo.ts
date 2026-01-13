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
  stageId?: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
}): Promise<AddLeadResult> {
  const now = Date.now();
  const usernameLower = String(input.username || "").toLowerCase().trim();
  const stageId = (input.stageId && String(input.stageId).trim()) || "Leads novos";

  if (!input.workspaceId) throw new Error("workspaceId obrigatório");
  if (!usernameLower) throw new Error("username obrigatório");
  if (input.board !== "OUTBOUND" && input.board !== "SOCIAL") throw new Error("board inválido");

  const cleanAvatar =
    typeof input.avatarUrl === "string" && input.avatarUrl.startsWith("http")
      ? input.avatarUrl
      : undefined;

  // Duplicado: mesmo workspace + mesmo username
  const existing = await db.leads
    .where("[workspaceId+usernameLower]")
    .equals([input.workspaceId, usernameLower])
    .first();

  if (existing) {
    // ✅ Se já existe e não tem foto, mas agora conseguimos, atualiza silenciosamente
    if (!existing.avatarUrl && cleanAvatar) {
      await db.leads.update(existing.id, {
        avatarUrl: cleanAvatar,
        updatedAt: now,
        lastTouchedAt: now,
      });
      const refreshed = await db.leads.get(existing.id);
      return { status: "exists", lead: refreshed ?? existing };
    }

    return { status: "exists", lead: existing };
  }

  const lead: Lead = {
    id: newId(),
    workspaceId: input.workspaceId,

    board: input.board,
    stageId,

    username: String(input.username).trim().replace(/^@/, ""),
    usernameLower,

    displayName: input.displayName?.trim() || undefined,

    // ✅ NOVO
    avatarUrl: cleanAvatar,

    priority: "medium",
    tags: [],

    notes: "",

    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
  };

  const event: ActivityEvent = {
    id: newId(),
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    type: "CREATED",
    at: now,
    day: toDayKey(now),
  };

  await db.transaction("rw", db.leads, db.events, async () => {
    await db.leads.add(lead);
    await db.events.add(event);
  });

  return { status: "created", lead };
}

export async function listLeadsByBoard(workspaceId: string, board: BoardType) {
  const items = await db.leads
    .where("[workspaceId+board+stageId]")
    .between([workspaceId, board, Dexie.minKey], [workspaceId, board, Dexie.maxKey])
    .toArray();

  items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return items;
}

export async function updateLead(input: {
  workspaceId: string;
  leadId: string;
  patch: Partial<
    Pick<
      Lead,
      "board" | "stageId" | "notes" | "tags" | "priority" | "displayName" | "nextFollowUpAt" | "avatarUrl"
    >
  >;
}) {
  const lead = await db.leads.get(input.leadId);
  if (!lead) return null;
  if (lead.workspaceId !== input.workspaceId) return null;

  const now = Date.now();
  const patch = { ...input.patch };

  const next: Lead = {
    ...lead,
    ...patch,
    stageId: patch.stageId ? String(patch.stageId).trim() : lead.stageId,
    updatedAt: now,
    lastTouchedAt: now,
  };

  const events: ActivityEvent[] = [];

  if (next.stageId !== lead.stageId) {
    events.push({
      id: newId(),
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      type: "MOVED_STAGE",
      fromStageId: lead.stageId,
      toStageId: next.stageId,
      at: now,
      day: toDayKey(now),
    });
  }

  if (next.notes !== lead.notes) {
    events.push({
      id: newId(),
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      type: "NOTE_UPDATED",
      at: now,
      day: toDayKey(now),
    });
  }

  if (next.priority !== lead.priority) {
    events.push({
      id: newId(),
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      type: "PRIORITY_CHANGED",
      at: now,
      day: toDayKey(now),
    });
  }

  await db.transaction("rw", db.leads, db.events, async () => {
    await db.leads.put(next);
    if (events.length) await db.events.bulkAdd(events);
  });

  return next;
}

export async function moveLeadStage(input: { workspaceId: string; leadId: string; toStageId: string }) {
  return updateLead({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    patch: { stageId: input.toStageId },
  });
}

export async function deleteLead(input: { workspaceId: string; leadId: string }) {
  const lead = await db.leads.get(input.leadId);
  if (!lead) return;
  if (lead.workspaceId !== input.workspaceId) return;

  await db.transaction("rw", db.leads, db.tasks, db.events, async () => {
    await db.tasks.where("[workspaceId+leadId]").equals([input.workspaceId, input.leadId]).delete();
    await db.events.where("[workspaceId+leadId]").equals([input.workspaceId, input.leadId]).delete();
    await db.leads.delete(input.leadId);
  });
}
