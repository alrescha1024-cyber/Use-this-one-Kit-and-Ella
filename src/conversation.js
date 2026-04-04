const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.resolve(__dirname, '..', '.conversation-state.json');
const AUTOSAVE_INTERVAL = 5; // save every 5 turns

// Compression settings (Kit's spec: M=30 full turns, trigger at 50)
const FULL_KEEP_TURNS = 30;      // always keep the most recent 30 turns intact
const COMPRESS_TRIGGER = 50;     // trigger compression when total turns reach 50

/**
 * In-memory conversation history with autosave and compression.
 * When turns exceed COMPRESS_TRIGGER, the oldest turns are compressed
 * into a summary (via Haiku), keeping the most recent FULL_KEEP_TURNS intact.
 */
class ConversationManager {
  constructor(maxTurns = 100) {
    this.maxTurns = maxTurns;
    this.histories = new Map();  // chatId -> messages[]
    this.summaries = new Map();  // chatId -> summary string (compressed old turns)
    this.turnsSinceSave = 0;
    this.compressFunc = null;    // set by bot: async (messages) => summary string

    // Load saved state on startup
    this._load();
  }

  /**
   * Set the compression function (should use Haiku to summarize).
   * @param {Function} fn - async (messages[]) => string
   */
  setCompressFunction(fn) {
    this.compressFunc = fn;
  }

  getHistory(chatId) {
    return this.histories.get(String(chatId)) || [];
  }

  /**
   * Get conversation summary (compressed old turns) if any.
   */
  getSummary(chatId) {
    return this.summaries.get(String(chatId)) || '';
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

    // Check if compression is needed
    this._maybeCompress(chatId);
  }

  _add(chatId, role, content) {
    const key = String(chatId);
    if (!this.histories.has(key)) {
      this.histories.set(key, []);
    }
    const history = this.histories.get(key);
    history.push({ role, content });
  }

  /**
   * Compress old turns when history exceeds trigger threshold.
   * Keeps most recent FULL_KEEP_TURNS, compresses the rest into a summary.
   */
  async _maybeCompress(chatId) {
    const key = String(chatId);
    const history = this.histories.get(key);
    if (!history || !this.compressFunc) return;

    const turnCount = Math.floor(history.length / 2);
    if (turnCount < COMPRESS_TRIGGER) return;

    // How many messages to keep (FULL_KEEP_TURNS * 2 for user+assistant pairs)
    const keepMessages = FULL_KEEP_TURNS * 2;
    const toCompress = history.slice(0, history.length - keepMessages);

    if (toCompress.length === 0) return;

    try {
      console.log(`[Conversation] Compressing ${Math.floor(toCompress.length / 2)} turns for chat ${key}...`);

      // Build input for summarization: existing summary + old messages
      const existingSummary = this.summaries.get(key) || '';
      const messagesForSummary = existingSummary
        ? [{ role: 'user', content: `[Previous summary: ${existingSummary}]` }, ...toCompress]
        : toCompress;

      const summary = await this.compressFunc(messagesForSummary);
      this.summaries.set(key, summary);

      // Keep only the recent messages
      this.histories.set(key, history.slice(history.length - keepMessages));

      console.log(`[Conversation] Compressed. Summary: ${summary.length} chars. Kept ${FULL_KEEP_TURNS} turns.`);
      this.save();
    } catch (err) {
      console.error('[Conversation] Compression failed:', err.message);
    }
  }

  clear(chatId) {
    const key = String(chatId);
    this.histories.delete(key);
    this.summaries.delete(key);
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
      const data = { histories: {}, summaries: {} };
      for (const [chatId, messages] of this.histories) {
        data.histories[chatId] = messages;
      }
      for (const [chatId, summary] of this.summaries) {
        data.summaries[chatId] = summary;
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

      // Support both old format (flat) and new format (histories + summaries)
      const histories = data.histories || data;
      const summaries = data.summaries || {};

      for (const [chatId, messages] of Object.entries(histories)) {
        if (Array.isArray(messages) && messages.length > 0) {
          this.histories.set(chatId, messages);
        }
      }

      for (const [chatId, summary] of Object.entries(summaries)) {
        if (summary) {
          this.summaries.set(chatId, summary);
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
