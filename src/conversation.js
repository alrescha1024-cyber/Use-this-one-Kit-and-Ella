/**
 * In-memory conversation history per chat.
 * Simple FIFO: oldest messages drop when maxTurns exceeded.
 * No compression. No summaries. 忘了就忘了。
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

  _add(chatId, role, content) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    history.push({ role, content });

    // FIFO: drop oldest messages when exceeding maxTurns
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
