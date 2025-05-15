const Fastify = require('fastify');
const path = require('path');
const config = require('config');
const fs = require('fs');
const fastifyStatic = require('@fastify/static');
const fastifySensible = require('@fastify/sensible');
const fastifySocketIO = require('fastify-socket.io');

// Create Fastify instance with modified logger config
const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  }
});

// Register plugins
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

fastify.register(fastifySensible);

// Register Socket.io
fastify.register(fastifySocketIO);

// Setup socket.io events
fastify.ready(() => {
  fastify.io.on('connection', (socket) => {
    fastify.log.info(`Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      fastify.log.info(`Client disconnected: ${socket.id}`);
    });
  });
});

// Register API routes
fastify.register(require('./plugins/crawler-routes'));

// Root route serves the main HTML file
fastify.get('/', (req, reply) => {
  reply.sendFile('index.html');
});

// Create output directory if it doesn't exist
const outputDir = path.resolve(process.cwd(), config.get('outputDir') || './crawled-data');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Start server
const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT, host: 'localhost' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});