/**
 * The visible table as a CSV download (PAC-152, part 2).
 *
 * Built in the browser from rows the page already holds — the table *is* the
 * export, so there is no second request and nothing for the server to log.
 * Bulk data belongs to the Data Export page; this is "save what I'm looking
 * at". UTF-8 with a BOM so Excel opens it with its accents intact.
 */
export function downloadCsv(
  filename: string,
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): void {
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
