import { defineContentScript } from "#imports";

/**
 * ⚠️ Conteúdo DESATIVADO:
 * - Não injeta botões no Instagram
 * - A captura de lead agora é feita SOMENTE via SidePanel:
 *   "Capturar lead da aba atual"
 */
export default defineContentScript({
  matches: ["*://*.instagram.com/*"],
  main() {
    // Mantemos o content script apenas para compatibilidade,
    // mas SEM qualquer alteração no DOM.
    console.log("[CRM IGNIS] content script ativo (sem UI) ✅");
  },
});
