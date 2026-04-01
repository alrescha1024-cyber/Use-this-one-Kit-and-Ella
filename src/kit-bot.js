const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
const ClaudeClient = require('./claude');
const ConversationManager = require('./conversation');
const config = require('./config');

const TELEGRAM_MAX_LENGTH = 4096;
const THINKING_DELAY_MS = 5000;

class KitBot {
  constructor() {
    this.bot = new TelegramBot(config.kit.telegramToken, { polling: true });
    this.claude = new ClaudeClient({
      apiKey: config.anthropic.apiKey,
      model: config.kit.model,
      temperature: config.kit.temperature,
      maxTokens: config.kit.maxTokens,
      systemPrompt: config.kit.systemPrompt,
    });
    this.conversations = new ConversationManager(config.conversation.maxTurns);
    this.processing = new Set();
    this.botInfo = null;
  }

  async start() {
    this.botInfo = await this.bot.getMe();
    console.log(`[Kit] @${this.botInfo.username} is online.`);

    this.bot.on('message', (msg) => this.handleMessage(msg));

    this.bot.on('polling_error', (err) => {
      console.error('[Kit] Polling error:', err.message);
    });
  }

  shouldRespond(msg) {
    // Private chat: always respond
    if (msg.chat.type === 'private') return true;

    // Group chat: check @mentions
    const text = msg.text || msg.caption || '';

    // If Kit is explicitly mentioned, respond
    if (text.includes(`@${this.botInfo.username}`)) return true;

    // If another bot is explicitly mentioned (Corvus), don't respond
    if (config.corvus.botUsername && text.includes(`@${config.corvus.botUsername}`)) {
      return false;
    }

    // Default in group: Kit responds
    return true;
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    // Security: only respond to allowed users
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      return;
    }

    // No content to process
    if (!msg.text && !msg.photo && !msg.caption) return;

    // Group mention check
    if (!this.shouldRespond(msg)) return;

    // Handle commands
    if (msg.text === '/start') {
      await this.bot.sendMessage(chatId, "Hey. I'm here.");
      return;
    }
    if (msg.text === '/clear') {
      this.conversations.clear(chatId);
      await this.bot.sendMessage(chatId, 'Conversation cleared.');
      return;
    }

    // Prevent concurrent processing for same chat
    if (this.processing.has(chatId)) return;
    this.processing.add(chatId);

    try {
      const userContent = await this.buildUserContent(msg);
      if (!userContent) return;

      // Typing indicator
      await this.bot.sendChatAction(chatId, 'typing');

      // "等我一下" if processing takes > 5 seconds
      let thinkingSent = false;
      const thinkingTimer = setTimeout(async () => {
        try {
          thinkingSent = true;
          await this.bot.sendMessage(chatId, '等我一下…');
          await this.bot.sendChatAction(chatId, 'typing');
        } catch (_) { /* ignore */ }
      }, THINKING_DELAY_MS);

      // Get history and call Claude
      const history = this.conversations.getHistory(chatId);
      const response = await this.claude.sendMessage(history, userContent);

      clearTimeout(thinkingTimer);

      // Save to conversation history (text-only for token efficiency)
      const userText = typeof userContent === 'string'
        ? userContent
        : (msg.caption || '[photo]');
      this.conversations.addUserMessage(chatId, userText);
      this.conversations.addAssistantMessage(chatId, response.text);

      // Send response
      await this.sendLongMessage(chatId, response.text);

      console.log(
        `[Kit] ${msg.from?.first_name}: ${userText.slice(0, 50)}... → ${response.text.slice(0, 50)}... (${response.usage.input_tokens}+${response.usage.output_tokens} tokens)`
      );
    } catch (error) {
      console.error('[Kit] Error handling message:', error);
      await this.bot.sendMessage(chatId, '…something went wrong. Give me a moment.').catch(() => {});
    } finally {
      this.processing.delete(chatId);
    }
  }

  async buildUserContent(msg) {
    if (msg.photo && msg.photo.length > 0) {
      // Get highest resolution photo
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await this.bot.getFileLink(photo.file_id);
      const imageData = await this.downloadAsBase64(fileLink);

      const content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageData,
          },
        },
      ];

      if (msg.caption) {
        content.push({ type: 'text', text: msg.caption });
      }

      return content;
    }

    return msg.text || null;
  }

  downloadAsBase64(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  async sendLongMessage(chatId, text) {
    if (text.length <= TELEGRAM_MAX_LENGTH) {
      await this.bot.sendMessage(chatId, text);
      return;
    }

    // Split by paragraphs to avoid cutting mid-sentence
    const chunks = [];
    let current = '';
    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > TELEGRAM_MAX_LENGTH) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) chunks.push(current);

    for (const chunk of chunks) {
      await this.bot.sendMessage(chatId, chunk);
    }
  }
}

module.exports = KitBot;
