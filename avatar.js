// Shared avatar helpers for cache-first rendering and resiliency
// Vanilla ES module; used by dashboard, statistics, index (landing), and roadmap

export const AVATAR_CACHE_KEY = 'avatarCache:v1';
export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getCachedAvatar() {
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.url || !parsed.dataUrl || !parsed.ts) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedAvatar(url, dataUrl) {
  try {
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ url, dataUrl, ts: Date.now() }));
  } catch {}
}

export async function fetchAvatarAsDataURL(url) {
  if (!url) return null;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal });
    if (!res.ok) throw new Error('Avatar fetch failed: ' + res.status);
    const blob = await res.blob();
    if (blob.size > 600000) return null; // skip very large images for localStorage
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return dataUrl;
  } finally {
    clearTimeout(to);
  }
}

// Per-host cooldown (sessionStorage) to avoid hammering avatar CDNs on 429s
export const AVATAR_FAIL_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const AVATAR_COOLDOWN_SS_KEY = 'avatarCooldownHosts:v1';
const avatarCooldownByHost = new Map();
try {
  const raw = sessionStorage.getItem(AVATAR_COOLDOWN_SS_KEY);
  if (raw) {
    const obj = JSON.parse(raw);
    for (const [host, ts] of Object.entries(obj)) avatarCooldownByHost.set(host, ts);
  }
} catch {}

function persistAvatarCooldown() {
  try {
    const obj = {}; for (const [k,v] of avatarCooldownByHost.entries()) obj[k]=v;
    sessionStorage.setItem(AVATAR_COOLDOWN_SS_KEY, JSON.stringify(obj));
  } catch {}
}

function hostFromURL(url) { try { return new URL(url).host; } catch { return ''; } }

export function isAvatarOnCooldown(url) {
  const host = hostFromURL(url); if (!host) return false;
  const ts = avatarCooldownByHost.get(host); if (!ts) return false;
  return (Date.now() - ts) < AVATAR_FAIL_COOLDOWN_MS;
}

export function setAvatarCooldown(url) {
  const host = hostFromURL(url); if (!host) return;
  avatarCooldownByHost.set(host, Date.now());
  persistAvatarCooldown();
}

// Utility: generate a rounded initials avatar as a data URI (used as placeholder)
export function initialsAvatarDataUri(initial = '?', size = 40) {
  const s = Math.max(16, size);
  const fontSize = Math.floor(s / 2);
  const safe = (initial || '?').toString().toUpperCase().slice(0,1);
  const svg = `<svg width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg"><rect width="${s}" height="${s}" rx="${Math.floor(s/2)}" ry="${Math.floor(s/2)}" fill="#a2c4c6"/><text x="50%" y="50%" font-family="Nunito, sans-serif" font-size="${fontSize}" fill="#FFF" text-anchor="middle" dy=".3em">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
