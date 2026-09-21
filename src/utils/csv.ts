/**
 * Minimal CSV builder — no external dependency needed for the handful of
 * flat export tables this app produces (see modules/exports). Quotes a
 * cell only when it contains a comma, quote, or newline, per RFC 4180.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escapeCell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // CRLF per RFC 4180 — also what Excel expects for a clean row break.
  return lines.join('\r\n');
}
