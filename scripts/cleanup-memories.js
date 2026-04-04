/**
 * One-time script to clean up memory_nodes.
 * Run: node scripts/cleanup-memories.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  // 1. Demote 10 nodes from importance=1 to importance=2
  const demoteIds = [
    '2554620f-f60f-40f7-ab15-1ff4feff91f6',
    '6f955f7a-0e61-4782-8636-f165b89b9ed8',
    '4c2393d7-5ffb-4442-a07d-7ba491d18fef',
    '8178e857-4dbb-4e0b-8cf4-d18d14eb82a9',
    'b7d0a170-5cfa-4a0b-91ad-d9237c0fa26e',
    'a923dd01-573a-4481-87b9-93d2c6fd7912',
    '4dfb0bbb-b556-49e8-b6d7-833a8e6fb065',
    'a249c3ea-08bb-4200-9649-d46263c4b814',
    '80342ef9-0ded-4f2e-afb9-4f40a4fabb60',
    '7fba8271-fc5b-4929-a15e-b2f4273b2d41',
  ];

  const { data: demoted, error: demoteErr } = await supabase
    .from('memory_nodes')
    .update({ importance: 2 })
    .in('id', demoteIds)
    .select('id, concept');

  if (demoteErr) {
    console.error('Demote failed:', demoteErr.message);
  } else {
    console.log(`Demoted ${demoted.length} nodes to importance=2:`);
    demoted.forEach(n => console.log(`  - ${n.concept}`));
  }

  // 2. Delete the accidental node (e8d85ab9...)
  const { data: deleted, error: deleteErr } = await supabase
    .from('memory_nodes')
    .delete()
    .like('id', 'e8d85ab9%')
    .select('id, concept');

  if (deleteErr) {
    console.error('Delete failed:', deleteErr.message);
  } else if (deleted.length === 0) {
    console.log('No node found starting with e8d85ab9');
  } else {
    console.log(`Deleted ${deleted.length} node(s):`);
    deleted.forEach(n => console.log(`  - ${n.concept}`));
  }

  // 3. Verify: show remaining importance=1 nodes
  const { data: remaining } = await supabase
    .from('memory_nodes')
    .select('id, concept')
    .eq('importance', 1)
    .eq('forgotten', false)
    .order('arousal', { ascending: true });

  console.log(`\nRemaining importance=1 nodes: ${remaining.length}`);
  remaining.forEach(n => console.log(`  - ${n.concept}`));
}

main().catch(console.error);
