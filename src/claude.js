const Anthropic = require('@anthropic-ai/sdk');
const { getTimeInjection } = require('./time');

class ClaudeClient {
  constructor({ apiKey, model, temperature, maxTokens, systemPrompt }) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Send a message to Claude, handling tool use loops.
   * Supports prompt caching for system prompt, boot context, tools, and conversation history.
   *
   * @param {Array} conversationHistory - Previous messages in Claude API format
   * @param {string|Array} userContent - Text string or content blocks (for images)
   * @param {Object} options
   * @param {Array} options.tools - Tool definitions
   * @param {Function} options.executeTool - async (name, input) => result
   * @param {string} options.bootContext - Static context loaded at startup (cached)
   * @param {string} options.dynamicContext - Per-message context like auto-recall (not cached)
   * @returns {{ text: string, usage: object }}
   */
  async sendMessage(conversationHistory, userContent, options = {}) {
    const { tools, executeTool, bootContext, dynamicContext } = options;
    const timePrefix = getTimeInjection();

    // ─── Build system as array of blocks with cache breakpoints ───
    const system = [];

    if (bootContext) {
      // System prompt (prefix, no breakpoint yet)
      system.push({ type: 'text', text: this.systemPrompt });
      // Boot context — cache breakpoint (system prompt + boot context cached together)
      system.push({ type: 'text', text: bootContext, cache_control: { type: 'ephemeral' } });
    } else {
      // No boot context — cache system prompt directly
      system.push({ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } });
    }

    // Dynamic context (auto-recall) — NOT cached, changes every message
    if (dynamicContext) {
      system.push({ type: 'text', text: dynamicContext });
    }

    // ─── Build user message with time injection ───
    let latestUserMessage;
    if (typeof userContent === 'string') {
      latestUserMessage = { role: 'user', content: `${timePrefix}\n\n${userContent}` };
    } else {
      latestUserMessage = {
        role: 'user',
        content: [{ type: 'text', text: timePrefix }, ...userContent],
      };
    }

    // ─── Clone conversation history and add cache breakpoint on last message ───
    const messages = conversationHistory.map((msg, i) => {
      if (i !== conversationHistory.length - 1) return msg;

      // Add cache_control to the last block of the last history message
      const cloned = { ...msg };
      if (typeof cloned.content === 'string') {
        cloned.content = [
          { type: 'text', text: cloned.content, cache_control: { type: 'ephemeral' } },
        ];
      } else if (Array.isArray(cloned.content)) {
        cloned.content = cloned.content.map((block, j) =>
          j === cloned.content.length - 1
            ? { ...block, cache_control: { type: 'ephemeral' } }
            : block
        );
      }
      return cloned;
    });
    messages.push(latestUserMessage);

    const totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    // ─── Tool use loop ───
    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
      const params = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system,
        messages,
      };

      // Add tools with cache breakpoint on the last tool
      if (tools && tools.length > 0) {
        params.tools = tools.map((tool, j) =>
          j === tools.length - 1
            ? { ...tool, cache_control: { type: 'ephemeral' } }
            : tool
        );
      }

      const response = await this.client.messages.create(params);

      totalUsage.input_tokens += response.usage.input_tokens;
      totalUsage.output_tokens += response.usage.output_tokens;
      totalUsage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
      totalUsage.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;

      // If no tool use or stop_reason is end_turn, return the text
      if (response.stop_reason !== 'tool_use' || !executeTool) {
        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');

        return { text, usage: totalUsage, stopReason: response.stop_reason };
      }

      // Handle tool use: add assistant message, execute tools, add results
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        let result;
        try {
          result = await executeTool(toolUse.name, toolUse.input);
        } catch (err) {
          result = `Error: ${err.message}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // If we exhausted iterations, return whatever text we have
    return { text: '…I got caught in a loop. Let me try again.', usage: totalUsage, stopReason: 'max_iterations' };
  }

  /**
   * Summarize conversation turns using a cheaper model (Haiku).
   */
  async summarize(messages) {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      system: 'Summarize the following conversation concisely in 2-3 paragraphs. Preserve key facts, emotional moments, decisions made, and any promises or plans. Write in the same language(s) the conversation uses.',
      messages: [
        {
          role: 'user',
          content: messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[media]'}`).join('\n\n'),
        },
      ],
    });

    return response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}

module.exports = ClaudeClient;
