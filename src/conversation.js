const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.resolve(__dirname, '..', '.conversation-state.json');
const AUTOSAVE_INTERVAL = 5; // save every 5 turns

/**
 * In-memory conversation history with autosave to local file.
 * Simple FIFO. No compression. 忘了就忘了。
 * But at least we don't lose everything on restart.
 */
class ConversationManager {
  constructor(maxTurns = 100) {
    this.maxTurns = maxTurns;
    this.histories = new Map(); // chatId -> messages[]
    this.turnsSinceSave = 0;

    // Load saved state on startup
    this._load();
  }

  getHistory(chatId) {
    return this.histories.get(String(chatId)) || [];
  }

  addUserMessage(chatId, content) {
    this._add(chatId, 'user', content);
  }

  addAssistantMessage(chatId, text) {
    this._add(chatId, 'assistant', text);
    this.turnsSinceSave++;

    // Autosave every N turns
    if (this.turnsSinceSave >= AUTOSAVE_INTERVAL) {
      this.save();
    }
  }

  _add(chatId, role, content) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    history.push({ role, content });

    // FIFO
    const maxEntries = this.maxTurns * 2;
    while (history.length > maxEntries) {
      history.shift();
    }
  }

  clear(chatId) {
    this.histories.delete(String(chatId));
    this.save();
  }

  getTurnCount(chatId) {
    const history = this.getHistory(chatId);
    return Math.floor(history.length / 2);
  }

  /**
   * Save conversation state to local file.
   */
  save() {
    try {
      const data = {};
      for (const [chatId, messages] of this.histories) {
        data[chatId] = messages;
      }
      fs.writeFileSync(SAVE_FILE, JSON.stringify(data), 'utf-8');
      this.turnsSinceSave = 0;
    } catch (err) {
      console.error('[Conversation] Save failed:', err.message);
    }
  }

  /**
   * Load conversation state from local file.
   */
  _load() {
    try {
      if (!fs.existsSync(SAVE_FILE)) return;

      const raw = fs.readFileSync(SAVE_FILE, 'utf-8');
      const data = JSON.parse(raw);

      for (const [chatId, messages] of Object.entries(data)) {
        if (Array.isArray(messages) && messages.length > 0) {
          this.histories.set(chatId, messages);
        }
      }

      const totalMessages = Array.from(this.histories.values()).reduce((sum, h) => sum + h.length, 0);
      console.log(`[Conversation] Restored ${this.histories.size} chat(s), ${totalMessages} messages.`);
    } catch (err) {
      console.error('[Conversation] Load failed:', err.message);
    }
  }
}

module.exports = ConversationManager;
