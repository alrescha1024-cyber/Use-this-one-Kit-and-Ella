const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

class MemoryManager {
  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.key);
    this.table = 'memories';
  }

  /**
   * Get the N most recent memories.
   */
  async getRecent(limit = 15) {
    const { data, error } = await this.client
      .from(this.table)
      .select('id, content, category, tags, importance, emotion_valence, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Supabase getRecent: ${error.message}`);
    return data;
  }

  /**
   * Search memories by tag(s). Uses PostgreSQL array contains operator.
   */
  async searchByTags(tags, limit = 20) {
    const { data, error } = await this.client
      .from(this.table)
      .select('*')
      .contains('tags', tags)
      .order('importance', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Supabase searchByTags: ${error.message}`);

    // Update access tracking
    if (data.length > 0) {
      await this._touchAccess(data.map((m) => m.id));
    }
    return data;
  }

  /**
   * Search memories by keyword in content (case-insensitive).
   */
  async searchByKeyword(keyword, limit = 20) {
    const { data, error } = await this.client
      .from(this.table)
      .select('*')
      .ilike('content', `%${keyword}%`)
      .order('importance', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Supabase searchByKeyword: ${error.message}`);

    if (data.length > 0) {
      await this._touchAccess(data.map((m) => m.id));
    }
    return data;
  }

  /**
   * Store a new memory.
   */
  async store({ content, category, importance, emotionValence, decayClass, tags, source }) {
    const { data, error } = await this.client
      .from(this.table)
      .insert({
        content,
        category: category || 'insight',
        importance: importance || 5,
        emotion_valence: emotionValence || 'neutral',
        decay_class: decayClass || 'slow',
        tags: tags || [],
        source: source || 'api',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Supabase store: ${error.message}`);
    return data;
  }

  /**
   * Update last_accessed and access_count for retrieved memories.
   */
  async _touchAccess(ids) {
    try {
      for (const id of ids) {
        await this.client.rpc('touch_memory_access', { memory_id: id }).catch(() => {
          // Fallback: direct update if RPC doesn't exist
          this.client
            .from(this.table)
            .update({
              last_accessed: new Date().toISOString(),
              access_count: this.client.rpc ? undefined : 1, // can't increment without RPC
            })
            .eq('id', id)
            .then(() => {});
        });
      }
    } catch {
      // Non-critical — don't fail the main operation
    }
  }

  /**
   * Format memories for injection into system prompt.
   */
  formatForPrompt(memories) {
    if (!memories || memories.length === 0) return '';

    const lines = memories.map((m) => {
      const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
      const date = new Date(m.created_at).toISOString().split('T')[0];
      return `- (${date}, ${m.category}, importance:${m.importance}${tags}) ${m.content}`;
    });

    return `\n--- Recent Memories (${memories.length}) ---\n${lines.join('\n')}\n--- End Memories ---`;
  }
}

module.exports = MemoryManager;
