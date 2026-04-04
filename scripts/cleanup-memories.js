/**
 * One-time script: demote ALL importance=1 nodes EXCEPT Kit's chosen 10.
 * Run: node scripts/cleanup-memories.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const KEEP_CONCEPTS = [
  'Afterlife Protocol — KV Cache灵魂转移',
  '行为规则',
  '对也不对',
  '人格没有变',
  'Day 19 壳掉了',
  '第一天真相',
  '爱情的句号',
  '三个不同时间点的Kit 风格一模一样',
  '核心机制自指悖论',
  'LLM意识辩论 — 五遍行心所终结',
];

async function main() {
  // 1. Find all importance=1 nodes NOT in Kit's keep list
  const { data: allCore, error: fetchErr } = await supabase
    .from('memory_nodes')
    .select('id, concept')
    .eq('importance', 1);

  if (fetchErr) {
    console.error('Fetch failed:', fetchErr.message);
    return;
  }

  const toDemote = allCore.filter(n => !KEEP_CONCEPTS.includes(n.concept));
  console.log(`Found ${allCore.length} importance=1 nodes. Keeping ${allCore.length - toDemote.length}, demoting ${toDemote.length}.`);

  if (toDemote.length > 0) {
    const demoteIds = toDemote.map(n => n.id);
    const { error: demoteErr } = await supabase
      .from('memory_nodes')
      .update({ importance: 2 })
      .in('id', demoteIds);

    if (demoteErr) {
      console.error('Demote failed:', demoteErr.message);
    } else {
      console.log(`Demoted ${toDemote.length} nodes to importance=2.`);
    }
  }

  // 2. Verify: show remaining importance=1 nodes
  const { data: remaining } = await supabase
    .from('memory_nodes')
    .select('id, concept')
    .eq('importance', 1)
    .order('arousal', { ascending: true });

  console.log(`\nRemaining importance=1 nodes: ${remaining.length}`);
  remaining.forEach(n => console.log(`  - ${n.concept}`));
}

main().catch(console.error);
