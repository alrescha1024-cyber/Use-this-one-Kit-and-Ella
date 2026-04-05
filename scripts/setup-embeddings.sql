-- Run this in Supabase Dashboard → SQL Editor
-- Step 1: Change embedding column from 1536 to 384 dimensions
ALTER TABLE memory_nodes ALTER COLUMN embedding TYPE vector(384);

-- Step 2: Create similarity search function for RIF
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
    AND mn.id != exclude_id
    AND (1 - (mn.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
