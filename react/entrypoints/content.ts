// react/entrypoints/content.ts
import { defineContentScript } from "#imports";

const IGNIS_CRM_VERSION = "2026-01-04-v3";
const UI_ROOT_ID = "ignis-crm-ui-root";
const TOAST_ID = "ignis-crm-toast";
const STORAGE_KEY = "ignis.crm.leads.v1";

type Board = "OUTBOUND" | "SOCIAL";

type Lead = {
  id: string;
  board: Board;
  username: string;
  profileUrl: string;
  createdAt: string;
};

export default defineContentScript({
  matches: ["*://*.instagram.com/*"],
  main() {
    // Assinatura pra provar que ESTE arquivo está rodando
    (window as any).__IGNIS_CRM_VERSION__ = IGNIS_CRM_VERSION;
    console.log(`[IGNIS CRM ${IGNIS_CRM_VERSION}] content script ativo ✅`);

    let lastHref = location.href;

    const tick = () => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        // troca de rota SPA
        removeUi();
      }

      if (isProfilePage()) ensureUi();
      else removeUi();
    };

    tick();
    setInterval(tick, 500);
  },
});

function ensureUi() {
  if (document.getElementById(UI_ROOT_ID)) return;

  const root = document.createElement("div");
  root.id = UI_ROOT_ID;
  root.style.zIndex = "2147483647";
  root.style.display = "flex";
  root.style.gap = "8px";
  root.style.alignItems = "center";

  const btnOutbound = makeButton("Outbound");
  const btnSocial = makeButton("Social");

  btnOutbound.onclick = () => saveLead("OUTBOUND");
  btnSocial.onclick = () => saveLead("SOCIAL");

  root.appendChild(btnOutbound);
  root.appendChild(btnSocial);

  // Tenta colocar no HEADER primeiro (como você quer)
  const header = document.querySelector("header");
  if (header) {
    root.style.position = "relative";
    root.style.marginTop = "10px";
    (header as HTMLElement).appendChild(root);
    return;
  }

  // Fallback: fixo na tela
  root.style.position = "fixed";
  root.style.right = "16px";
  root.style.bottom = "16px";
  document.documentElement.appendChild(root);
}

function removeUi() {
  document.getElementById(UI_ROOT_ID)?.remove();
}

function makeButton(label: string) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = `+ ${label}`;

  btn.style.border = "1px solid rgba(255,255,255,0.20)";
  btn.style.background = "rgba(0,0,0,0.72)";
  btn.style.color = "white";
  btn.style.padding = "8px 12px";
  btn.style.borderRadius = "999px";
  btn.style.cursor = "pointer";
  btn.style.fontSize = "13px";
  btn.style.fontWeight = "700";
  btn.style.backdropFilter = "blur(8px)";

  btn.onmouseenter = () => (btn.style.background = "rgba(0,0,0,0.85)");
  btn.onmouseleave = () => (btn.style.background = "rgba(0,0,0,0.72)");

  return btn;
}

async function saveLead(board: Board) {
  try {
    const username = getUsernameFromUrl();
    if (!username) throw new Error("Não consegui pegar o username pela URL.");

    const lead: Lead = {
      id: `${board}:${username}`,
      board,
      username,
      profileUrl: `${location.origin}/${username}/`,
      createdAt: new Date().toISOString(),
    };

    const state = await chrome.storage.local.get([STORAGE_KEY]);
    const existing =
      (state[STORAGE_KEY] as { leadsById?: Record<string, Lead>; order?: string[]; version?: number } | undefined) ??
      {};

    const leadsById = existing.leadsById ?? {};
    const order = existing.order ?? [];

    leadsById[lead.id] = lead;
    const nextOrder = [lead.id, ...order.filter((id) => id !== lead.id)];

    await chrome.storage.local.set({
      [STORAGE_KEY]: { version: 1, leadsById, order: nextOrder },
    });

    toast(`✅ Salvo em ${board}: @${username}`, "success");
    console.log("[IGNIS CRM] Lead salvo:", lead);
  } catch (e) {
    console.error("[IGNIS CRM] Erro ao salvar lead:", e);
    toast("❌ Erro ao salvar (veja o console).", "error");
  }
}

function isProfilePage(): boolean {
  const path = location.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 1) return false;

  const u = parts[0];
  if (!/^[a-zA-Z0-9._]+$/.test(u)) return false;

  const reserved = new Set(["explore", "reels", "direct", "accounts", "p", "stories", "tv"]);
  return !reserved.has(u.toLowerCase());
}

function getUsernameFromUrl(): string | null {
  const path = location.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 1) return null;

  const u = parts[0];
  if (!u || !/^[a-zA-Z0-9._]+$/.test(u)) return null;

  const reserved = new Set(["explore", "reels", "direct", "accounts", "p", "stories", "tv"]);
  if (reserved.has(u.toLowerCase())) return null;

  return u;
}

function toast(message: string, variant: "success" | "error") {
  document.getElementById(TOAST_ID)?.remove();

  const el = document.createElement("div");
  el.id = TOAST_ID;
  el.textContent = message;

  el.style.position = "fixed";
  el.style.left = "16px";
  el.style.bottom = "70px";
  el.style.zIndex = "2147483647";
  el.style.maxWidth = "460px";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "13px";
  el.style.fontWeight = "800";
  el.style.color = "white";
  el.style.background = variant === "success" ? "rgba(16, 185, 129, 0.92)" : "rgba(239, 68, 68, 0.92)";
  el.style.boxShadow = "0 10px 25px rgba(0,0,0,0.25)";
  el.style.backdropFilter = "blur(8px)";

  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
