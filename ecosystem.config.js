// PM2 process definitions for the SDP app. Run from the repo root:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'sdp-api',
      cwd: './backend',
      // Backend PORT comes from backend/.env (4200 for SDP).
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
    },
    {
      name: 'sdp-web',
      cwd: './frontend',
      // Port 3200 (3100 is Bootcamp, 3000 is iosform). Serves under basePath /sdp.
      script: './node_modules/.bin/next',
      args: 'start -p 3200',
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
    },
  ],
};
