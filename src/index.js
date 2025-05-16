import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySensible from '@fastify/sensible';
import fastifySocketIO from 'fastify-socket.io';
import fastifyCors from '@fastify/cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startCrawling } from './crawler.js';
import fs from 'fs';
import config from 'config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outputDir = config.get('outputDir');

const fastify = Fastify({
  logger: true
});

await fastify.register(fastifySensible);
await fastify.register(fastifyCors, { 
  origin: true
});

await fastify.register(fastifySocketIO, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 10000,
  pingInterval: 5000,
  transports: ['websocket', 'polling']
});

fastify.get('/download', async (request, reply) => {
  try {
    const { domain } = request.query;
    
    if (!domain) {
      return reply.code(400).send({ error: 'Domain parameter is required' });
    }
    
    const productFileName = config.get('productFileName');
    const filePath = join(outputDir, productFileName);
    
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Results file not found' });
    }
    
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (domain && domain !== 'all') {
      if (!fileData[domain]) {
        return reply.code(404).send({ error: `No results found for domain: ${domain}` });
      }
      
      const csvContent = `URL\n${fileData[domain].productUrls.join('\n')}`;
      
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${domain}-product-links.csv"`);
      
      return reply.send(csvContent);
    } else {
      let csvContent = 'Domain,URL\n';
      
      Object.entries(fileData).forEach(([domain, data]) => {
        if (data.productUrls && data.productUrls.length > 0) {
          data.productUrls.forEach(url => {
            csvContent += `${domain},${url}\n`;
          });
        }
      });
      
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="all-product-links.csv"');
      
      return reply.send(csvContent);
    }
  } catch (error) {
    console.error('Download error:', error);
    return reply.code(500).send({ error: 'Error processing download request' });
  }
});

await fastify.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/'
});

fastify.ready(err => {
  if (err) throw err;

  fastify.io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let activeCrawling = false;
    let crawlProcess = null;
    
    socket.crawlerDomains = new Set();

    socket.on('startCrawl', async (data) => {
      if (activeCrawling) {
        socket.emit('crawlError', { message: 'A crawl is already in progress' });
        return;
      }

      console.log('Starting crawl with domains:', data.domains?.join(', '));
      activeCrawling = true;
      
      if (data.domains && Array.isArray(data.domains)) {
        data.domains.forEach(domain => socket.crawlerDomains.add(domain));
      }
      
      try {
        crawlProcess = startCrawling({
          domains: data.domains || [],
          options: data.options || {},
          onUpdate: (update) => {
            if (socket.connected) {
              if (update.domain && update.status && !update.type !== 'product') {
                const crawler = crawlProcess && crawlProcess.currentResults ? 
                  crawlProcess.currentResults[update.domain]?.length || 0 : 0;
                  
                update.productsFound = crawler;
              }
              socket.emit('crawlUpdate', update);
            }
          },
          onProgress: (progress) => {
            if (socket.connected) {
              socket.emit('crawlProgress', progress);
            }
          },
          onProductFound: (product) => {
            if (socket.connected) {
              socket.emit('productFound', product);
            }
          },
          onComplete: (results) => {
            if (socket.connected) {
              socket.emit('crawlComplete', results);
              socket.emit('downloadReady', { 
                ready: true, 
                message: 'Results are ready for download'
              });
            }
            activeCrawling = false;
            crawlProcess = null;
            socket.crawlerDomains.clear();
          },
          onError: (error) => {
            if (socket.connected) {
              socket.emit('crawlError', error);
            }
            activeCrawling = false;
            crawlProcess = null;
          }
        });
      } catch (error) {
        console.error('Error starting crawler:', error.message);
        socket.emit('crawlError', { message: error.message });
        activeCrawling = false;
        crawlProcess = null;
        socket.crawlerDomains.clear();
      }
    });

    socket.on('stopCrawl', async () => {
      if (activeCrawling) {
        console.log('Stop requested, terminating crawl processes...');
        socket.emit('crawlUpdate', { message: 'Stop requested, terminating crawl processes...', type: 'warning' });
        
        try {
          activeCrawling = false; 
          
          global.crawlCancelled = true;
          
          if (crawlProcess && typeof crawlProcess.stop === 'function') {
            try {
              await Promise.race([
                crawlProcess.stop(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stop timeout')), 3000))
              ]);
            } catch (stopError) {
              console.error('Error or timeout stopping crawler:', stopError);
            }
          }
          
          crawlProcess = null;
          
          socket.emit('crawlStopped');
          socket.emit('crawlUpdate', { message: 'Crawling stopped successfully', type: 'success' });
          
        } catch (error) {
          console.error('Failed to stop crawler:', error.message);
          socket.emit('crawlError', { message: `Error stopping crawl: ${error.message}` });
          
          socket.emit('crawlStopped');
        }
      } else {
        socket.emit('crawlStopped');
      }
    });

    socket.on('requestDownload', (data) => {
      const { domain } = data || {};
      socket.emit('downloadUrl', { 
        url: `/download?domain=${domain || 'all'}`
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      if (activeCrawling && crawlProcess && typeof crawlProcess.stop === 'function') {
        global.crawlCancelled = true;
        activeCrawling = false;
        
        try {
          console.log('Stopping crawler due to client disconnect');
          crawlProcess.stop().catch(err => console.error('Error stopping crawler on disconnect:', err));
        } catch (error) {
          console.error('Error during crawler cleanup on disconnect:', error);
        }
        
        crawlProcess = null;
      }
    });
  });
});

fastify.get('/', async (request, reply) => {
  return reply.sendFile('index.html');
});

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