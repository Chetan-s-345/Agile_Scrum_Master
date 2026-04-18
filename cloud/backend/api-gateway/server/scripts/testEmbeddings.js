require('dotenv').config();

const {
  embedText,
  upsertEmbedding,
  searchSimilar,
  ensureEmbeddingsInfrastructure,
} = require('../lib/embeddings');

async function main() {
  const sampleText = 'Sprint planning includes backlog refinement, task assignment, and risk tracking.';
  const sourceType = 'page';
  const sourceId = 'rag-smoke-1';
  const projectId = 'rag-test-project';

  await ensureEmbeddingsInfrastructure();

  const vector = await embedText(sampleText);
  if (!vector) {
    console.log('Embedding unavailable (likely missing OPENAI_API_KEY).');
    return;
  }

  const upserted = await upsertEmbedding({
    sourceType,
    sourceId,
    projectId,
    content: sampleText,
    metadata: { smoke: true },
  });

  if (!upserted) {
    console.log('Upsert failed.');
    return;
  }

  const results = await searchSimilar({
    query: 'How do we plan a sprint backlog and assign work?',
    projectId,
    sourceTypes: [sourceType],
    limit: 5,
  });

  const top = results[0];
  if (!top) {
    console.log('No results found.');
    return;
  }

  console.log('Top similarity score:', top.similarity);
  console.log('Top source:', `${top.sourceType}:${top.sourceId}`);
}

main().catch((error) => {
  console.error('testEmbeddings failed:', error?.message || String(error));
  process.exitCode = 1;
});
