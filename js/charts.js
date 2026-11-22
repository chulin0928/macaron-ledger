// Small dependency-free SVG charts. Each function returns an SVG markup string.
const NS = 'http://www.w3.org/2000/svg';

// Round a value up to a "nice" axis maximum (1/2/5 * 10^n).
export function niceCeil(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

function arc(cx, cy, r, startAngle, endAngle) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(startAngle);
  const [x2, y2] = p(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// slices: [{ cents, color }]. Renders a ring; empty state handled by caller.
export function donutChart(slices, { size = 200, thickness = 26 } = {}) {
  const total = slices.reduce((a, s) => a + s.cents, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  if (total <= 0) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F0E4D6" stroke-width="${thickness}"/>
    </svg>`;
  }
  let angle = -Math.PI / 2;
  const paths = slices.filter((s) => s.cents > 0).map((s) => {
    const sweep = (s.cents / total) * Math.PI * 2;
    const start = angle;
    let end = angle + sweep;
    angle = end;
    // Avoid a full 360° arc collapsing to a point.
    if (end - start >= Math.PI * 2) end = start + Math.PI * 2 - 0.0001;
    return `<path d="${arc(cx, cy, r, start, end)}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-linecap="butt"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${paths}</svg>`;
}

// points: [{ label, cents }]. Line chart with soft fill.
export function lineChart(points, { width = 320, height = 140, color = '#D8698A' } = {}) {
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = niceCeil(Math.max(1, ...points.map((p) => p.cents)));
  const n = points.length;
  const x = (i) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (c) => pad.t + h - (c / max) * h;
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.cents).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${pad.t + h} L ${x(0).toFixed(1)} ${pad.t + h} Z`;
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.cents).toFixed(1)}" r="2.5" fill="${color}"/>`).join('');
  const labels = points.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#8B7A72">${p.label}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
    <path d="${area}" fill="${color}22"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}

// series: [{ label, income, expense }]. Grouped bars (income + expense per month).
export function barChart(series, { width = 320, height = 160 } = {}) {
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = niceCeil(Math.max(1, ...series.flatMap((s) => [s.income, s.expense])));
  const n = series.length || 1;
  const group = w / n;
  const bw = Math.min(14, group / 3);
  const y = (c) => pad.t + h - (c / max) * h;
  const bars = series.map((s, i) => {
    const gx = pad.l + i * group + group / 2;
    const incX = gx - bw - 1;
    const expX = gx + 1;
    const incY = y(s.income);
    const expY = y(s.expense);
    return `
      <rect x="${incX.toFixed(1)}" y="${incY.toFixed(1)}" width="${bw}" height="${(pad.t + h - incY).toFixed(1)}" rx="3" fill="#7FA86E"/>
      <rect x="${expX.toFixed(1)}" y="${expY.toFixed(1)}" width="${bw}" height="${(pad.t + h - expY).toFixed(1)}" rx="3" fill="#D8698A"/>
      <text x="${gx.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#8B7A72">${s.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${bars}</svg>`;
}

export const svgNS = NS;
