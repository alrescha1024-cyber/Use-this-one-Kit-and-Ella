/**
 * In-memory conversation history per chat.
 * Phase 2: will be backed by Supabase for persistence.
 */
class ConversationManager {
  constructor(maxTurns = 30) {
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

  _add(chatId, role, content) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    history.push({ role, content });

    // Trim oldest messages when exceeding maxTurns
    // Each turn = 1 user + 1 assistant = 2 entries
    const maxEntries = this.maxTurns * 2;
    while (history.length > maxEntries) {
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
