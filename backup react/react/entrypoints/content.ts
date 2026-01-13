import { defineContentScript } from "#imports";

/**
 * Content script SEM UI:
 * - Não injeta nada no Instagram
 * - Responde pedidos do SidePanel para pegar avatar do perfil
 */
export default defineContentScript({
  // ✅ pega instagram.com e www.instagram.com
  matches: ["*://instagram.com/*", "*://*.instagram.com/*"],
  main() {
    console.log("[CRM IGNIS] content script ativo ✅", location.href);

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== "object") return;

      if ((msg as any).type === "CRM_IGNIS_GET_PROFILE_META") {
        (async () => {
          try {
            const username = getUsernameFromUrl();
            if (!username) {
              sendResponse({ ok: false, reason: "Não é página de perfil." });
              return;
            }

            const apiAvatar = await fetchAvatarViaWebProfileInfo(username);

            const fallbackAvatar = apiAvatar || extractAvatarUrlFallback(username);

            console.log("[CRM IGNIS] avatar capturado:", fallbackAvatar ? "SIM" : "NÃO", {
              username,
              via: apiAvatar ? "api/v1/users/web_profile_info" : "fallback",
            });

            sendResponse({ ok: true, username, avatarUrl: fallbackAvatar });
          } catch (e: any) {
            console.error("[CRM IGNIS] erro ao pegar avatar:", e);
            sendResponse({ ok: false, reason: e?.message || String(e) });
          }
        })();

        return true; // resposta async
      }
    });
  },
});

async function fetchAvatarViaWebProfileInfo(username: string): Promise<string | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
    username,
  )}`;

  const csrf = getCookie("csrftoken");

  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-IG-App-ID": "936619743392459",
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
    });

    console.log("[CRM IGNIS] web_profile_info status:", res.status);

    if (!res.ok) return null;

    const json = await res.json();

    const pic =
      json?.data?.user?.profile_pic_url_hd ||
      json?.data?.user?.profile_pic_url ||
      null;

    return cleanUrl(pic);
  } catch (e) {
    console.log("[CRM IGNIS] web_profile_info fetch falhou:", e);
    return null;
  }
}

function extractAvatarUrlFallback(username: string): string | null {
  const meta =
    getMeta("meta[property='og:image']") ||
    getMeta("meta[name='twitter:image']") ||
    getMeta("meta[property='og:image:secure_url']");

  const metaClean = cleanUrl(meta);
  if (metaClean) return metaClean;

  const dom = getAvatarFromDom(username);
  const domClean = cleanUrl(dom);
  if (domClean) return domClean;

  const html = document.documentElement?.innerHTML || "";
  const fromJson =
    matchInHtml(html, /"profile_pic_url_hd":"([^"]+)"/) ||
    matchInHtml(html, /"profile_pic_url":"([^"]+)"/);

  return cleanUrl(fromJson);
}

function getMeta(selector: string): string | null {
  const el = document.querySelector(selector) as HTMLMetaElement | null;
  const v = el?.content?.trim();
  return v ? v : null;
}

function getAvatarFromDom(username: string): string | null {
  const root = document.querySelector("main") || document.body;
  const imgs = Array.from(root.querySelectorAll("img"))
    .map((img) => ({
      src: (img.getAttribute("src") || "").trim(),
      alt: (img.getAttribute("alt") || "").toLowerCase(),
      width: Number(img.getAttribute("width") || "0"),
      height: Number(img.getAttribute("height") || "0"),
    }))
    .filter((x) => x.src.startsWith("http"));

  if (imgs.length === 0) return null;

  const u = username.toLowerCase();

  const bestAlt = imgs.find(
    (x) =>
      (x.alt.includes("perfil") || x.alt.includes("profile")) &&
      (x.alt.includes(u) || x.alt.includes(`@${u}`)),
  );
  if (bestAlt?.src) return bestAlt.src;

  const profileAlt = imgs.find(
    (x) =>
      x.alt.includes("perfil") ||
      x.alt.includes("profile picture") ||
      x.alt.includes("foto do perfil") ||
      x.alt.includes("profile photo"),
  );
  if (profileAlt?.src) return profileAlt.src;

  const biggest = imgs
    .slice()
    .sort((a, b) => (b.width * b.height || 0) - (a.width * a.height || 0))[0];

  return biggest?.src || null;
}

function matchInHtml(html: string, re: RegExp): string | null {
  const m = html.match(re);
  if (!m?.[1]) return null;

  const raw = m[1];
  const decoded = raw
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  return decoded;
}

function cleanUrl(url: any): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http")) return null;

  const txt = document.createElement("textarea");
  txt.innerHTML = trimmed;
  const decoded = txt.value.trim();

  return decoded.startsWith("http") ? decoded : null;
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}=([^;]*)`),
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function getUsernameFromUrl(): string | null {
  const path = location.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 1) return null;

  const username = parts[0]?.trim().replace(/^@/, "");
  if (!username) return null;

  if (!/^[a-zA-Z0-9._]+$/.test(username)) return null;

  const reserved = new Set(["explore", "reels", "direct", "accounts", "p", "stories", "tv"]);
  if (reserved.has(username.toLowerCase())) return null;

  return username;
}
