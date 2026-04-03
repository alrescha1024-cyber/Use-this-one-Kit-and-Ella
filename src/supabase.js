const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

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
      .order('arousal', { ascending: false })
      .order('last_activated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`getCoreMemories: ${error.message}`);
    return data;
  }

  /**
   * Search memory nodes by keyword in concept or description.
   */
  async searchByKeyword(keyword, limit = 10) {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('id, concept, type, description, feelings, symbols, importance, arousal, valence')
      .eq('forgotten', false)
      .or(`concept.ilike.%${keyword}%,description.ilike.%${keyword}%`)
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
        .eq('forgotten', false);

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
    const { data, error } = await this.client
      .from('memory_nodes')
      .insert({
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
      })
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

  // ─── ACTIVATION ────────────────────────────────────────

  /**
   * Update activation count and timestamp for touched nodes.
   */
  async _activateNodes(ids) {
    try {
      for (const id of ids) {
        await this.client
          .from('memory_nodes')
          .update({
            activation_count: this.client.rpc ? undefined : 1,
            last_activated_at: new Date().toISOString(),
          })
          .eq('id', id);

        // Try RPC for atomic increment, fallback silently
        await this.client.rpc('increment_activation', { node_id: id }).catch(() => {});
      }
    } catch {
      // Non-critical
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
