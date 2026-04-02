// pm2 configuration for auto-restart
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'kit-and-ella',
      script: 'src/index.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
