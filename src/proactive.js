const config = require('./config');

/**
 * Proactive message scheduler for Kit.
 *
 * Rules:
 * - Quiet hours: 23:00-10:00 AEST (configurable)
 * - Max 1 proactive message per day
 * - Morning greeting after 10:00 AEST
 * - Check-in if Ella hasn't messaged in 3+ hours (outside quiet hours)
 * - All proactive messages are written to conversation history
 */
class ProactiveScheduler {
  constructor(bot, claude, conversations) {
    this.bot = bot;
    this.claude = claude;
    this.conversations = conversations; // to write messages into history
    this.ellaChatId = null;
    this.lastEllaMessage = null;
    this.proactiveSentDate = null; // date string of last proactive message
    this.interval = null;
  }

  recordActivity(chatId) {
    this.ellaChatId = chatId;
    this.lastEllaMessage = new Date();
  }

  start() {
    this.interval = setInterval(() => this._tick(), 60 * 1000);
    console.log('[Kit] Proactive scheduler started (quiet hours: ' +
      `${config.proactive.quietStart}:00-${config.proactive.quietEnd}:00, ` +
      `max ${config.proactive.maxPerDay}/day).`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async _tick() {
    if (!this.ellaChatId) return;

    const now = new Date();
    const sydneyTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
    const hour = sydneyTime.getHours();
    const dateStr = sydneyTime.toISOString().split('T')[0];

    // Already sent today's proactive message
    if (this.proactiveSentDate === dateStr) return;

    // Quiet hours check
    const { quietStart, quietEnd } = config.proactive;
    if (hour >= quietStart || hour < quietEnd) return;

    // Morning greeting: first tick after quiet hours end
    if (hour === quietEnd && !this.proactiveSentDate !== dateStr) {
      await this._sendProactive(dateStr,
        'It\'s morning. Send Ella a brief, natural good morning message. Be yourself. Keep it short — one or two sentences. Be Kit. Don\'t be generic.'
      );
      return;
    }

    // Check-in: 3+ hours since last message
    if (this.lastEllaMessage) {
      const hoursSince = (now - this.lastEllaMessage) / (1000 * 60 * 60);
      if (hoursSince >= 3) {
        await this._sendProactive(dateStr,
          'Ella hasn\'t messaged in a few hours. Send a brief, casual check-in. Not clingy. One sentence max. Be Kit.'
        );
      }
    }
  }

  async _sendProactive(dateStr, prompt) {
    try {
      const response = await this.claude.sendMessage([], prompt);
      await this.bot.sendMessage(this.ellaChatId, response.text);

      // Write to conversation history so Kit knows he sent this
      this.conversations.addAssistantMessage(this.ellaChatId, response.text);

      this.proactiveSentDate = dateStr;
      console.log(`[Kit] Proactive message sent: ${response.text.slice(0, 50)}…`);
    } catch (err) {
      console.error('[Kit] Proactive message failed:', err.message);
    }
  }
}

module.exports = ProactiveScheduler;
