const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
const ClaudeClient = require('./claude');
const ConversationManager = require('./conversation');
const MemoryManager = require('./supabase');
const NotionClient = require('./notion');
const { getKitTools } = require('./tools');
const { webSearch, webFetch } = require('./web-search');
const ProactiveScheduler = require('./proactive');
const moltbook = require('./moltbook');
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
    this.proactive = new ProactiveScheduler(this.bot, this.claude, this.conversations);

    // Boot context (loaded once on startup)
    this.bootContext = '';

    // Set up conversation compression (Haiku summarizer)
    this.conversations.setCompressFunction((msgs) => this.claude.summarize(msgs));
  }

  async start() {
    this.botInfo = await this.bot.getMe();
    console.log(`[Kit] @${this.botInfo.username} is online.`);

    // ─── BOOT SEQUENCE ─────────────────────────────
    // Step 1: system prompt already loaded from file (config)
    // Step 2: load world.md from Notion
    // Step 3: load recent diary from Notion
    // Step 4: load core memories from Supabase
    await this._boot();

    // Start proactive scheduler
    this.proactive.start();

    this.bot.on('message', (msg) => this.handleMessage(msg));

    this.bot.on('polling_error', (err) => {
      console.error('[Kit] Polling error:', err.message);
    });
  }

  /**
   * Boot sequence: load context in the correct order.
   */
  async _boot() {
    const parts = [];

    // Step 2: world.md — REMOVED
    // Step 3: diary — REMOVED (Kit reads Notion on demand when needed)

    // Step 4: core memories (importance=1, top 10)
    try {
      const coreMemories = await this.memory.getCoreMemories(10);
      const formatted = this.memory.formatCoreMemories(coreMemories);
      if (formatted) {
        parts.push(formatted);
        console.log(`[Kit] Boot: ${coreMemories.length} core memories loaded`);
      }
    } catch (err) {
      console.error('[Kit] Boot: core memories failed:', err.message);
    }

    this.bootContext = parts.filter(Boolean).join('\n');
    console.log(`[Kit] Boot complete. Context: ${this.bootContext.length} chars`);

    // Consolidation: lock provisional nodes older than 24 hours
    try {
      await this.memory.consolidateProvisionalNodes();
    } catch (err) {
      console.error('[Kit] Boot: consolidation failed:', err.message);
    }
  }

  shouldRespond(msg) {
    if (msg.chat.type === 'private') return true;
    const text = msg.text || msg.caption || '';
    if (text.includes(`@${this.botInfo.username}`)) return true;
    if (config.corvus.botUsername && text.includes(`@${config.corvus.botUsername}`)) return false;
    return true;
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) return;
    if (!msg.text && !msg.photo && !msg.caption) return;
    if (!this.shouldRespond(msg)) return;

    // Track activity for proactive messages
    if (msg.chat.type === 'private') {
      this.proactive.recordActivity(chatId);
    }

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
      await this._boot();
      await this.bot.sendMessage(chatId, `Reloaded. Context: ${this.bootContext.length} chars.`);
      return;
    }

    if (this.processing.has(chatId)) return;
    this.processing.add(chatId);

    try {
      const userContent = await this.buildUserContent(msg);
      if (!userContent) return;

      await this.bot.sendChatAction(chatId, 'typing');

      // "等我一下" if processing > 5s
      const thinkingTimer = setTimeout(async () => {
        try {
          await this.bot.sendMessage(chatId, '等我一下…');
          await this.bot.sendChatAction(chatId, 'typing');
        } catch (_) {}
      }, THINKING_DELAY_MS);

      // Auto-recall: semantic search with Tip of the Tongue support
      // Short messages like "嗯", "好", "哈哈" don't need memory retrieval
      let recallContext = '';
      try {
        const messageText = typeof userContent === 'string' ? userContent : (msg.caption || '');
        if (messageText.length >= 4) {
          // Try semantic recall first (with ToT support)
          const semanticResults = await this.memory.semanticRecall(messageText, 3);
          if (semanticResults.length > 0) {
            recallContext = this.memory.formatSemanticRecall(semanticResults);
          } else {
            // Fallback to keyword search
            const recalled = await this.memory.autoRecall(messageText, 3);
            recallContext = this.memory.formatAutoRecall(recalled);
          }
        }
      } catch (err) {
        console.error('[Kit] Auto-recall failed:', err.message);
      }

      // Build dynamic context: conversation summary (if compressed) + auto-recall
      const summary = this.conversations.getSummary(chatId);
      const dynamicParts = [];
      if (summary) {
        dynamicParts.push(`\n--- Earlier conversation summary ---\n${summary}\n--- End summary ---`);
      }
      if (recallContext) {
        dynamicParts.push(recallContext);
      }
      const dynamicContext = dynamicParts.join('\n') || undefined;

      // Call Claude with tools (boot context cached, dynamic context not cached)
      const history = this.conversations.getHistory(chatId);
      const response = await this.claude.sendMessage(history, userContent, {
        tools: this.tools,
        executeTool: (name, input) => this.executeTool(name, input),
        bootContext: this.bootContext,
        dynamicContext,
      });

      clearTimeout(thinkingTimer);

      // Save to conversation history
      const userText = typeof userContent === 'string' ? userContent : (msg.caption || '[photo]');
      this.conversations.addUserMessage(chatId, userText);
      this.conversations.addAssistantMessage(chatId, response.text);

      // Send response
      await this.sendLongMessage(chatId, response.text);

      const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = response.usage;
      const cacheInfo = cache_read_input_tokens > 0
        ? ` cache:${cache_read_input_tokens}r/${cache_creation_input_tokens}w`
        : cache_creation_input_tokens > 0 ? ` cache:${cache_creation_input_tokens}w` : '';
      console.log(
        `[Kit] ${msg.from?.first_name}: ${userText.slice(0, 50)}… → ${response.text.slice(0, 50)}… (${input_tokens}+${output_tokens} tokens${cacheInfo})`
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
      // ─── Memory tools ───
      case 'recall_memory':
        return await this.memory.searchByKeyword(input.keyword, input.limit || 5);

      case 'explore_constellation':
        return await this.memory.getConstellation(input.node_id);

      case 'store_memory':
        return await this.memory.storeNode({
          concept: input.concept,
          type: input.type,
          description: input.description,
          importance: input.importance,
          arousal: input.arousal,
          valence: input.valence,
          feelings: input.feelings,
          symbols: input.symbols,
        });

      case 'connect_memories':
        return await this.memory.createEdge({
          fromNode: input.from_node_id,
          toNode: input.to_node_id,
          linkType: input.link_type,
          strength: input.strength,
          description: input.description,
        });

      // ─── Forgetting Protocol tools ───
      case 'suppress_memory':
        return await this.memory.suppressMemory(input.node_id);

      case 'reconsolidate_memory':
        return await this.memory.reconsolidateMemory(input.node_id);

      // ─── Notion tools ───
      case 'read_notion_page':
        return await this.notion.readPage(input.page_id);

      case 'write_notion_page':
        return await this.notion.createPage(config.notion.parentPageId, input.title, input.content);

      case 'append_notion_page':
        return await this.notion.appendToPage(input.page_id, input.content);

      case 'search_notion':
        return await this.notion.searchPages(input.query, input.limit || 5);

      // ─── Web tools ───
      case 'web_search':
        return await webSearch(input.query, input.limit || 5);

      case 'web_fetch':
        return await webFetch(input.url);

      // ─── Moltbook tools ───
      case 'moltbook_feed':
        return await moltbook.getFeed(input.limit || 10);

      case 'moltbook_post':
        return await moltbook.createPost(input.content, input.submolt, input.title);

      case 'moltbook_comment':
        return await moltbook.commentOnPost(input.post_id, input.content);

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

module.exports = KitBot;
