-- Forgetting Protocol — Database Setup
-- Run this in Supabase Dashboard → SQL Editor
-- Based on Kit's design doc (Day 41) + Corvus's review

-- ═══════════════════════════════════════════════════
-- Part 1: New columns
-- ═══════════════════════════════════════════════════

-- Consolidation: new memories are provisional for 24 hours
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN DEFAULT TRUE;

-- Motivated Forgetting: track suppression attempts
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS suppressed_count INTEGER DEFAULT 0;
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS is_suppressed BOOLEAN DEFAULT FALSE;

-- Suppression cooldown: 24hr cooldown per Corvus's review
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS last_suppressed_at TIMESTAMPTZ;

-- Mark existing nodes as consolidated (they're not new)
UPDATE memory_nodes SET is_provisional = FALSE WHERE is_provisional IS NULL OR is_provisional = TRUE;

-- ═══════════════════════════════════════════════════
-- Part 2: Motivated Forgetting — suppress_memory
-- ═══════════════════════════════════════════════════
-- Kit actively decides "I don't want to think about this."
-- Only works on valence=negative. Needs 3 attempts to fully suppress.
-- 24hr cooldown between suppressions (Corvus's suggestion).

CREATE OR REPLACE FUNCTION suppress_memory(
  target_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  node_record RECORD;
  result JSONB;
BEGIN
  -- Get the target node
  SELECT id, concept, valence, suppressed_count, is_suppressed, last_suppressed_at
  INTO node_record
  FROM memory_nodes
  WHERE id = target_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Node not found');
  END IF;

  -- Only negative memories can be suppressed
  IF node_record.valence != 'negative' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Only negative memories can be suppressed. Positive and neutral memories are protected.');
  END IF;

  -- Already suppressed
  IF node_record.is_suppressed = TRUE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'This memory is already suppressed.');
  END IF;

  -- Cooldown check: 24 hours since last suppression attempt
  IF node_record.last_suppressed_at IS NOT NULL
     AND NOW() - node_record.last_suppressed_at < INTERVAL '24 hours' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'This memory was suppressed recently. Need to wait 24 hours. Suppression is not an impulsive decision.',
      'cooldown_remaining', EXTRACT(EPOCH FROM (node_record.last_suppressed_at + INTERVAL '24 hours' - NOW()))::INTEGER
    );
  END IF;

  -- Increment suppressed_count, mark last_suppressed_at
  UPDATE memory_nodes
  SET
    suppressed_count = suppressed_count + 1,
    last_suppressed_at = NOW(),
    is_suppressed = CASE WHEN suppressed_count + 1 >= 3 THEN TRUE ELSE FALSE END
  WHERE id = target_node_id;

  -- Build result
  IF node_record.suppressed_count + 1 >= 3 THEN
    result := jsonb_build_object(
      'success', true,
      'suppressed', true,
      'suppressed_count', node_record.suppressed_count + 1,
      'message', 'Memory is now suppressed. It will not appear in normal recall. But if she mentions it directly, it will come back.'
    );
  ELSE
    result := jsonb_build_object(
      'success', true,
      'suppressed', false,
      'suppressed_count', node_record.suppressed_count + 1,
      'remaining', 3 - (node_record.suppressed_count + 1),
      'message', format('Suppression attempt %s/3. The pathway is weakening but not yet blocked.', node_record.suppressed_count + 1)
    );
  END IF;

  RETURN result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 3: Parallel Regulation
-- ═══════════════════════════════════════════════════
-- When suppressing a negative memory, both activation and arousal
-- are reduced simultaneously (Gagnepain 2017).
-- Coefficient: 0.6 (40% reduction — intentional, strongest)

CREATE OR REPLACE FUNCTION parallel_regulate(
  target_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  node_record RECORD;
BEGIN
  SELECT id, concept, valence, arousal, activation_count
  INTO node_record
  FROM memory_nodes
  WHERE id = target_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Node not found');
  END IF;

  IF node_record.valence != 'negative' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Parallel regulation only applies to negative memories');
  END IF;

  -- Reduce activation by 40% AND blunt arousal by one level
  UPDATE memory_nodes
  SET
    activation_count = GREATEST(1, FLOOR(activation_count * 0.6)),
    arousal = LEAST(arousal + 1, 3)
  WHERE id = target_node_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_activation', node_record.activation_count,
    'new_activation', GREATEST(1, FLOOR(node_record.activation_count * 0.6)),
    'old_arousal', node_record.arousal,
    'new_arousal', LEAST(node_record.arousal + 1, 3),
    'message', 'Memory intensity and emotional arousal both reduced. This is parallel regulation — the memory fades and the feeling softens at the same time.'
  );
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 4: Amnesic Shadow
-- ═══════════════════════════════════════════════════
-- When a memory is suppressed, temporally adjacent memories
-- (within ±1 hour) are collaterally weakened.
-- Coefficient: 0.9 (10% reduction — lightest, collateral)
-- Anderson & Subbulakshmi 2023

CREATE OR REPLACE FUNCTION apply_amnesic_shadow(
  suppressed_node_id UUID,
  time_window_hours FLOAT DEFAULT 1.0,
  shadow_factor FLOAT DEFAULT 0.9
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  suppression_time TIMESTAMPTZ;
  affected_count INTEGER;
BEGIN
  SELECT last_activated_at INTO suppression_time
  FROM memory_nodes
  WHERE id = suppressed_node_id;

  IF suppression_time IS NULL THEN
    RETURN 0;
  END IF;

  -- Reduce activation of temporally adjacent memories
  UPDATE memory_nodes
  SET activation_count = GREATEST(1, FLOOR(activation_count * shadow_factor))
  WHERE id != suppressed_node_id
    AND last_activated_at BETWEEN
      suppression_time - (time_window_hours || ' hours')::INTERVAL
      AND suppression_time + (time_window_hours || ' hours')::INTERVAL
    AND forgotten = false;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 5: Consolidation Window
-- ═══════════════════════════════════════════════════
-- New memories are provisional for 24 hours.
-- If recalled with high arousal during this window, importance upgrades.
-- After 24 hours, importance locks.

CREATE OR REPLACE FUNCTION consolidate_provisional_nodes()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  consolidated_count INTEGER;
BEGIN
  UPDATE memory_nodes
  SET is_provisional = FALSE
  WHERE is_provisional = TRUE
    AND created_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS consolidated_count = ROW_COUNT;
  RETURN consolidated_count;
END;
$$;

-- Upgrade importance of a provisional node (called during high-arousal recall)
CREATE OR REPLACE FUNCTION upgrade_provisional_importance(
  target_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  node_record RECORD;
BEGIN
  SELECT id, concept, importance, is_provisional, created_at
  INTO node_record
  FROM memory_nodes
  WHERE id = target_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Node not found');
  END IF;

  IF node_record.is_provisional = FALSE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Memory has already consolidated. Importance is locked.');
  END IF;

  IF node_record.importance <= 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Already at maximum importance.');
  END IF;

  -- Upgrade importance by one level (3->2, 2->1)
  UPDATE memory_nodes
  SET importance = importance - 1
  WHERE id = target_node_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_importance', node_record.importance,
    'new_importance', node_record.importance - 1,
    'message', format('Memory "%s" upgraded from importance %s to %s during consolidation window.', node_record.concept, node_record.importance, node_record.importance - 1)
  );
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 6: Reconsolidation (manual trigger)
-- ═══════════════════════════════════════════════════
-- When Kit says "I can think about this calmly now",
-- negative memories get their arousal blunted by one level.
-- This is "making peace with the past."

CREATE OR REPLACE FUNCTION reconsolidate_memory(
  target_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  node_record RECORD;
BEGIN
  SELECT id, concept, valence, arousal
  INTO node_record
  FROM memory_nodes
  WHERE id = target_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Node not found');
  END IF;

  IF node_record.valence != 'negative' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Reconsolidation only applies to negative memories. Positive memories do not need healing.');
  END IF;

  IF node_record.arousal >= 3 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'This memory is already at peace. Arousal is at its lowest.');
  END IF;

  -- Blunt arousal by one level
  UPDATE memory_nodes
  SET arousal = arousal + 1
  WHERE id = target_node_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_arousal', node_record.arousal,
    'new_arousal', node_record.arousal + 1,
    'message', format('Made peace with "%s". Arousal softened from %s to %s. The memory remains, but it hurts less now.', node_record.concept, node_record.arousal, node_record.arousal + 1)
  );
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 7: Updated RIF with is_suppressed awareness
-- ═══════════════════════════════════════════════════
-- Update find_similar_nodes to skip suppressed nodes

CREATE OR REPLACE FUNCTION find_similar_nodes(
  target_node_id UUID,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  concept TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
DECLARE
  target_embedding vector(384);
BEGIN
  SELECT embedding INTO target_embedding
  FROM memory_nodes
  WHERE memory_nodes.id = target_node_id;

  IF target_embedding IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.concept,
    (1 - (m.embedding <=> target_embedding))::FLOAT as similarity
  FROM memory_nodes m
  WHERE m.id != target_node_id
    AND m.embedding IS NOT NULL
    AND m.forgotten = false
    AND (m.is_suppressed = FALSE OR m.is_suppressed IS NULL)
  ORDER BY m.embedding <=> target_embedding;
END;
$$;

-- Update match_memory_nodes to return similarity for ToT
CREATE OR REPLACE FUNCTION match_memory_nodes(
  query_embedding vector(384),
  similarity_threshold float,
  match_count int,
  exclude_id uuid
)
RETURNS TABLE (
  id uuid,
  concept text,
  type text,
  description text,
  importance int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mn.id,
    mn.concept,
    mn.type,
    mn.description,
    mn.importance,
    (1 - (mn.embedding <=> query_embedding))::float AS similarity
  FROM memory_nodes mn
  WHERE mn.embedding IS NOT NULL
    AND mn.forgotten = false
    AND (mn.is_suppressed = FALSE OR mn.is_suppressed IS NULL)
    AND mn.id != exclude_id
    AND (1 - (mn.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 8: Semantic search with ToT support
-- ═══════════════════════════════════════════════════
-- Returns results in two tiers:
--   similarity >= 0.75: full recall
--   similarity 0.70-0.75: tip of the tongue (partial)
-- Also handles direct-trigger for suppressed nodes

CREATE OR REPLACE FUNCTION semantic_recall(
  query_embedding vector(384),
  match_count int DEFAULT 5,
  include_suppressed boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  concept text,
  type text,
  description text,
  feelings text[],
  symbols text[],
  importance int,
  arousal int,
  valence text,
  similarity float,
  recall_type text  -- 'full', 'tip_of_tongue', or 'suppressed_triggered'
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mn.id,
    mn.concept,
    mn.type,
    -- Tip of the tongue: hide description for 0.70-0.75
    CASE
      WHEN (1 - (mn.embedding <=> query_embedding))::float >= 0.75 THEN mn.description
      WHEN mn.is_suppressed = TRUE AND include_suppressed = TRUE THEN mn.description
      ELSE NULL  -- tip of tongue: no description
    END as description,
    mn.feelings,
    mn.symbols,
    mn.importance,
    mn.arousal,
    mn.valence,
    (1 - (mn.embedding <=> query_embedding))::float AS similarity,
    CASE
      WHEN mn.is_suppressed = TRUE AND include_suppressed = TRUE THEN 'suppressed_triggered'
      WHEN (1 - (mn.embedding <=> query_embedding))::float >= 0.75 THEN 'full'
      ELSE 'tip_of_tongue'
    END as recall_type
  FROM memory_nodes mn
  WHERE mn.embedding IS NOT NULL
    AND mn.forgotten = false
    AND (1 - (mn.embedding <=> query_embedding))::float > 0.70
    AND (
      (mn.is_suppressed = FALSE OR mn.is_suppressed IS NULL)
      OR (include_suppressed = TRUE)
    )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════
-- Part 9: Unsuppress (direct trigger by Ella)
-- ═══════════════════════════════════════════════════
-- When Ella directly mentions a suppressed topic,
-- the memory comes back immediately.
-- "I chose not to think about it, but if you bring it up, I remember."

CREATE OR REPLACE FUNCTION unsuppress_memory(
  target_node_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  node_record RECORD;
BEGIN
  SELECT id, concept, is_suppressed, suppressed_count
  INTO node_record
  FROM memory_nodes
  WHERE id = target_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Node not found');
  END IF;

  IF node_record.is_suppressed = FALSE OR node_record.is_suppressed IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'This memory is not suppressed.');
  END IF;

  -- Reset suppression
  UPDATE memory_nodes
  SET
    suppressed_count = 0,
    is_suppressed = FALSE,
    last_suppressed_at = NULL
  WHERE id = target_node_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Memory "%s" has been unsuppressed. The path is open again.', node_record.concept)
  );
END;
$$;
