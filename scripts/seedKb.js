import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadEnv } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { parseKbCsv } from '../src/utils/csv.js';
import { importKnowledgeEntries } from '../src/services/kbImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importFile(csvPath, options) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }
  const text = fs.readFileSync(csvPath, 'utf8');
  const entries = parseKbCsv(text);
  console.log(`Parsed ${entries.length} entries from ${csvPath}`);
  const summary = await importKnowledgeEntries(entries, options);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  loadEnv(process.env);
  await connectDb(process.env.MONGO_URI);

  const replaceAll = process.env.KB_REPLACE_ALL === '1';
  const mode = process.env.KB_IMPORT_MODE === 'append' ? 'append' : 'upsert';

  if (process.env.KB_CSV_PATH) {
    await importFile(process.env.KB_CSV_PATH, { mode, replaceAll });
  } else {
    const enPath = path.join(__dirname, '../data/kb-info-full.csv');
    const arPath = path.join(__dirname, '../data/kb-info-full.ar.csv');
    // Replace once on first file, then upsert Arabic
    await importFile(enPath, { mode, replaceAll });
    await importFile(arPath, { mode: 'upsert', replaceAll: false });
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
