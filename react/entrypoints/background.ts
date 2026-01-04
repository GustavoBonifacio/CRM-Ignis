// react/entrypoints/background.ts
import { defineBackground } from "wxt/utils/define-background";

type Board = "OUTBOUND" | "SOCIAL";

function normalizeUsername(raw: string) {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

async function addLeadInRepo(username: string, board: Board) {
  // Import dinâmico pra NÃO quebrar build se o export tiver nome diferente
  const repo: any = await import("../src/db/leadsRepo");

  const payload = {
    username,
    board,
    workspace: "Padrão",
    source: "IG_BUTTONS",
  };

  // Tentativas (fica compatível com várias assinaturas possíveis)
  const tries: Array<() => Promise<any>> = [];

  if (typeof repo.addLead === "function") {
    tries.push(() => Promise.resolve(repo.addLead(payload)));
    tries.push(() => Promise.resolve(repo.addLead(username, board, "Padrão")));
    tries.push(() => Promise.resolve(repo.addLead(username, board)));
  }

  if (typeof repo.upsertLead === "function") {
    tries.push(() => Promise.resolve(repo.upsertLead(payload)));
    tries.push(() => Promise.resolve(repo.upsertLead(username, board, "Padrão")));
  }

  if (typeof repo.createLead === "function" && typeof repo.saveLead === "function") {
    tries.push(async () => {
      const lead = await repo.createLead(payload);
      return repo.saveLead(lead);
    });
  }

  let lastErr: any = null;
  for (const fn of tries) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }

  const exports = Object.keys(repo).sort().join(", ");
  throw new Error(
    `Não consegui chamar o repositório (leadsRepo). Exports encontrados: [${exports}]. Erro: ${lastErr?.message || lastErr}`
  );
}

export default defineBackground(() => {
  console.log("[CRM IGNIS] background ativo ✅");

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "CRM_IGNIS_ADD_LEAD") {
      (async () => {
        try {
          const username = normalizeUsername(String(msg.username || ""));
          const board = msg.board as Board;

          if (!username) throw new Error("username vazio/ inválido");
          if (board !== "OUTBOUND" && board !== "SOCIAL") throw new Error(`board inválido: ${board}`);

          await addLeadInRepo(username, board);

          sendResponse({ ok: true });
        } catch (e: any) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();

      // IMPORTANTÍSSIMO: mantém o canal aberto pro sendResponse async
      return true;
    }
  });
});
