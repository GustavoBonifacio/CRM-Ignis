export type Board = "OUTBOUND" | "SOCIAL";

export type Stage =
  | "LEADS_NOVOS"
  | "ABORDAGEM_ENVIADA"
  | "ABORDAGEM_RESPONDIDA"
  | "PERGUNTA_ENVIADA"
  | "PERGUNTA_RESPONDIDA"
  | "CTA_REALIZADO"
  | "ACEITOU_CALL"
  | "AGENDAMENTO_COMPLETO"
  | "COMPARECEU"
  | "NO_SHOW"
  | "REAGENDAR"
  | "FECHADO_GANHO"
  | "PERDIDO";

export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "LEADS_NOVOS", label: "Leads novos" },
  { id: "ABORDAGEM_ENVIADA", label: "Abordagem enviada" },
  { id: "ABORDAGEM_RESPONDIDA", label: "Abordagem respondida" },
  { id: "PERGUNTA_ENVIADA", label: "Pergunta enviada" },
  { id: "PERGUNTA_RESPONDIDA", label: "Pergunta respondida" },
  { id: "CTA_REALIZADO", label: "CTA realizado" },
  { id: "ACEITOU_CALL", label: "Aceitou call" },
  { id: "AGENDAMENTO_COMPLETO", label: "Agendamento completo" },
  { id: "COMPARECEU", label: "Compareceu" },
  { id: "NO_SHOW", label: "No-show" },
  { id: "REAGENDAR", label: "Reagendar" },
  { id: "FECHADO_GANHO", label: "Fechado (Ganho)" },
  { id: "PERDIDO", label: "Perdido" },
];

export const BOARDS: Array<{ id: Board; label: string }> = [
  { id: "OUTBOUND", label: "Outbound" },
  { id: "SOCIAL", label: "Social Selling" },
];

export type Lead = {
  id: string;
  username: string;
  profileUrl: string;
  board: Board;
  stage: Stage;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadsState = {
  version: 2;
  leadsById: Record<string, Lead>;
  order: string[];
};

export const LEADS_KEY = "crmIgnis:leads:v2";

function nowIso() {
  return new Date().toISOString();
}

function emptyState(): LeadsState {
  return { version: 2, leadsById: {}, order: [] };
}

function normalizeBoard(v: unknown): Board {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "SOCIAL" || s === "SOCIAL SELLING" || s === "SOCIAL_SELLING") return "SOCIAL";
  return "OUTBOUND";
}

function normalizeStage(v: unknown): Stage {
  const s = String(v ?? "").trim().toUpperCase();

  // se vier algo já compatível:
  const direct = STAGES.find((x) => x.id === s);
  if (direct) return direct.id;

  // possíveis nomes antigos/similares:
  const map: Record<string, Stage> = {
    NOVO: "LEADS_NOVOS",
    NOVOS: "LEADS_NOVOS",
    "LEAD_NOVO": "LEADS_NOVOS",
    "LEADS NOVOS": "LEADS_NOVOS",

    "ABORDAGEM": "ABORDAGEM_ENVIADA",
    "ABORDAGEM RESPONDIDA": "ABORDAGEM_RESPONDIDA",

    "PERGUNTA": "PERGUNTA_ENVIADA",
    "CTA": "CTA_REALIZADO",

    "FECHADO": "FECHADO_GANHO",
    "GANHO": "FECHADO_GANHO",
  };

  return map[s] ?? "LEADS_NOVOS";
}

function isLeadLike(x: any): boolean {
  if (!x || typeof x !== "object") return false;
  const hasUser = typeof x.username === "string" || typeof x.user === "string" || typeof x.handle === "string";
  const hasUrl = typeof x.profileUrl === "string" || typeof x.url === "string" || typeof x.profile === "string";
  return hasUser && hasUrl;
}

function toLead(x: any): Lead | null {
  if (!isLeadLike(x)) return null;

  const username = String(x.username ?? x.user ?? x.handle ?? "").trim().replace(/^@/, "");
  let profileUrl = String(x.profileUrl ?? x.url ?? x.profile ?? "").trim();

  if (!username) return null;

  // Normaliza URL do instagram
  if (!profileUrl.includes("instagram.com")) {
    profileUrl = `https://www.instagram.com/${username}/`;
  }
  if (!profileUrl.endsWith("/")) profileUrl += "/";

  const id = String(x.id ?? `${username}::${normalizeBoard(x.board ?? x.funnel)}`).trim();

  const createdAt = String(x.createdAt ?? x.created ?? x.ts ?? nowIso());
  const updatedAt = String(x.updatedAt ?? x.updated ?? createdAt);

  return {
    id,
    username,
    profileUrl,
    board: normalizeBoard(x.board ?? x.funnel ?? x.pipeline ?? "OUTBOUND"),
    stage: normalizeStage(x.stage ?? x.status ?? "LEADS_NOVOS"),
    note: String(x.note ?? x.obs ?? x.notes ?? ""),
    createdAt,
    updatedAt,
  };
}

function coerceState(value: any): LeadsState | null {
  if (!value || typeof value !== "object") return null;

  // formato v2 (nosso)
  if (value.version === 2 && value.leadsById && value.order) {
    return value as LeadsState;
  }

  // formatos comuns
  const candidates: any[] = [];
  if (Array.isArray(value)) candidates.push(...value);
  if (Array.isArray(value.leads)) candidates.push(...value.leads);
  if (Array.isArray(value.items)) candidates.push(...value.items);
  if (value.leadsById && typeof value.leadsById === "object") {
    candidates.push(...Object.values(value.leadsById));
  }

  const leads: Lead[] = [];
  for (const c of candidates) {
    const lead = toLead(c);
    if (lead) leads.push(lead);
  }

  if (!leads.length) return null;

  const state = emptyState();
  for (const lead of leads) {
    state.leadsById[lead.id] = lead;
    state.order.push(lead.id);
  }
  return state;
}

export async function loadLeadsState(): Promise<LeadsState> {
  // 1) tenta carregar nosso estado (v2)
  const direct = await browser.storage.local.get(LEADS_KEY);
  const existing = direct?.[LEADS_KEY];
  if (existing) {
    const parsed = coerceState(existing);
    if (parsed) return parsed;
  }

  // 2) MIGRAÇÃO AUTOMÁTICA:
  // varre todo storage local da extensão e tenta achar uma estrutura parecida com leads.
  const all = await browser.storage.local.get(null as any);
  let best: LeadsState | null = null;

  for (const [, raw] of Object.entries(all ?? {})) {
    let v: any = raw;

    // se estiver salvo como string JSON
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        // ignore
      }
    }

    const candidate = coerceState(v);
    if (!candidate) continue;

    const size = candidate.order.length;
    const bestSize = best?.order.length ?? 0;
    if (size > bestSize) best = candidate;
  }

  // 3) se achou algo, salva no nosso formato
  if (best) {
    await saveLeadsState(best);
    return best;
  }

  return emptyState();
}

export async function saveLeadsState(state: LeadsState): Promise<void> {
  await browser.storage.local.set({ [LEADS_KEY]: state });
}

export async function upsertLead(input: {
  username: string;
  profileUrl: string;
  board: Board;
}): Promise<Lead> {
  const state = await loadLeadsState();
  const username = input.username.trim().replace(/^@/, "");
  const board = input.board;

  const id = `${username}::${board}`;
  const existing = state.leadsById[id];

  const now = nowIso();
  const lead: Lead = {
    id,
    username,
    profileUrl: input.profileUrl.endsWith("/") ? input.profileUrl : `${input.profileUrl}/`,
    board,
    stage: existing?.stage ?? "LEADS_NOVOS",
    note: existing?.note ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  state.leadsById[id] = lead;

  // joga pra cima da fila
  state.order = [id, ...state.order.filter((x) => x !== id)];

  await saveLeadsState(state);
  return lead;
}

export async function updateLead(id: string, patch: Partial<Pick<Lead, "stage" | "note" | "updatedAt">>): Promise<void> {
  const state = await loadLeadsState();
  const lead = state.leadsById[id];
  if (!lead) return;

  state.leadsById[id] = {
    ...lead,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  };

  // se mudou stage, puxa pro topo
  if (patch.stage && patch.stage !== lead.stage) {
    state.order = [id, ...state.order.filter((x) => x !== id)];
  }

  await saveLeadsState(state);
}

export async function removeLead(id: string): Promise<Lead | null> {
  const state = await loadLeadsState();
  const lead = state.leadsById[id];
  if (!lead) return null;

  delete state.leadsById[id];
  state.order = state.order.filter((x) => x !== id);

  await saveLeadsState(state);
  return lead;
}

export async function restoreLead(lead: Lead, index: number): Promise<void> {
  const state = await loadLeadsState();
  state.leadsById[lead.id] = lead;

  const without = state.order.filter((x) => x !== lead.id);
  const safeIndex = Math.max(0, Math.min(index, without.length));
  without.splice(safeIndex, 0, lead.id);
  state.order = without;

  await saveLeadsState(state);
}
