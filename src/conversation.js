/**
 * In-memory conversation history per chat.
 * Phase 2: will be backed by Supabase for persistence.
 */
class ConversationManager {
  constructor(maxTurns = 50) {
    this.maxTurns = maxTurns;
    this.histories = new Map(); // chatId -> messages[]
  }

  getHistory(chatId) {
    return this.histories.get(String(chatId)) || [];
  }

  addUserMessage(chatId, content) {
    this._add(chatId, 'user', content);
  }

  addAssistantMessage(chatId, text) {
    this._add(chatId, 'assistant', text);
  }

  /**
   * Prepend a summary message at the start of history.
   * Used after compression to preserve context.
   */
  prependSummary(chatId, summary) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    // Insert as the first two messages (user summary + assistant ack)
    history.unshift(
      { role: 'user', content: `[Previous conversation summary]\n${summary}` },
      { role: 'assistant', content: 'Understood. I remember our conversation.' }
    );
  }

  _add(chatId, role, content) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    history.push({ role, content });

    // Soft limit: don't silently drop messages.
    // Compression is handled by _maybeCompress in the bot.
    // Only hard-cap at 2x maxTurns as safety net.
    const hardCap = this.maxTurns * 2 * 2;
    while (history.length > hardCap) {
      history.shift();
    }
  }

  clear(chatId) {
    this.histories.delete(String(chatId));
  }

  getTurnCount(chatId) {
    const history = this.getHistory(chatId);
    return Math.floor(history.length / 2);
  }
}

module.exports = ConversationManager;
