/**
 * Embedding utility using local transformer model.
 * No API key needed — runs on Ella's laptop.
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~30MB, first run downloads automatically)
 */

let pipeline = null;
let embedder = null;

/**
 * Lazy-load the embedding model (only downloaded once, then cached).
 */
async function getEmbedder() {
  if (embedder) return embedder;

  // Dynamic import for ESM module
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  embedder = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return embedder;
}

/**
 * Generate embedding for a text string.
 * @param {string} text - Text to embed
 * @returns {number[]} - 384-dimensional vector
 */
async function generateEmbedding(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Generate embedding for a memory node (concept + description).
 * @param {{ concept: string, description?: string }} node
 * @returns {number[]} - 384-dimensional vector
 */
async function embedMemoryNode(node) {
  const text = [node.concept, node.description].filter(Boolean).join(' — ');
  return generateEmbedding(text);
}

module.exports = { generateEmbedding, embedMemoryNode, getEmbedder };
