/**
 * Text for the Commission Statement PDF (PAC-181). Kept apart from the web's
 * `lib/money.ts` on purpose: the PDF is rendered in Node, and its fonts can
 * only print WinAnsi.
 */

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,234.56", "-$1,234.56"; never "-$0.00". */
export function money(amount: number): string {
  return MONEY.format(Math.abs(amount) < 0.005 ? 0 : amount);
}

/** A deduction shown as a negative amount; never "-$0.00". */
export function deduction(amount: number): string {
  return money(amount === 0 ? 0 : -amount);
}

/** "10%", "7.5%", "83.33%". */
export function percent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/** "Nov 6, 2026", on the agency's calendar. */
export function day(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** "Nov 10, 2026, 3:42 PM CST", on the agency's clock — an audit line's time. */
export function dayTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

/**
 * The characters the WinAnsi code page holds beyond Latin-1's printable
 * range (0x80–0x9F) — curly quotes, dashes, the ellipsis, the euro.
 */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

/**
 * A string pdfkit's standard fonts can print. Helvetica's AFM metrics cover
 * WinAnsi only, and anything outside it prints as garbage, so an accented
 * name keeps its letter without the accent (`NFKD` + strip the marks) and
 * whatever is left outside the code page becomes `?`.
 */
export function winAnsi(value: string): string {
  let out = '';
  for (const char of value.normalize('NFC')) {
    if (printable(char)) {
      out += char;
      continue;
    }
    const base = char.normalize('NFKD').replace(/\p{M}+/gu, '');
    out += [...base].every(printable) && base.length > 0 ? base : '?';
  }
  return out;
}

function printable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x0a) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(char);
}
