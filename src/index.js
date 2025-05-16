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

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get output directory from config
const outputDir = config.get('outputDir');

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
  },
  pingTimeout: 10000,     // Increase ping timeout for reliability
  pingInterval: 5000,     // More frequent pings to detect disconnection faster
  transports: ['websocket', 'polling']  // Prefer websocket but fallback to polling
});

// Fix the download endpoint
fastify.get('/download', async (request, reply) => {
  try {
    const { domain } = request.query;
    
    if (!domain) {
      return reply.code(400).send({ error: 'Domain parameter is required' });
    }
    
    const productFileName = config.get('productFileName');
    const filePath = join(outputDir, productFileName);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Results file not found' });
    }
    
    // Read and parse the product links file
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // If domain is specified, only return that domain's results
    if (domain && domain !== 'all') {
      if (!fileData[domain]) {
        return reply.code(404).send({ error: `No results found for domain: ${domain}` });
      }
      
      // Create a CSV string with the results
      const csvContent = `URL\n${fileData[domain].productUrls.join('\n')}`;
      
      // Set headers for CSV download
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${domain}-product-links.csv"`);
      
      return reply.send(csvContent);
    } else {
      // Create a CSV with all domains
      let csvContent = 'Domain,URL\n';
      
      Object.entries(fileData).forEach(([domain, data]) => {
        if (data.productUrls && data.productUrls.length > 0) {
          data.productUrls.forEach(url => {
            csvContent += `${domain},${url}\n`;
          });
        }
      });
      
      // Set headers for CSV download
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="all-product-links.csv"');
      
      return reply.send(csvContent);
    }
  } catch (error) {
    console.error('Download error:', error);
    return reply.code(500).send({ error: 'Error processing download request' });
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
    
    // Track crawler association with socket
    socket.crawlerDomains = new Set();

    // Handle start crawl event
    socket.on('startCrawl', async (data) => {
      if (activeCrawling) {
        socket.emit('crawlError', { message: 'A crawl is already in progress' });
        return;
      }

      console.log('Starting crawl with domains:', data.domains?.join(', '));
      activeCrawling = true;
      
      // Track active domains for this socket
      if (data.domains && Array.isArray(data.domains)) {
        data.domains.forEach(domain => socket.crawlerDomains.add(domain));
      }
      
      try {
        // Start the crawling process with additional onProductFound callback
        crawlProcess = startCrawling({
          domains: data.domains || [],
          options: data.options || {},
          onUpdate: (update) => {
            // Only send updates if socket is still connected
            if (socket.connected) {
              // Add additional progress info to regular updates when available
              if (update.domain && update.status && !update.type !== 'product') {
                // Try to extract progress data from crawler
                const crawler = crawlProcess && crawlProcess.currentResults ? 
                  crawlProcess.currentResults[update.domain]?.length || 0 : 0;
                  
                // Add progress data if available
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
            // Only send updates if socket is still connected
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

    // Handle stop crawl event
    socket.on('stopCrawl', async () => {
      if (activeCrawling) {
        console.log('Stop requested, terminating crawl processes...');
        socket.emit('crawlUpdate', { message: 'Stop requested, terminating crawl processes...', type: 'warning' });
        
        try {
          // Set this flag first to prevent more updates
          activeCrawling = false; 
          
          // Set global cancellation flag to terminate crawling loops
          global.crawlCancelled = true;
          
          // Directly stop the crawlProcess without trying to import service
          if (crawlProcess && typeof crawlProcess.stop === 'function') {
            try {
              await Promise.race([
                crawlProcess.stop(),
                // Timeout after 3 seconds to prevent hanging
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stop timeout')), 3000))
              ]);
            } catch (stopError) {
              console.error('Error or timeout stopping crawler:', stopError);
            }
          }
          
          // Force cleanup
          crawlProcess = null;
          
          socket.emit('crawlStopped');
          socket.emit('crawlUpdate', { message: 'Crawling stopped successfully', type: 'success' });
          
        } catch (error) {
          console.error('Failed to stop crawler:', error.message);
          socket.emit('crawlError', { message: `Error stopping crawl: ${error.message}` });
          
          // Still notify the client that crawling was stopped
          socket.emit('crawlStopped');
        }
      } else {
        socket.emit('crawlStopped');
      }
    });

    // Add a new handler for download requests via socket
    socket.on('requestDownload', (data) => {
      const { domain } = data || {};
      // Inform the client about the download URL
      socket.emit('downloadUrl', { 
        url: `/download?domain=${domain || 'all'}`
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Stop crawling without using require
      if (activeCrawling && crawlProcess && typeof crawlProcess.stop === 'function') {
        global.crawlCancelled = true; // Ensure global flag is set
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