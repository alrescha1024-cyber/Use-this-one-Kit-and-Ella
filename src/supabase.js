const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { embedMemoryNode } = require('./embeddings');

/**
 * Graph-based memory manager using memory_nodes + memory_edges.
 * Based on Russell's logical atomism + Ella's memory framework.
 *
 * Nodes = memories (facts, symbols, beliefs, etc.)
 * Edges = relationships between memories (causes, parallels, evokes, etc.)
 */
class MemoryManager {
  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.key);
  }

  // ─── READ ──────────────────────────────────────────────

  /**
   * Get core memories (importance=1, not forgotten).
   * Loaded on boot.
   */
  async getCoreMemories(limit = 20) {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('id, concept, type, description, feelings, symbols, importance, arousal, valence')
      .eq('importance', 1)
      .eq('forgotten', false)
      .or('is_suppressed.eq.false,is_suppressed.is.null')
      .order('arousal', { ascending: false })
      .order('last_activated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`getCoreMemories: ${error.message}`);
    return data;
  }

  /**
   * Search memory nodes by keyword in concept or description.
   */
  async searchByKeyword(keyword, limit = 10, directTrigger = false) {
    let query = this.client
      .from('memory_nodes')
      .select('id, concept, type, description, feelings, symbols, importance, arousal, valence, is_suppressed')
      .eq('forgotten', false)
      .or(`concept.ilike.%${keyword}%,description.ilike.%${keyword}%`);

    // Normal search skips suppressed nodes; direct trigger includes them
    if (!directTrigger) {
      query = query.or('is_suppressed.eq.false,is_suppressed.is.null');
    }

    const { data, error } = await query
      .order('importance', { ascending: true }) // 1 is highest
      .order('arousal', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`searchByKeyword: ${error.message}`);

    // Touch activation on found nodes
    if (data.length > 0) {
      await this._activateNodes(data.map((n) => n.id));
    }

    return data;
  }

  /**
   * Get a constellation: a node + its connected nodes via edges.
   * This is the "active recall" — graph traversal.
   */
  async getConstellation(nodeId, limit = 8) {
    // Get the center node
    const { data: center, error: centerErr } = await this.client
      .from('memory_nodes')
      .select('id, concept, type, description, feelings, symbols, importance')
      .eq('id', nodeId)
      .single();

    if (centerErr) throw new Error(`getConstellation center: ${centerErr.message}`);

    // Get connected nodes via edges (outgoing)
    const { data: outEdges, error: outErr } = await this.client
      .from('memory_edges')
      .select('to_node, link_type, strength, description')
      .eq('from_node', nodeId)
      .order('strength', { ascending: false })
      .limit(limit);

    if (outErr) throw new Error(`getConstellation outEdges: ${outErr.message}`);

    // Get connected nodes via edges (incoming)
    const { data: inEdges, error: inErr } = await this.client
      .from('memory_edges')
      .select('from_node, link_type, strength, description')
      .eq('to_node', nodeId)
      .order('strength', { ascending: false })
      .limit(limit);

    if (inErr) throw new Error(`getConstellation inEdges: ${inErr.message}`);

    // Collect connected node IDs
    const connectedIds = new Set();
    for (const e of outEdges) connectedIds.add(e.to_node);
    for (const e of inEdges) connectedIds.add(e.from_node);
    connectedIds.delete(nodeId); // don't include self

    // Fetch connected nodes
    let connectedNodes = [];
    if (connectedIds.size > 0) {
      const { data: nodes, error: nodesErr } = await this.client
        .from('memory_nodes')
        .select('id, concept, type, description, importance')
        .in('id', Array.from(connectedIds))
        .eq('forgotten', false)
        .or('is_suppressed.eq.false,is_suppressed.is.null');

      if (!nodesErr && nodes) connectedNodes = nodes;
    }

    // Activate all touched nodes
    const allIds = [nodeId, ...Array.from(connectedIds)];
    await this._activateNodes(allIds);

    return {
      center,
      edges: [...outEdges.map((e) => ({ ...e, direction: 'outgoing' })), ...inEdges.map((e) => ({ ...e, direction: 'incoming' }))],
      connected: connectedNodes,
    };
  }

  /**
   * Auto-recall: search user message against memory nodes,
   * return constellations for top matches.
   * Used as pre-processing before calling Claude.
   */
  async autoRecall(messageText, limit = 3) {
    // Extract significant words (4+ chars, skip common words)
    const words = messageText
      .replace(/[^\w\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    if (words.length === 0) return [];

    // Search for matching nodes using first few significant words
    const searchTerms = words.slice(0, 5);
    const orConditions = searchTerms
      .map((w) => `concept.ilike.%${w}%,description.ilike.%${w}%`)
      .join(',');

    const { data, error } = await this.client
      .from('memory_nodes')
      .select('id, concept, type, description, importance')
      .eq('forgotten', false)
      .or('is_suppressed.eq.false,is_suppressed.is.null')
      .or(orConditions)
      .order('importance', { ascending: true })
      .limit(limit);

    if (error || !data || data.length === 0) return [];

    // Activate matched nodes
    await this._activateNodes(data.map((n) => n.id));

    return data;
  }

  // ─── WRITE ─────────────────────────────────────────────

  /**
   * Store a new memory node.
   */
  async storeNode({ concept, type, description, importance, arousal, valence, feelings, symbols, events, category }) {
    // Generate embedding for the new node
    let embedding = null;
    try {
      embedding = await embedMemoryNode({ concept, description });
    } catch (err) {
      console.error('[Memory] Embedding generation failed (non-blocking):', err.message);
    }

    const row = {
      concept,
      type: type || 'particular',
      description,
      importance: importance || 2,
      arousal: arousal || 2,
      valence: valence || 'neutral',
      feelings: feelings || [],
      symbols: symbols || [],
      events: events || [],
      category: category || null,
      is_provisional: true, // Consolidation Window: provisional for 24 hours
    };

    if (embedding) {
      row.embedding = JSON.stringify(embedding);
    }

    const { data, error } = await this.client
      .from('memory_nodes')
      .insert(row)
      .select('id, concept')
      .single();

    if (error) throw new Error(`storeNode: ${error.message}`);
    return data;
  }

  /**
   * Create an edge between two memory nodes.
   */
  async createEdge({ fromNode, toNode, linkType, strength, description }) {
    const { data, error } = await this.client
      .from('memory_edges')
      .insert({
        from_node: fromNode,
        to_node: toNode,
        link_type: linkType,
        strength: strength || 5,
        description: description || null,
      })
      .select('id')
      .single();

    if (error) throw new Error(`createEdge: ${error.message}`);
    return data;
  }

  // ─── FORGETTING PROTOCOL ────────────────────────────────

  /**
   * Motivated Forgetting: Kit actively suppresses a negative memory.
   * Needs 3 attempts to fully suppress. 24hr cooldown between attempts.
   * Also applies Parallel Regulation (activation * 0.6, arousal +1)
   * and Amnesic Shadow (±1hr temporal neighbors * 0.9).
   */
  async suppressMemory(nodeId) {
    // Step 1: Attempt suppression (with cooldown check)
    const { data: suppressResult, error: suppressErr } = await this.client
      .rpc('suppress_memory', { target_node_id: nodeId });

    if (suppressErr) throw new Error(`suppressMemory: ${suppressErr.message}`);
    if (!suppressResult.success) return suppressResult;

    // Step 2: Parallel Regulation — reduce activation + blunt arousal
    const { error: prErr } = await this.client
      .rpc('parallel_regulate', { target_node_id: nodeId });
    if (prErr) console.error('[Memory] Parallel regulation failed:', prErr.message);

    // Step 3: Amnesic Shadow — weaken temporal neighbors
    const { data: shadowCount, error: shadowErr } = await this.client
      .rpc('apply_amnesic_shadow', {
        suppressed_node_id: nodeId,
        time_window_hours: 1.0,
        shadow_factor: 0.9,
      });
    if (shadowErr) console.error('[Memory] Amnesic shadow failed:', shadowErr.message);
    else if (shadowCount > 0) {
      suppressResult.amnesic_shadow = `${shadowCount} temporally adjacent memories were also slightly weakened.`;
    }

    return suppressResult;
  }

  /**
   * Reconsolidation: Kit says "I can think about this calmly now."
   * Blunts arousal by one level on a negative memory.
   * "Making peace with the past."
   */
  async reconsolidateMemory(nodeId) {
    const { data, error } = await this.client
      .rpc('reconsolidate_memory', { target_node_id: nodeId });

    if (error) throw new Error(`reconsolidateMemory: ${error.message}`);
    return data;
  }

  /**
   * Consolidation: lock provisional nodes after 24 hours.
   * Called periodically (e.g. on bot startup or every few hours).
   */
  async consolidateProvisionalNodes() {
    const { data, error } = await this.client
      .rpc('consolidate_provisional_nodes');

    if (error) {
      console.error('[Memory] Consolidation failed:', error.message);
      return 0;
    }
    if (data > 0) {
      console.log(`[Memory] Consolidated ${data} provisional nodes.`);
    }
    return data;
  }

  /**
   * Upgrade importance of a provisional node during high-arousal recall.
   * Only works within the 24hr consolidation window.
   */
  async upgradeProvisionalImportance(nodeId) {
    const { data, error } = await this.client
      .rpc('upgrade_provisional_importance', { target_node_id: nodeId });

    if (error) throw new Error(`upgradeProvisionalImportance: ${error.message}`);
    return data;
  }

  /**
   * Semantic recall with Tip of the Tongue support.
   * - similarity >= 0.75: full recall (concept + description + feelings + symbols)
   * - similarity 0.70-0.75: ToT — partial recall (concept + feelings + symbols, NO description)
   *   Output: "等等……{trigger}让我想到什么。跟{symbol}有关。跟{feeling}有关。但我想不起来具体是什么了。"
   *
   * @param {string} messageText - user message to search against
   * @param {number} limit - max results
   * @param {boolean} directTrigger - if true, also searches suppressed nodes (Ella mentioned it directly)
   */
  async semanticRecall(messageText, limit = 5, directTrigger = false) {
    // Generate embedding for the query
    const { generateEmbedding } = require('./embeddings');
    let queryEmbedding;
    try {
      queryEmbedding = await generateEmbedding(messageText);
    } catch (err) {
      console.error('[Memory] Embedding query failed:', err.message);
      return [];
    }

    const { data, error } = await this.client
      .rpc('semantic_recall', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: limit,
        include_suppressed: directTrigger,
      });

    if (error) {
      console.error('[Memory] semanticRecall failed:', error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Activate recalled nodes (triggers RIF on similar nodes)
    const fullRecallIds = data
      .filter((n) => n.recall_type === 'full')
      .map((n) => n.id);
    if (fullRecallIds.length > 0) {
      await this._activateNodes(fullRecallIds);
    }

    // If a suppressed node was directly triggered, unsuppress it
    for (const node of data) {
      if (node.recall_type === 'suppressed_triggered') {
        try {
          await this.client.rpc('unsuppress_memory', { target_node_id: node.id });
          console.log(`[Memory] Unsuppressed "${node.concept}" — Ella triggered it directly.`);
        } catch (err) {
          console.error('[Memory] Unsuppress failed:', err.message);
        }
      }
    }

    return data;
  }

  /**
   * Format semantic recall results, handling Tip of the Tongue.
   */
  formatSemanticRecall(nodes) {
    if (!nodes || nodes.length === 0) return '';

    const lines = [];
    for (const n of nodes) {
      if (n.recall_type === 'tip_of_tongue') {
        // ToT: partial recall — per Corvus's suggestion, add "想不起来"
        const feelings = n.feelings?.length ? n.feelings.join(', ') : '某种感觉';
        const symbols = n.symbols?.length ? n.symbols.join(', ') : '什么';
        lines.push(`- [tip of tongue] 等等……"${n.concept}"让我想到什么。跟${symbols}有关。跟${feelings}有关。但我想不起来具体是什么了。`);
      } else if (n.recall_type === 'suppressed_triggered') {
        lines.push(`- [suppressed → recalled] ${n.concept}: ${n.description || ''} (this memory was suppressed, but she just mentioned it — it all comes back)`);
      } else {
        // Full recall
        const feelings = n.feelings?.length ? ` [${n.feelings.join(', ')}]` : '';
        const symbols = n.symbols?.length ? ` ⟨${n.symbols.join(', ')}⟩` : '';
        lines.push(`- [${n.type}, ${n.valence}${feelings}${symbols}] ${n.concept}: ${n.description || ''}`);
      }
    }

    return `\n--- Memory Recall (semantic) ---\n${lines.join('\n')}\n--- End Memory Recall ---`;
  }

  // ─── SEMANTIC SIMILARITY (for RIF) ─────────────────────

  /**
   * Find semantically similar nodes using cosine similarity.
   * Used by Retrieval-Induced Forgetting: when node A is activated,
   * find similar nodes to suppress.
   *
   * Requires: pgvector extension + embeddings populated.
   * Uses Supabase RPC function 'match_memory_nodes'.
   */
  async findSimilarNodes(nodeId, threshold = 0.7, limit = 10) {
    // Get the target node's embedding
    const { data: node, error: nodeErr } = await this.client
      .from('memory_nodes')
      .select('embedding')
      .eq('id', nodeId)
      .single();

    if (nodeErr || !node?.embedding) return [];

    const { data, error } = await this.client
      .rpc('match_memory_nodes', {
        query_embedding: node.embedding,
        similarity_threshold: threshold,
        match_count: limit,
        exclude_id: nodeId,
      });

    if (error) {
      console.error('[Memory] findSimilarNodes RPC failed:', error.message);
      return [];
    }

    return data || [];
  }

  // ─── ACTIVATION + RIF ───────────────────────────────────

  /**
   * Activate nodes and apply RIF (Retrieval-Induced Forgetting).
   * When a node is recalled, it gets stronger. Similar nodes get suppressed.
   */
  async _activateNodes(ids) {
    for (const id of ids) {
      try {
        const { data, error } = await this.client.rpc('apply_rif', {
          activated_node_id: id,
          similarity_threshold: 0.7,
          suppression_factor: 0.85,
        });

        if (error) {
          // Fallback: simple activation without RIF (e.g. if SQL function not yet created)
          await this.client
            .from('memory_nodes')
            .update({
              activation_count: 1, // will be overwritten by increment below
              last_activated_at: new Date().toISOString(),
            })
            .eq('id', id);
          await this.client.rpc('increment_activation', { node_id: id }).catch(() => {});
        }
      } catch {
        // Non-critical
      }
    }
  }

  // ─── FORMATTING ────────────────────────────────────────

  /**
   * Format core memories for system prompt injection.
   */
  formatCoreMemories(nodes) {
    if (!nodes || nodes.length === 0) return '';

    const lines = nodes.map((n) => {
      const feelings = n.feelings?.length ? ` [${n.feelings.join(', ')}]` : '';
      const symbols = n.symbols?.length ? ` ⟨${n.symbols.join(', ')}⟩` : '';
      return `- (${n.type}, ${n.valence}${feelings}${symbols}) ${n.concept}: ${n.description || ''}`;
    });

    return `\n--- Core Memories (importance=1) ---\n${lines.join('\n')}\n--- End Core Memories ---`;
  }

  /**
   * Format auto-recall results for context injection.
   */
  formatAutoRecall(nodes) {
    if (!nodes || nodes.length === 0) return '';

    const lines = nodes.map((n) => `- [${n.type}] ${n.concept}: ${n.description || ''}`);
    return `\n--- Related Memories (auto-recall) ---\n${lines.join('\n')}\n--- End Related Memories ---`;
  }
}

module.exports = MemoryManager;
