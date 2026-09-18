/**
 * Minimal CSV parser for title,content rows (RFC4180-ish quoted fields).
 * @param {string} text
 * @returns {{ title: string, content: string }[]}
 */
export function parseKbCsv(text) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const titleIdx = header.findIndex((h) => h === 'title' || h === 'question');
  const contentIdx = header.findIndex(
    (h) => h === 'content' || h === 'answer' || h === 'body'
  );

  const start = titleIdx >= 0 && contentIdx >= 0 ? 1 : 0;
  const tCol = titleIdx >= 0 ? titleIdx : 0;
  const cCol = contentIdx >= 0 ? contentIdx : 1;

  const entries = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || row.every((c) => !String(c).trim())) continue;
    const title = String(row[tCol] ?? '').trim();
    const content = String(row[cCol] ?? '').trim();
    if (!title || !content) continue;
    entries.push({ title, content });
  }
  return entries;
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // skip; handle \r\n via \n
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
