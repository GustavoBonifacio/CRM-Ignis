// react/entrypoints/background.ts
import { defineBackground } from "wxt/utils/define-background";

type Board = "OUTBOUND" | "SOCIAL";

const WORKSPACE_ID = "default";

function normalizeUsername(raw: string) {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

async function addLeadInRepo(username: string, board: Board) {
  const repo: any = await import("../src/db/leadsRepo");

  // Assinatura correta do nosso repo atual (Dexie)
  if (typeof repo.addLead === "function") {
    return repo.addLead({
      workspaceId: WORKSPACE_ID,
      board,
      stageId: "LEADS_NOVOS",
      username,
    });
  }

  throw new Error("leadsRepo.addLead não encontrado.");
}

function broadcastToast(message: string, board?: Board) {
  try {
    chrome.runtime.sendMessage({
      type: "CRM_IGNIS_TOAST",
      payload: { message, board },
    });
  } catch {
    // sem stress
  }
}

export default defineBackground(() => {
  console.log("[CRM IGNIS] background ativo ✅");

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "CRM_IGNIS_ADD_LEAD") {
      (async () => {
        try {
          const username = normalizeUsername(String((msg as any).username || ""));
          const board = (msg as any).board as Board;

          if (!username) throw new Error("username vazio/ inválido");
          if (board !== "OUTBOUND" && board !== "SOCIAL") throw new Error(`board inválido: ${board}`);

          const result = await addLeadInRepo(username, board);

          const status = result?.status as string | undefined;
          if (status === "created") broadcastToast(`✅ Capturado: @${username}`, board);
          if (status === "exists") broadcastToast(`⚠️ Já existe: @${username}`, board);
          if (!status) broadcastToast(`✅ Salvo: @${username}`, board);

          sendResponse({ ok: true, result });
        } catch (e: any) {
          broadcastToast(`❌ Erro ao salvar lead: ${e?.message || String(e)}`);
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();

      return true; // mantém canal aberto
    }
  });
});
