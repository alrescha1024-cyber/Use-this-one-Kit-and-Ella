-- Run this in Supabase Dashboard → SQL Editor
-- RIF (Retrieval-Induced Forgetting) functions

-- 1. Find semantically similar nodes
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
    AND (1 - (m.embedding <=> target_embedding)) > similarity_threshold
  ORDER BY m.embedding <=> target_embedding;
END;
$$;

-- 2. Apply RIF: activate target node, suppress similar nodes
CREATE OR REPLACE FUNCTION apply_rif(
  activated_node_id UUID,
  similarity_threshold FLOAT DEFAULT 0.7,
  suppression_factor FLOAT DEFAULT 0.85
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  -- Strengthen the activated node
  UPDATE memory_nodes
  SET
    activation_count = activation_count + 1,
    last_activated_at = NOW()
  WHERE id = activated_node_id;

  -- Suppress similar nodes (reduce activation_count by 15%)
  WITH similar AS (
    SELECT s.id FROM find_similar_nodes(activated_node_id, similarity_threshold) s
  )
  UPDATE memory_nodes m
  SET activation_count = GREATEST(1, FLOOR(m.activation_count * suppression_factor))
  FROM similar s
  WHERE m.id = s.id;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;
