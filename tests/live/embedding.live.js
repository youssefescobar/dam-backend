/**
 * Live embedding tests — run outside Jest because onnxruntime typed arrays
 * break under Jest's experimental VM modules (Float32Array realm mismatch).
 *
 * Invoked via: npm run test:embeddings
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { embed, defaultEmbedKnowledgeEntry, initEmbeddingModel } from '../../src/services/embedding.js';
import { connectDb, disconnectDb } from '../../src/config/db.js';
import { KnowledgeBaseEntry } from '../../src/models/KnowledgeBaseEntry.js';

async function main() {
  console.log('Loading embedding model…');
  await initEmbeddingModel();

  const vec = await embed('hello world');
  assert.equal(vec.length, 384, 'embed("hello world") returns 384 floats');
  assert.equal(typeof vec[0], 'number');
  console.log('✓ embed length 384');

  const a = await embed('deterministic check');
  const b = await embed('deterministic check');
  assert.deepEqual(a, b, 'same input → same embedding');
  console.log('✓ deterministic embeddings');

  const content = Array.from({ length: 1100 }, (_, i) => `word${i}`).join(' ');
  const chunks = await defaultEmbedKnowledgeEntry({ title: 'Long policy', content });
  assert.ok(chunks.length > 1, 'long content yields multiple chunks');
  for (const chunk of chunks) {
    assert.equal(chunk.embedding.length, 384);
    assert.ok(chunk.text.length > 0);
  }
  console.log(`✓ multi-chunk embed (${chunks.length} chunks)`);

  const mem = await MongoMemoryServer.create();
  await connectDb(mem.getUri());

  const entry = await KnowledgeBaseEntry.create({
    title: 'Fare',
    content: 'Airport transfers start at $50.',
    chunks: await defaultEmbedKnowledgeEntry({
      title: 'Fare',
      content: 'Airport transfers start at $50.',
    }),
  });
  assert.ok(entry.chunks[0].embedding.length === 384);
  const id = entry._id;
  await KnowledgeBaseEntry.findByIdAndDelete(id);
  const gone = await KnowledgeBaseEntry.findById(id);
  assert.equal(gone, null, 'delete removes entry and chunks');
  console.log('✓ delete removes chunk embeddings');

  await disconnectDb();
  await mem.stop();
  console.log('All embedding live tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});