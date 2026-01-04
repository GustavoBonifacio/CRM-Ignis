import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  manifest: {
    name: "CRM IGNIS",
    description: "CRM Kanban local para leads do Instagram (uso interno).",
    version: "0.0.1",

    permissions: ["storage", "sidePanel", "alarms", "downloads", "unlimitedStorage"],
    optional_permissions: ["notifications"],

    // ✅ IMPORTANTE: permitir instagram.com e www.instagram.com
    host_permissions: ["https://www.instagram.com/*", "https://instagram.com/*"],

    action: {
      default_title: "CRM IGNIS",
    },

    side_panel: {
      default_path: "sidepanel/index.html",
    },
  },

  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
