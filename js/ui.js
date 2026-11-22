// Tiny DOM helpers and shared visual bits. No framework -- just functions that
// build elements and a macaron renderer.
import { iconEmoji } from './data.js';

// el('div.card', { onclick }, [children]) style helper.
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// A macaron: two shells with a filling, flavour-coloured, glyph in the centre.
export function macaron(category, size = 44) {
  const wrap = el('span.macaron', { style: { width: `${size}px`, height: `${size}px` } });
  wrap.innerHTML = `
    <svg viewBox="0 0 48 44" width="${size}" height="${size}" aria-hidden="true">
      <ellipse cx="24" cy="13" rx="21" ry="12" fill="${category.color}"/>
      <ellipse cx="24" cy="31" rx="21" ry="12" fill="${category.color}"/>
      <rect x="4" y="19" width="40" height="7" rx="3.5" fill="${category.colorDeep}"/>
    </svg>
    <span class="macaron-glyph" style="font-size:${Math.round(size * 0.42)}px">${iconEmoji(category.icon)}</span>`;
  return wrap;
}

export function button(label, { variant = 'primary', icon, onClick, style } = {}) {
  const b = el(`button.btn.btn-${variant}`, { type: 'button', style });
  if (icon) b.append(el('span.btn-icon', { text: iconEmoji(icon) }));
  b.append(el('span', { text: label }));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function card(children, cls = '') {
  return el(`div.card ${cls}`.trim(), {}, children);
}

export function haptic(settings, pattern = 10) {
  if (settings?.hapticsEnabled && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

// Confirm/alert kept as native dialogs (same behaviour as the original app).
export function confirmDialog(message) { return window.confirm(message); }
