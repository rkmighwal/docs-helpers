import { Allocation, Project, allocRange } from './model';
import { Calendar, addRange, dailyLoad } from './calc';

/** Working days in one person-month when the user has not set a number: working days per week × 52 weeks ÷ 12 months. */
export const pmDaysAuto = (workDays: number[]): number => Math.round(((workDays.length * 52) / 12) * 100) / 100;

export const pmDaysOf = (p: Pick<Project, 'cost' | 'workDays'>): number => (p.cost.pmDays > 0 ? p.cost.pmDays : pmDaysAuto(p.workDays));

export type RateSource = 'resource' | 'skill' | 'none';

/** The cost of one person-day for an allocation: the named resource's own rate, else the skill's standard rate. */
export function rateOf(a: Allocation, p: Pick<Project, 'resources' | 'skills'>): { rate: number; source: RateSource; skillId: string } {
  const r = a.resourceId ? p.resources.find(x => x.id === a.resourceId) : undefined;
  if (r?.dayRate && r.dayRate > 0) return { rate: r.dayRate, source: 'resource', skillId: a.skillId };
  const skillId = a.skillId || r?.skillIds[0] || '';
  const s = p.skills.find(x => x.id === skillId);
  return s?.dayRate && s.dayRate > 0 ? { rate: s.dayRate, source: 'skill', skillId } : { rate: 0, source: 'none', skillId };
}

/** True when at least one rate is defined, i.e. cost calculations have something to price. */
export const hasRates = (p: Pick<Project, 'resources' | 'skills'>): boolean => p.resources.some(r => (r.dayRate ?? 0) > 0) || p.skills.some(s => (s.dayRate ?? 0) > 0);

/** Cost calculations are on and there is something to price: only then do cost rows, the Cost sheet and the export prompt appear. */
export const costActive = (p: Pick<Project, 'cost' | 'resources' | 'skills'>): boolean => p.cost.enabled && hasRates(p);

/** Cost per working day of these allocations (count × rate on every working day they cover). */
export function costDaily(list: Allocation[], p: Project, cal: Calendar): Float64Array {
  const d = new Float64Array(cal.days);
  for (const a of list) {
    const { rate } = rateOf(a, p);
    if (!rate) continue;
    const r = allocRange(a, p);
    addRange(d, cal, r.start, r.end, a.count * rate);
  }
  return d;
}

export interface CostLine {
  alloc: Allocation;
  rate: number;
  source: RateSource;
  /** The skill whose standard rate applies (or would apply). */
  skillId: string;
  personDays: number;
  cost: number;
}

export interface CostSummary {
  lines: CostLine[];
  pmDays: number;
  pmAuto: boolean;
  totalCost: number;
  totalPersonDays: number;
  personMonths: number;
  /** Lines with people on them but no rate. */
  unpriced: number;
}

const r2 = (v: number) => Math.round((v + 1e-9) * 100) / 100;

export function costSummary(p: Project, cal: Calendar): CostSummary {
  const lines: CostLine[] = p.allocations.map(alloc => {
    const { rate, source, skillId } = rateOf(alloc, p);
    const d = dailyLoad([alloc], p, cal);
    let days = 0;
    for (let i = 0; i < cal.days; i++) if (cal.working[i]) days += d[i];
    return { alloc, rate, source, skillId, personDays: r2(days), cost: r2(days * rate) };
  });
  const totalPersonDays = r2(lines.reduce((n, l) => n + l.personDays, 0));
  const pmDays = pmDaysOf(p);
  return {
    lines, pmDays, pmAuto: !(p.cost.pmDays > 0), totalCost: r2(lines.reduce((n, l) => n + l.cost, 0)), totalPersonDays,
    personMonths: pmDays > 0 ? r2(totalPersonDays / pmDays) : 0,
    unpriced: lines.filter(l => l.source === 'none' && l.alloc.count > 0 && l.personDays > 0).length,
  };
}

/* ---------------- currencies ---------------- */

export interface Currency {
  code: string;
  /** What is printed next to the amount. */
  symbol: string;
  name: string;
  /** Printed after the amount (1,000 kr) instead of before it ($1,000). */
  after?: boolean;
  /** Currencies that are not divided into smaller units. */
  noDecimals?: boolean;
}

export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen', noDecimals: true },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese yuan' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss franc' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar' },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham' },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi riyal' },
  { code: 'ILS', symbol: '₪', name: 'Israeli shekel' },
  { code: 'TRY', symbol: '₺', name: 'Turkish lira' },
  { code: 'ZAR', symbol: 'R', name: 'South African rand' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian pound' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian real' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican peso' },
  { code: 'SEK', symbol: ' kr', name: 'Swedish krona', after: true },
  { code: 'NOK', symbol: ' kr', name: 'Norwegian krone', after: true },
  { code: 'DKK', symbol: ' kr', name: 'Danish krone', after: true },
  { code: 'PLN', symbol: ' zł', name: 'Polish złoty', after: true },
  { code: 'CZK', symbol: ' Kč', name: 'Czech koruna', after: true },
  { code: 'HUF', symbol: ' Ft', name: 'Hungarian forint', after: true, noDecimals: true },
  { code: 'KRW', symbol: '₩', name: 'South Korean won', noDecimals: true },
  { code: 'THB', symbol: '฿', name: 'Thai baht' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian rupiah', noDecimals: true },
  { code: 'PHP', symbol: '₱', name: 'Philippine peso' },
  { code: 'VND', symbol: ' ₫', name: 'Vietnamese dong', after: true, noDecimals: true },
];

export const isKnownCurrency = (code: string): boolean => CURRENCIES.some(c => c.code === code);

/**
 * How amounts in a currency are written. A code from the list gets its symbol; anything else is the user's own text:
 * a word or code (XYZ) is put before the amount with a space, a symbol (¤) right against it, and nothing is plain numbers.
 */
export function currencyOf(code: string): Currency {
  const known = CURRENCIES.find(c => c.code === code);
  if (known) return known;
  const text = (code ?? '').trim();
  return { code: text, symbol: /^[\p{L}]{2,}$/u.test(text) ? text + ' ' : text, name: text || 'No currency', noDecimals: false };
}

/** Put the currency next to an already formatted, non-negative amount. */
function withCurrency(amount: string, negative: boolean, cur: string | undefined): string {
  const c = cur === undefined ? null : currencyOf(cur);
  const body = !c ? amount : c.after ? amount + c.symbol : c.symbol + amount;
  return (negative ? '−' : '') + body;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Money for a table cell: the currency symbol, thousands separators, whole currency units, millions abbreviated
 * ($343,000 / €1.25M). Without `cur` just the number.
 */
export function fmtMoney(v: number, cur?: string): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return withCurrency('0', false, cur);
  const a = Math.abs(v);
  return withCurrency(a >= 1e6 ? String(Math.round(a / 1e4) / 100) + 'M' : group(String(Math.round(a))), v < 0, cur);
}

/** Money with its decimals for a summary or a rate, e.g. $12,345.50 (¥ and ₩ have none). Without `cur` just the number. */
export function fmtMoneyFull(v: number, cur?: string): string {
  const info = cur === undefined ? null : currencyOf(cur);
  const [i, d] = Math.abs(Math.round(v * 100) / 100).toFixed(2).split('.');
  // money keeps both decimals when it has any ($12,345.50); a plain quantity trims them (2.5)
  const frac = info?.noDecimals ? '' : cur !== undefined ? (d === '00' ? '' : d) : d.replace(/0+$/, '');
  const amount = info?.noDecimals ? group(String(Math.round(Math.abs(v)))) : group(i) + (frac ? '.' + frac : '');
  return withCurrency(amount, v < 0 && Number(amount.replace(/,/g, '')) !== 0, cur);
}

/** A plain quantity (person-days, person-months, working days): thousands separators, up to two decimals, no currency. */
export const fmtPlain = (v: number): string => fmtMoneyFull(v);

/** The Excel number format that shows a number in this currency, e.g. "$"#,##0.00 or #,##0" kr". */
export function excelMoneyFormat(cur: string, decimals: 0 | 2): string {
  const c = currencyOf(cur);
  const num = decimals === 0 || c.noDecimals ? '#,##0' : '#,##0.00';
  const sym = c.symbol.replace(/"/g, '');
  if (!sym) return num;
  return c.after ? `${num}"${sym}"` : `"${sym}"${num}`;
}
