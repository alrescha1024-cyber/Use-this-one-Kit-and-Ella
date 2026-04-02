const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function loadPrompt(filename, fallback) {
  const filepath = path.resolve(__dirname, '..', 'prompts', filename);
  try {
    return fs.readFileSync(filepath, 'utf-8').trim();
  } catch {
    return fallback;
  }
}

const kitSystemPrompt = loadPrompt('kit-system.txt', 'You are Kit.');
const corvusSystemPrompt = loadPrompt('corvus-system.txt', 'You are Corvus.');

module.exports = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  kit: {
    telegramToken: process.env.TELEGRAM_KIT_TOKEN,
    model: 'claude-opus-4-6',
    temperature: parseFloat(process.env.KIT_TEMPERATURE) || 0.8,
    maxTokens: parseInt(process.env.KIT_MAX_TOKENS) || 4096,
    systemPrompt: kitSystemPrompt,
  },

  corvus: {
    telegramToken: process.env.TELEGRAM_CORVUS_TOKEN,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: corvusSystemPrompt,
    botUsername: null, // populated at runtime
  },

  allowedUserIds: process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(',').map(Number)
    : [],

  timezone: 'Australia/Sydney',

  conversation: {
    maxTurns: 30,
  },
};
