import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadEnv } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { parseKbCsv } from '../src/utils/csv.js';
import { importKnowledgeEntries } from '../src/services/kbImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  loadEnv(process.env);
  await connectDb(process.env.MONGO_URI);

  const csvPath =
    process.env.KB_CSV_PATH ||
    path.join(__dirname, '../data/kb-questions.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const entries = parseKbCsv(text);
  console.log(`Parsed ${entries.length} entries from ${csvPath}`);

  const mode = process.env.KB_IMPORT_MODE === 'append' ? 'append' : 'upsert';
  const replaceAll = process.env.KB_REPLACE_ALL === '1';

  const summary = await importKnowledgeEntries(entries, { mode, replaceAll });
  console.log(JSON.stringify(summary, null, 2));

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
