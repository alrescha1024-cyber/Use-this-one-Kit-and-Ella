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

  async sendMessage(conversationHistory, userContent) {
    const timePrefix = getTimeInjection();

    // Build the latest user message with time injection
    let latestUserMessage;
    if (typeof userContent === 'string') {
      latestUserMessage = { role: 'user', content: `${timePrefix}\n\n${userContent}` };
    } else {
      // Array of content blocks (image + text)
      latestUserMessage = {
        role: 'user',
        content: [{ type: 'text', text: timePrefix }, ...userContent],
      };
    }

    const messages = [...conversationHistory, latestUserMessage];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: this.systemPrompt,
      messages,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: response.usage,
      stopReason: response.stop_reason,
    };
  }
}

module.exports = ClaudeClient;
