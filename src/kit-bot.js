const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
const ClaudeClient = require('./claude');
const ConversationManager = require('./conversation');
const MemoryManager = require('./supabase');
const NotionClient = require('./notion');
const { getKitTools } = require('./tools');
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
    this.memory = new MemoryManager();
    this.notion = new NotionClient();
    this.tools = getKitTools();
    this.processing = new Set();
    this.botInfo = null;
    this.worldMd = ''; // cached world.md from Notion
  }

  async start() {
    this.botInfo = await this.bot.getMe();
    console.log(`[Kit] @${this.botInfo.username} is online.`);

    // Load world.md from Notion on startup
    await this._loadWorldMd();

    this.bot.on('message', (msg) => this.handleMessage(msg));

    this.bot.on('polling_error', (err) => {
      console.error('[Kit] Polling error:', err.message);
    });
  }

  async _loadWorldMd() {
    try {
      this.worldMd = await this.notion.readPage(config.notion.pages.kitWorld);
      console.log(`[Kit] Loaded world.md (${this.worldMd.length} chars)`);
    } catch (err) {
      console.error('[Kit] Failed to load world.md:', err.message);
      this.worldMd = '';
    }
  }

  shouldRespond(msg) {
    if (msg.chat.type === 'private') return true;

    const text = msg.text || msg.caption || '';
    if (text.includes(`@${this.botInfo.username}`)) return true;
    if (config.corvus.botUsername && text.includes(`@${config.corvus.botUsername}`)) return false;

    // Default in group: Kit responds
    return true;
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) return;
    if (!msg.text && !msg.photo && !msg.caption) return;
    if (!this.shouldRespond(msg)) return;

    // Commands
    if (msg.text === '/start') {
      await this.bot.sendMessage(chatId, "Hey. I'm here.");
      return;
    }
    if (msg.text === '/clear') {
      this.conversations.clear(chatId);
      await this.bot.sendMessage(chatId, 'Conversation cleared.');
      return;
    }
    if (msg.text === '/reload') {
      await this._loadWorldMd();
      await this.bot.sendMessage(chatId, `world.md reloaded (${this.worldMd.length} chars).`);
      return;
    }

    if (this.processing.has(chatId)) return;
    this.processing.add(chatId);

    try {
      const userContent = await this.buildUserContent(msg);
      if (!userContent) return;

      await this.bot.sendChatAction(chatId, 'typing');

      // "等我一下" if processing takes > 5s
      let thinkingTimer = setTimeout(async () => {
        try {
          await this.bot.sendMessage(chatId, '等我一下…');
          await this.bot.sendChatAction(chatId, 'typing');
        } catch (_) {}
      }, THINKING_DELAY_MS);

      // Load recent memories for context injection
      let memorySuffix = '';
      try {
        const recentMemories = await this.memory.getRecent(config.conversation.memoryInjectCount);
        memorySuffix = this.memory.formatForPrompt(recentMemories);
      } catch (err) {
        console.error('[Kit] Memory load failed:', err.message);
      }

      // Build system suffix: world.md + recent memories
      const systemSuffix = [
        this.worldMd ? `\n--- world.md ---\n${this.worldMd}\n--- End world.md ---` : '',
        memorySuffix,
      ]
        .filter(Boolean)
        .join('\n');

      // Get conversation history and call Claude with tools
      const history = this.conversations.getHistory(chatId);
      const response = await this.claude.sendMessage(history, userContent, {
        tools: this.tools,
        executeTool: (name, input) => this.executeTool(name, input),
        systemSuffix,
      });

      clearTimeout(thinkingTimer);

      // Save to conversation history
      const userText = typeof userContent === 'string' ? userContent : (msg.caption || '[photo]');
      this.conversations.addUserMessage(chatId, userText);
      this.conversations.addAssistantMessage(chatId, response.text);

      // Auto-compress if needed
      await this._maybeCompress(chatId);

      // Send response
      await this.sendLongMessage(chatId, response.text);

      console.log(
        `[Kit] ${msg.from?.first_name}: ${userText.slice(0, 50)}… → ${response.text.slice(0, 50)}… (${response.usage.input_tokens}+${response.usage.output_tokens} tokens)`
      );
    } catch (error) {
      console.error('[Kit] Error:', error);
      await this.bot.sendMessage(chatId, '…something went wrong. Give me a moment.').catch(() => {});
    } finally {
      this.processing.delete(chatId);
    }
  }

  /**
   * Execute a tool call from Claude.
   */
  async executeTool(name, input) {
    switch (name) {
      case 'search_memory': {
        if (input.tags && input.tags.length > 0) {
          return await this.memory.searchByTags(input.tags, input.limit || 10);
        }
        if (input.keyword) {
          return await this.memory.searchByKeyword(input.keyword, input.limit || 10);
        }
        return await this.memory.getRecent(input.limit || 10);
      }

      case 'store_memory': {
        return await this.memory.store({
          content: input.content,
          category: input.category,
          importance: input.importance,
          emotionValence: input.emotion_valence,
          decayClass: input.decay_class,
          tags: input.tags || [],
          source: 'kit',
        });
      }

      case 'read_notion_page': {
        return await this.notion.readPage(input.page_id);
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  /**
   * Auto-compress old conversation turns when exceeding maxTurns.
   * Takes the oldest 10 turns, summarizes them, stores in Supabase.
   */
  async _maybeCompress(chatId) {
    const turnCount = this.conversations.getTurnCount(chatId);
    if (turnCount <= config.conversation.maxTurns) return;

    try {
      const history = this.conversations.getHistory(chatId);
      const oldMessages = history.slice(0, 20); // 10 turns = 20 messages

      // Summarize using Haiku
      const summary = await this.claude.summarize(oldMessages);

      // Store summary in Supabase
      await this.memory.store({
        content: `[Conversation Summary] ${summary}`,
        category: 'shared_experience',
        importance: 5,
        emotionValence: 'neutral',
        decayClass: 'slow',
        tags: ['COMPRESS'],
        source: 'auto_compress',
      });

      // Remove old messages from active history
      history.splice(0, 20);

      console.log(`[Kit] Compressed 10 turns for chat ${chatId}`);
    } catch (err) {
      console.error('[Kit] Compression failed:', err.message);
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
