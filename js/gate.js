// Optional "family password" gate. This is a soft lock that keeps a borrowed or
// shared device from casually opening the ledger -- it is NOT real security: the
// hash below ships in the page, and all data lives unencrypted in this browser.
//
// To change the password: run sha256Hex(normalizeCode('your-new-password')) in
// the browser console and paste the 64-char result into FAMILY_CODE_HASH.
// To disable the gate entirely: set FAMILY_CODE_HASH to '' (empty string).

export const FAMILY_CODE_HASH =
  'f7a349ff3236d6df3cd6e940d7bde0de0b902eb9592f525ea38c0be14bf3ba7d';

const UNLOCK_KEY = 'macaron.gate.v1';

export function gateEnabled() {
  return FAMILY_CODE_HASH.length === 64;
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
  return (await sha256Hex(normalizeCode(code))) === FAMILY_CODE_HASH;
}

export function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === FAMILY_CODE_HASH; }
  catch { return false; }
}
export function rememberUnlock() {
  try { localStorage.setItem(UNLOCK_KEY, FAMILY_CODE_HASH); } catch { /* ignore */ }
}
export function forgetUnlock() {
  try { localStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ }
}
