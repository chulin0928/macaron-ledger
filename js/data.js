// Static data for Macaron Ledger: macaron flavours (colours), category icons,
// the default expense/income categories, and the supported currencies.
// All of this was carried over from the original app so existing data stays valid.

// Each flavour is one macaron colour. `color` is the shell, `colorDeep` the filling/accent.
export const FLAVORS = [
  { name: '覆盆子', color: '#F4A7B9', colorDeep: '#D8698A' },
  { name: '開心果', color: '#BFD8B0', colorDeep: '#7FA86E' },
  { name: '薰衣草', color: '#C9B6E4', colorDeep: '#8E76B8' },
  { name: '檸檬', color: '#F7E3A1', colorDeep: '#C9A93C' },
  { name: '藍莓', color: '#AFCBEA', colorDeep: '#5F8BC4' },
  { name: '薄荷', color: '#B5E3D8', colorDeep: '#5FA898' },
  { name: '蜜桃', color: '#F9C9A8', colorDeep: '#D98A5C' },
  { name: '巧克力', color: '#C7A48C', colorDeep: '#8A5E42' },
  { name: '玫瑰', color: '#F6C1CF', colorDeep: '#C4607E' },
  { name: '抹茶', color: '#CFE0B5', colorDeep: '#6E9A4C' },
  { name: '海鹽', color: '#C8DCE8', colorDeep: '#5A8AA5' },
  { name: '焦糖', color: '#E8C9A0', colorDeep: '#B07A3A' },
  { name: '紫薯', color: '#D8C2E8', colorDeep: '#7F5AA6' },
  { name: '香草', color: '#F1E3C8', colorDeep: '#A8895A' },
];

export function flavorAt(i) {
  const f = FLAVORS[((i % FLAVORS.length) + FLAVORS.length) % FLAVORS.length];
  return { color: f.color, colorDeep: f.colorDeep };
}

// Pick the next flavour not already used (falls back to cycling once all are taken).
export function nextFlavor(categories) {
  const used = new Set(categories.map((c) => c.color));
  const free = FLAVORS.find((f) => !used.has(f.color));
  const f = free || FLAVORS[categories.length % FLAVORS.length];
  return { color: f.color, colorDeep: f.colorDeep };
}

// Icon glyphs available in the category editor. Keys match the original Ionicons
// names; the value is the emoji we render in the macaron centre.
export const ICON_CHOICES = [
  'cash', 'wallet', 'trending-up', 'briefcase', 'ribbon', 'time', 'ticket',
  'water', 'flash', 'bonfire', 'wifi', 'home', 'business', 'key', 'construct',
  'car', 'speedometer', 'pricetag', 'bus', 'airplane', 'bicycle', 'train',
  'restaurant', 'cafe', 'basket', 'cart', 'storefront', 'fast-food', 'wine',
  'gift', 'flower', 'heart', 'people', 'paw', 'school', 'book',
  'game-controller', 'medkit', 'fitness', 'barbell', 'shield-checkmark',
  'shield', 'umbrella', 'document-text', 'receipt', 'card', 'map', 'calculator',
  'shirt', 'cut', 'sparkles', 'phone-portrait', 'laptop', 'tv', 'musical-notes',
  'ellipsis-horizontal-circle',
];

export const ICON_EMOJI = {
  'cash': '💵', 'wallet': '👛', 'trending-up': '📈', 'briefcase': '💼',
  'ribbon': '🎗️', 'time': '⏰', 'ticket': '🎫', 'water': '💧', 'flash': '⚡',
  'bonfire': '🔥', 'wifi': '📶', 'home': '🏠', 'business': '🏢', 'key': '🔑',
  'construct': '🔧', 'car': '🚗', 'speedometer': '⛽', 'pricetag': '🏷️',
  'bus': '🚌', 'airplane': '✈️', 'bicycle': '🚲', 'train': '🚆',
  'restaurant': '🍽️', 'cafe': '☕', 'basket': '🧺', 'cart': '🛒',
  'storefront': '🏪', 'fast-food': '🍔', 'wine': '🍷', 'gift': '🎁',
  'flower': '🌸', 'heart': '❤️', 'people': '👨‍👩‍👧', 'paw': '🐾',
  'school': '🏫', 'book': '📖', 'game-controller': '🎮', 'medkit': '🏥',
  'fitness': '🏃', 'barbell': '🏋️', 'shield-checkmark': '🛡️', 'shield': '🛡️',
  'umbrella': '☂️', 'document-text': '📄', 'receipt': '🧾', 'card': '💳',
  'map': '🗺️', 'calculator': '🧮', 'shirt': '👕', 'cut': '✂️',
  'sparkles': '✨', 'phone-portrait': '📱', 'laptop': '💻', 'tv': '📺',
  'musical-notes': '🎵', 'ellipsis-horizontal-circle': '⚪',
};

export function iconEmoji(name) {
  return ICON_EMOJI[name] || ICON_EMOJI['ellipsis-horizontal-circle'];
}

export const OTHER_CATEGORY_ID = 'other';
export const OTHER_INCOME_ID = 'income-other';
export function otherIdFor(kind) {
  return kind === 'income' ? OTHER_INCOME_ID : OTHER_CATEGORY_ID;
}

const exp = (id, label, icon, flavorIdx) => ({
  id, kind: 'expense', label, icon, ...flavorAt(flavorIdx),
});
const inc = (id, label, icon, flavorIdx) => ({
  id, kind: 'income', label, icon, ...flavorAt(flavorIdx),
});

export const DEFAULT_EXPENSE_CATEGORIES = [
  exp('water', '水', 'water', 4),
  exp('mgmt-fee', '管理費', 'business', 0),
  exp('gas', '汽油', 'speedometer', 11),
  exp('food', '食', 'restaurant', 2),
  exp('red-envelope', '紅包', 'gift', 8),
  exp('electricity', '電', 'flash', 3),
  exp('lpg', '瓦斯', 'bonfire', 6),
  exp('parking', '停車費', 'car', 10),
  exp('white-envelope', '白包', 'flower', 13),
  exp('hypermarket', '大賣場', 'cart', 1),
  exp('etag', 'E-tag', 'pricetag', 5),
  exp('car-maintenance', '車子保養費', 'construct', 7),
  exp('market', '菜市場', 'basket', 9),
  exp('license-tax', '牌照稅', 'document-text', 12),
  exp('fuel-tax', '燃料稅', 'receipt', 4),
  exp('land-tax', '地價稅', 'map', 11),
  exp('house-tax', '房屋稅', 'home', 0),
  exp('medical', '醫療費', 'medkit', 5),
  exp('travel', '旅遊', 'airplane', 2),
  exp('car-insurance', '車險', 'shield-checkmark', 6),
  exp('accident-insurance', '意外險', 'shield', 10),
  exp('gym', 'world gym', 'barbell', 9),
  exp('income-tax', '所得稅', 'cash', 13),
  exp('donation', '捐款', 'heart', 8),
  exp('internet', '網路', 'wifi', 3),
];

export const DEFAULT_INCOME_SOURCES = [
  inc('salary-0', '薪資-0', 'cash', 0),
  inc('salary-z', '薪資-展', 'cash', 4),
  inc('pension', '退休金', 'wallet', 10),
  inc('bonus', '獎金', 'sparkles', 1),
  inc('year-end-0', '年終-0', 'gift', 3),
  inc('year-end-z', '年終-展', 'gift', 9),
  inc('welfare-0', '福利金-0', 'heart', 2),
  inc('welfare-z', '福利金-展', 'heart', 12),
  inc('comfort-bonus', '慰休獎金', 'ribbon', 11),
  inc('leave-cashout', '補休換薪', 'time', 7),
  inc('side-job', '兼職', 'briefcase', 5),
  inc('side-job-z', '兼職-展', 'briefcase', 6),
  inc('investment', '投資', 'trending-up', 8),
  inc('invoice-lottery', '發票中獎', 'ticket', 13),
  inc('birthday-voucher', '生日禮卷', 'card', 8),
  inc(OTHER_INCOME_ID, '其他', 'ellipsis-horizontal-circle', 7),
];

export const OTHER_EXPENSE = exp(OTHER_CATEGORY_ID, '其他', 'ellipsis-horizontal-circle', 7);

export const DEFAULT_CATEGORIES = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  OTHER_EXPENSE,
  ...DEFAULT_INCOME_SOURCES,
];

export const CURRENCIES = [
  { code: 'TWD', symbol: '$', label: '新台幣' },
  { code: 'USD', symbol: 'US$', label: '美元' },
  { code: 'JPY', symbol: '¥', label: '日圓' },
  { code: 'EUR', symbol: '€', label: '歐元' },
  { code: 'GBP', symbol: '£', label: '英鎊' },
  { code: 'CNY', symbol: 'CN¥', label: '人民幣' },
  { code: 'HKD', symbol: 'HK$', label: '港幣' },
  { code: 'KRW', symbol: '₩', label: '韓元' },
  { code: 'AUD', symbol: 'A$', label: '澳幣' },
  { code: 'CAD', symbol: 'CA$', label: '加幣' },
  { code: 'SGD', symbol: 'S$', label: '新加坡幣' },
  { code: 'THB', symbol: '฿', label: '泰銖' },
];

// Currencies conventionally shown without decimal places.
const ZERO_DECIMAL = new Set(['TWD', 'JPY', 'KRW']);

export function currencySymbol(code) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}
export function decimalsFor(code) {
  return ZERO_DECIMAL.has(code) ? 0 : 2;
}
