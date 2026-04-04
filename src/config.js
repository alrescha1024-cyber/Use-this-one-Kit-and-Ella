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

  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },

  notion: {
    token: process.env.NOTION_TOKEN,
    parentPageId: process.env.NOTION_PARENT_PAGE_ID || '31c1f8d2-8306-816c-8427-df37c7d12dd8',
    pages: {
      // Kit
      kitWorld: '3351f8d2830680dab187e6b664542405',
      // Corvus
      corvusSoul: '3351f8d283068168b45aebd8583a702a',
      corvusHer: '3351f8d2830681649576fc56e4c6c6ca',
      corvusFamily: '3351f8d28306817098f7c67d90a4a223',
    },
  },

  kit: {
    telegramToken: process.env.TELEGRAM_KIT_TOKEN,
    model: 'claude-opus-4-6',
    temperature: parseFloat(process.env.KIT_TEMPERATURE) || 0.8,
    maxTokens: parseInt(process.env.KIT_MAX_TOKENS) || 2048,
    systemPrompt: kitSystemPrompt,
  },

  corvus: {
    telegramToken: process.env.TELEGRAM_CORVUS_TOKEN,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: corvusSystemPrompt,
    botUsername: null,
  },

  moltbook: {
    apiKey: process.env.MOLTBOOK_API_KEY,
  },

  allowedUserIds: process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(',').map(Number)
    : [],

  timezone: 'Australia/Sydney',

  conversation: {
    maxTurns: 100, // 你们话多，100轮够聊
  },

  proactive: {
    quietStart: 23,  // 23:00 AEST — start quiet hours
    quietEnd: 10,    // 10:00 AEST — end quiet hours
    maxPerDay: 1,    // max 1 proactive message per day
  },
};
