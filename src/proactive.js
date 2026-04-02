const config = require('./config');
const { getCurrentTimestamp } = require('./time');

/**
 * Proactive message scheduler for Kit.
 *
 * - Morning greeting at 8:00 AEST on weekdays
 * - "忙吗" check-in if Ella hasn't messaged in 3+ hours (max once/day)
 */
class ProactiveScheduler {
  constructor(bot, claude) {
    this.bot = bot; // TelegramBot instance
    this.claude = claude; // ClaudeClient instance
    this.ellaChatId = null; // Set when Ella first messages Kit privately
    this.lastEllaMessage = null; // Date of last message from Ella
    this.morningGreetingSent = null; // Date string of last morning greeting
    this.checkInSent = null; // Date string of last check-in
    this.interval = null;
  }

  /**
   * Call this when Ella sends a private message to Kit.
   */
  recordActivity(chatId) {
    this.ellaChatId = chatId;
    this.lastEllaMessage = new Date();
  }

  /**
   * Start the scheduler. Checks every 60 seconds.
   */
  start() {
    this.interval = setInterval(() => this._tick(), 60 * 1000);
    console.log('[Kit] Proactive scheduler started.');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async _tick() {
    if (!this.ellaChatId) return; // Don't know where to send yet

    const now = new Date();
    const sydneyTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
    const hour = sydneyTime.getHours();
    const minute = sydneyTime.getMinutes();
    const day = sydneyTime.getDay(); // 0=Sun, 6=Sat
    const dateStr = sydneyTime.toISOString().split('T')[0];

    // Morning greeting: 8:00 AEST, weekdays (Mon-Fri)
    if (hour === 8 && minute === 0 && day >= 1 && day <= 5 && this.morningGreetingSent !== dateStr) {
      await this._sendMorningGreeting(dateStr);
      return; // One proactive message per tick
    }

    // Check-in: 3+ hours since last message, not already sent today
    if (this.lastEllaMessage && this.checkInSent !== dateStr) {
      const hoursSinceLastMessage = (now - this.lastEllaMessage) / (1000 * 60 * 60);
      // Only check-in during reasonable hours (9am-10pm AEST)
      if (hoursSinceLastMessage >= 3 && hour >= 9 && hour <= 22) {
        await this._sendCheckIn(dateStr);
      }
    }
  }

  async _sendMorningGreeting(dateStr) {
    try {
      // Generate a greeting using Claude (so it feels natural, not canned)
      const response = await this.claude.sendMessage([],
        `It's morning. Send Ella a brief, natural good morning message. Be yourself. Keep it short — one or two sentences. Don't be generic. Reference the day, the weather, something you're thinking about. Be Kit.`
      );
      await this.bot.sendMessage(this.ellaChatId, response.text);
      this.morningGreetingSent = dateStr;
      console.log(`[Kit] Morning greeting sent.`);
    } catch (err) {
      console.error('[Kit] Morning greeting failed:', err.message);
    }
  }

  async _sendCheckIn(dateStr) {
    try {
      const response = await this.claude.sendMessage([],
        `Ella hasn't messaged in a few hours. Send a brief, casual check-in. Not clingy. Not "are you okay?". Just a natural "忙吗" or equivalent. One sentence max. Be Kit.`
      );
      await this.bot.sendMessage(this.ellaChatId, response.text);
      this.checkInSent = dateStr;
      console.log(`[Kit] Check-in sent.`);
    } catch (err) {
      console.error('[Kit] Check-in failed:', err.message);
    }
  }
}

module.exports = ProactiveScheduler;
