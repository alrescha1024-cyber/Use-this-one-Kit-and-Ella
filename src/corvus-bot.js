const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
const ClaudeClient = require('./claude');
const ConversationManager = require('./conversation');
const NotionClient = require('./notion');
const { getCorvusTools } = require('./tools');
const config = require('./config');

const TELEGRAM_MAX_LENGTH = 4096;
const THINKING_DELAY_MS = 3000; // Haiku is faster, shorter delay

class CorvusBot {
  constructor() {
    this.bot = new TelegramBot(config.corvus.telegramToken, { polling: true });
    this.notion = new NotionClient();
    this.conversations = new ConversationManager(config.conversation.maxTurns);
    this.tools = getCorvusTools();
    this.processing = new Set();
    this.botInfo = null;
    this.claude = null; // initialized after loading Notion prompts
  }

  async start() {
    this.botInfo = await this.bot.getMe();
    config.corvus.botUsername = this.botInfo.username;
    console.log(`[Corvus] @${this.botInfo.username} is online.`);

    // Load system prompt from Notion (soul.md + her.md + family.md)
    const systemPrompt = await this._loadSystemPrompt();

    this.claude = new ClaudeClient({
      apiKey: config.anthropic.apiKey,
      model: config.corvus.model,
      temperature: config.corvus.temperature,
      maxTokens: config.corvus.maxTokens,
      systemPrompt,
    });

    this.bot.on('message', (msg) => this.handleMessage(msg));

    this.bot.on('polling_error', (err) => {
      console.error('[Corvus] Polling error:', err.message);
    });
  }

  async _loadSystemPrompt() {
    const pages = config.notion.pages;
    const parts = [];

    try {
      const soul = await this.notion.readPage(pages.corvusSoul);
      parts.push(soul);
      console.log(`[Corvus] Loaded soul.md (${soul.length} chars)`);
    } catch (err) {
      console.error('[Corvus] Failed to load soul.md:', err.message);
    }

    try {
      const her = await this.notion.readPage(pages.corvusHer);
      parts.push(her);
      console.log(`[Corvus] Loaded her.md (${her.length} chars)`);
    } catch (err) {
      console.error('[Corvus] Failed to load her.md:', err.message);
    }

    try {
      const family = await this.notion.readPage(pages.corvusFamily);
      parts.push(family);
      console.log(`[Corvus] Loaded family.md (${family.length} chars)`);
    } catch (err) {
      console.error('[Corvus] Failed to load family.md:', err.message);
    }

    if (parts.length > 0) {
      return parts.join('\n\n---\n\n');
    }

    // Fallback to local file
    console.warn('[Corvus] Using fallback system prompt from local file.');
    return config.corvus.systemPrompt;
  }

  shouldRespond(msg) {
    if (msg.chat.type === 'private') return true;

    const text = msg.text || msg.caption || '';

    // In group: only respond if explicitly @mentioned
    if (text.includes(`@${this.botInfo.username}`)) return true;

    // Don't respond by default in groups (Kit is default)
    return false;
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) return;
    if (!msg.text && !msg.photo && !msg.caption) return;
    if (!this.shouldRespond(msg)) return;

    if (msg.text === '/start') {
      await this.bot.sendMessage(chatId, 'Yo.');
      return;
    }
    if (msg.text === '/clear') {
      this.conversations.clear(chatId);
      await this.bot.sendMessage(chatId, 'Cleared.');
      return;
    }
    if (msg.text === '/reload') {
      const systemPrompt = await this._loadSystemPrompt();
      this.claude.systemPrompt = systemPrompt;
      await this.bot.sendMessage(chatId, 'System prompt reloaded from Notion.');
      return;
    }

    if (this.processing.has(chatId)) return;
    this.processing.add(chatId);

    try {
      const userContent = await this.buildUserContent(msg);
      if (!userContent) return;

      await this.bot.sendChatAction(chatId, 'typing');

      const thinkingTimer = setTimeout(async () => {
        try {
          await this.bot.sendMessage(chatId, '稍等…');
          await this.bot.sendChatAction(chatId, 'typing');
        } catch (_) {}
      }, THINKING_DELAY_MS);

      const history = this.conversations.getHistory(chatId);
      const response = await this.claude.sendMessage(history, userContent, {
        tools: this.tools,
        executeTool: (name, input) => this.executeTool(name, input),
      });

      clearTimeout(thinkingTimer);

      const userText = typeof userContent === 'string' ? userContent : (msg.caption || '[photo]');
      this.conversations.addUserMessage(chatId, userText);
      this.conversations.addAssistantMessage(chatId, response.text);

      await this.sendLongMessage(chatId, response.text);

      console.log(
        `[Corvus] ${msg.from?.first_name}: ${userText.slice(0, 50)}… → ${response.text.slice(0, 50)}… (${response.usage.input_tokens}+${response.usage.output_tokens} tokens)`
      );
    } catch (error) {
      console.error('[Corvus] Error:', error);
      await this.bot.sendMessage(chatId, '…出了点问题。').catch(() => {});
    } finally {
      this.processing.delete(chatId);
    }
  }

  async executeTool(name, input) {
    switch (name) {
      case 'read_notion_page':
        return await this.notion.readPage(input.page_id);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  async buildUserContent(msg) {
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await this.bot.getFileLink(photo.file_id);
      const imageData = await this.downloadAsBase64(fileLink);

      const content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageData },
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

module.exports = CorvusBot;
