// Optional "family password" gate. This is a soft lock that keeps a borrowed or
// shared device from casually opening the ledger -- it is NOT real security: the
// default hash below ships in the page, and all data lives unencrypted in this
// browser.
//
// There are two ways to set the password:
//
//  1. In the app: Settings -> 家庭密碼 -> 修改家庭密碼. That stores the new
//     password's hash in THIS browser only (the `macaron.gate.override.v1` key),
//     overriding the default below. Good for changing it without touching code.
//
//  2. In the source: change FAMILY_CODE_HASH below. That is the default for every
//     device and every fresh install. To compute a hash, run in the console:
//         const m = await import('./js/gate.js');
//         console.log(await m.sha256Hex(m.normalizeCode('your-new-password')));
//     To disable the gate by default, set FAMILY_CODE_HASH = '' (empty string).

export const FAMILY_CODE_HASH =
  'f7a349ff3236d6df3cd6e940d7bde0de0b902eb9592f525ea38c0be14bf3ba7d';

const UNLOCK_KEY = 'macaron.gate.v1';
const OVERRIDE_KEY = 'macaron.gate.override.v1';

// Read the per-device override, if one has been set in the app.
// Returns a string hash ('' means "gate disabled on this device"), or null when
// no override exists (so the baked-in default applies).
function readOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.hash === 'string' ? parsed.hash : null;
  } catch { return null; }
}

// The hash actually in force on this device.
export function effectiveHash() {
  const override = readOverride();
  return override === null ? FAMILY_CODE_HASH : override;
}

export function gateEnabled() {
  return effectiveHash().length === 64;
}

// True when the user has set a device-specific password (vs. the source default).
export function hasOverride() {
  return readOverride() !== null;
}

export function normalizeCode(code) {
  return String(code).trim().toLowerCase();
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkCode(code) {
  return (await sha256Hex(normalizeCode(code))) === effectiveHash();
}

export function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === effectiveHash(); }
  catch { return false; }
}
export function rememberUnlock() {
  try { localStorage.setItem(UNLOCK_KEY, effectiveHash()); } catch { /* ignore */ }
}
export function forgetUnlock() {
  try { localStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ }
}

// --- in-app password management (stored on this device) ---------------------

// Set a new family password on this device, and keep this device unlocked.
export async function setPassword(plain) {
  const hash = await sha256Hex(normalizeCode(plain));
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ hash }));
    localStorage.setItem(UNLOCK_KEY, hash);
  } catch { /* ignore */ }
}

// Turn the gate off on this device (no password needed to open the ledger).
export function disablePassword() {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ hash: '' }));
    localStorage.removeItem(UNLOCK_KEY);
  } catch { /* ignore */ }
}

// Drop the device override and fall back to the source default.
export function resetToDefault() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
    if (FAMILY_CODE_HASH.length === 64) localStorage.setItem(UNLOCK_KEY, FAMILY_CODE_HASH);
    else localStorage.removeItem(UNLOCK_KEY);
  } catch { /* ignore */ }
}
