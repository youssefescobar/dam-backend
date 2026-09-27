/**
 * Minimal CSV parser (RFC4180-ish quoted fields).
 * Supports KB columns: title/question, content/answer, plus optional metadata.
 * @param {string} text
 * @returns {Array<{
 *   title: string,
 *   content: string,
 *   sourceId?: string,
 *   intent?: string,
 *   category?: string,
 *   locale?: string,
 *   escalate?: boolean,
 *   requiresLiveData?: boolean,
 * }>}
 */
export function parseKbCsv(text) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => header.findIndex((h) => names.includes(h));

  const titleIdx = col(['title', 'question']);
  const contentIdx = col(['content', 'answer', 'body']);
  const idIdx = col(['id', 'sourceid', 'source_id']);
  const intentIdx = col(['intent']);
  const categoryIdx = col(['category']);
  const localeIdx = col(['locale', 'language', 'lang']);
  const escalateIdx = col(['escalate', 'escalation']);
  const liveIdx = col(['requires_live_data', 'requireslivedata', 'live_data']);

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

    const entry = { title, content };
    if (idIdx >= 0) entry.sourceId = String(row[idIdx] ?? '').trim() || undefined;
    if (intentIdx >= 0) entry.intent = String(row[intentIdx] ?? '').trim() || undefined;
    if (categoryIdx >= 0) entry.category = String(row[categoryIdx] ?? '').trim() || undefined;
    if (localeIdx >= 0) {
      const loc = String(row[localeIdx] ?? '').trim().toLowerCase();
      if (loc === 'ar' || loc === 'en') entry.locale = loc;
    }
    if (escalateIdx >= 0) entry.escalate = parseBool(row[escalateIdx]);
    if (liveIdx >= 0) entry.requiresLiveData = parseBool(row[liveIdx]);

    entries.push(entry);
  }
  return entries;
}

function parseBool(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
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
      // skip
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
