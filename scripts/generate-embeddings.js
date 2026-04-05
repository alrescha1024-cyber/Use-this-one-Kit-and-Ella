/**
 * Batch generate embeddings for all memory_nodes.
 * Run: node scripts/generate-embeddings.js
 *
 * First run downloads the model (~30MB), subsequent runs use cached model.
 * Processes all nodes that don't have an embedding yet.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { embedMemoryNode, getEmbedder } = require('../src/embeddings');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log('Loading embedding model (first run downloads ~30MB)...');
  await getEmbedder();
  console.log('Model loaded.\n');

  // Fetch all nodes without embeddings
  const { data: nodes, error } = await supabase
    .from('memory_nodes')
    .select('id, concept, description')
    .is('embedding', null);

  if (error) {
    console.error('Failed to fetch nodes:', error.message);
    return;
  }

  console.log(`Found ${nodes.length} nodes without embeddings.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    try {
      const embedding = await embedMemoryNode(node);

      const { error: updateErr } = await supabase
        .from('memory_nodes')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', node.id);

      if (updateErr) {
        console.error(`  [${i + 1}/${nodes.length}] FAIL: ${node.concept} — ${updateErr.message}`);
        failed++;
      } else {
        console.log(`  [${i + 1}/${nodes.length}] OK: ${node.concept}`);
        success++;
      }
    } catch (err) {
      console.error(`  [${i + 1}/${nodes.length}] ERROR: ${node.concept} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} embedded, ${failed} failed.`);
}

main().catch(console.error);
