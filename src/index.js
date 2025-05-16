import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySensible from '@fastify/sensible';
import fastifySocketIO from 'fastify-socket.io';
import fastifyCors from '@fastify/cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startCrawling } from './crawler.js';
import fs from 'fs';

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Fastify instance
const fastify = Fastify({
  logger: true
});

// Register plugins
await fastify.register(fastifySensible);
await fastify.register(fastifyCors, { 
  origin: true
});

// Register Socket.io
await fastify.register(fastifySocketIO, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Register static files handler - serve from public directory
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/'
});

// Setup Socket.io connection handler
fastify.ready(err => {
  if (err) throw err;

  fastify.io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let activeCrawling = false;
    let crawlProcess = null;

    // Handle start crawl event
    socket.on('startCrawl', async (data) => {
      if (activeCrawling) {
        socket.emit('crawlError', { message: 'A crawl is already in progress' });
        return;
      }

      console.log('Received startCrawl event with data:', data);
      activeCrawling = true;
      
      try {
        // Start the crawling process with additional onProductFound callback
        crawlProcess = startCrawling({
          domains: data.domains || [],
          options: data.options || {},
          onUpdate: (update) => {
            socket.emit('crawlUpdate', update);
          },
          onProgress: (progress) => {
            socket.emit('crawlProgress', progress);
          },
          onProductFound: (product) => {
            // This is the key change - explicitly emit productFound events
            socket.emit('productFound', product);
          },
          onComplete: (results) => {
            socket.emit('crawlComplete', results);
            activeCrawling = false;
            crawlProcess = null;
          },
          onError: (error) => {
            socket.emit('crawlError', error);
            activeCrawling = false;
            crawlProcess = null;
          }
        });
      } catch (error) {
        console.error('Error starting crawler:', error);
        socket.emit('crawlError', { message: error.message });
        activeCrawling = false;
        crawlProcess = null;
      }
    });

    // Handle stop crawl event
    socket.on('stopCrawl', async () => {
      if (crawlProcess && typeof crawlProcess.stop === 'function') {
        try {
          await crawlProcess.stop();
          socket.emit('crawlStopped');
        } catch (error) {
          socket.emit('crawlError', { message: `Error stopping crawl: ${error.message}` });
        }
      } else {
        socket.emit('crawlStopped');
      }
      activeCrawling = false;
      crawlProcess = null;
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      // Optionally stop any active crawls when client disconnects
      if (crawlProcess && typeof crawlProcess.stop === 'function') {
        crawlProcess.stop().catch(console.error);
      }
    });
  });
});

// Add a download endpoint for results
fastify.get('/download', async (request, reply) => {
  const { file } = request.query;
  
  if (!file) {
    return reply.badRequest('File parameter is required');
  }
  
  const outputDir = join(process.cwd(), 'crawled-data');
  const filePath = join(outputDir, file);
  
  // Security check - ensure the file is from our output directory
  if (!filePath.startsWith(outputDir) || !fs.existsSync(filePath)) {
    return reply.notFound('File not found');
  }
  
  return reply.sendFile(file, outputDir);
});

// Default route handler (serves index.html)
fastify.get('/', async (request, reply) => {
  return reply.sendFile('index.html');
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running on port 3000');
    console.log('Open http://localhost:3000 in your browser');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();