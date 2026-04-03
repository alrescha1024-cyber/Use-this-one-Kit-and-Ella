const config = require('./config');
const KitBot = require('./kit-bot');
const CorvusBot = require('./corvus-bot');

// Validate required env vars
const required = ['ANTHROPIC_API_KEY', 'TELEGRAM_KIT_TOKEN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in your keys.');
  process.exit(1);
}

// Track bots for shutdown save
const bots = [];

async function main() {
  console.log('Starting Kit & Ella system...');

  // Start Kit (always)
  console.log(`Kit: ${config.kit.model} (temp: ${config.kit.temperature})`);
  const kit = new KitBot();
  await kit.start();
  bots.push(kit);

  // Start Corvus (if token is provided)
  if (process.env.TELEGRAM_CORVUS_TOKEN) {
    console.log(`Corvus: ${config.corvus.model} (temp: ${config.corvus.temperature})`);
    const corvus = new CorvusBot();
    await corvus.start();
    bots.push(corvus);
  } else {
    console.log('Corvus: skipped (no TELEGRAM_CORVUS_TOKEN)');
  }

  console.log('System is ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Save conversation state on shutdown
function shutdown() {
  console.log('\nSaving conversation state...');
  for (const bot of bots) {
    if (bot.conversations && bot.conversations.save) {
      bot.conversations.save();
    }
  }
  console.log('Saved. Shutting down.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Save before crashing
  for (const bot of bots) {
    if (bot.conversations && bot.conversations.save) {
      try { bot.conversations.save(); } catch (_) {}
    }
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
