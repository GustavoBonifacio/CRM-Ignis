import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  manifest: {
    name: "CRM IGNIS",
    description: "CRM Kanban local para leads do Instagram (uso interno).",
    version: "0.0.1",

    // tabs = abrir/focar dashboard
    permissions: ["storage", "sidePanel", "tabs", "alarms", "downloads", "unlimitedStorage"],
    optional_permissions: ["notifications"],
    host_permissions: ["https://www.instagram.com/*", "https://instagram.com/*"],

    action: {
      default_title: "CRM IGNIS",
      default_popup: "popup.html",
    },

    side_panel: {
      default_path: "sidepanel.html",
    },
  },

  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
