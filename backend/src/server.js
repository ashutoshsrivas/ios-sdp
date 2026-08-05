const http = require('http');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { init } = require('./db');

async function main() {
  await init();

  const app = express();
  app.use(
    cors({
      origin(origin, cb) {
        // allow same-origin/no-origin (curl, mobile) and configured web origins
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
    })
  );
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ios-bootcamp-api' }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/bootcamps', require('./routes/bootcamps'));
  app.use('/api/roster', require('./routes/roster'));
  app.use('/api/students', require('./routes/students'));
  app.use('/api/teams', require('./routes/teams'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/rubrics', require('./routes/rubrics'));
  app.use('/api/tasks', require('./routes/tasks'));
  app.use('/api/questions', require('./routes/questions'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/uploads', require('./routes/uploads'));
  app.use('/api/chat', require('./routes/chat'));
  app.use('/api/certificates', require('./routes/certificates'));

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  const server = http.createServer(app);

  // Attach the team-chat WebSocket hub and start the 30-day file cleanup.
  require('./chatHub').attach(server);
  require('./chatCleanup').start(require('./routes/chat').CHAT_DIR);

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
