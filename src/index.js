const config = require('./config');
const KitBot = require('./kit-bot');

// Validate required env vars
const required = ['ANTHROPIC_API_KEY', 'TELEGRAM_KIT_TOKEN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in your keys.');
  process.exit(1);
}

async function main() {
  console.log('Starting Kit & Ella system...');
  console.log(`Kit model: ${config.kit.model} (temp: ${config.kit.temperature})`);

  const kit = new KitBot();
  await kit.start();

  console.log('System is ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
