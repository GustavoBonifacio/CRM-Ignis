import React from "react";

function getDashboardUrl() {
  return chrome.runtime.getURL("dashboard.html");
}

async function openOrFocusDashboard() {
  const dashboardUrl = getDashboardUrl();

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url ? t.url.startsWith(dashboardUrl) : false));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: dashboardUrl, active: true });
}

export default function App() {
  const [err, setErr] = React.useState<string | null>(null);

  return (
    <div className="w-[280px] p-3 bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
      <div className="font-black text-sm">CRM IGNIS</div>
      <div className="text-[11px] text-[rgb(var(--muted))] mt-0.5">Acesso rápido ao Kanban</div>

      <button
        className="mt-3 w-full text-xs px-3 py-2 rounded-[var(--radius)] border border-[rgb(var(--border))] hover:bg-white/5"
        onClick={async () => {
          setErr(null);
          try {
            await openOrFocusDashboard();
            window.close();
          } catch (e: any) {
            console.error(e);
            setErr(e?.message || "Erro ao abrir o dashboard");
          }
        }}
      >
        Abrir Kanban (Dashboard)
      </button>

      {err ? <div className="mt-2 text-[11px] text-red-400">{err}</div> : null}
    </div>
  );
}
