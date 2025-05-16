const crawlerService = require('../services/crawler.service');
const fs = require('fs');
const path = require('path');
const config = require('config');

/**
 * Crawler routes plugin
 */
async function routes(fastify, options) {
  // Start crawling specific website(s)
  fastify.post('/api/crawler/start', async (request, reply) => {
    const { domain, websites, options = {}, crawlOptions = {}, socketId } = request.body || {};
    
    // Handle both single domain and multiple websites
    let sitesToCrawl = [];
    if (domain) {
      sitesToCrawl.push(domain);
    } else if (websites && Array.isArray(websites)) {
      sitesToCrawl = websites;
    }
    
    if (sitesToCrawl.length === 0) {
      return reply.code(400).send({ success: false, error: 'Domain or websites are required' });
    }
    
    // Merge options objects (support both formats)
    const mergedOptions = {
      ...options,
      ...crawlOptions
    };
    
    try {
      // Start the crawl in the background for each site
      for (const site of sitesToCrawl) {
        crawlerService.crawlDomain(site, mergedOptions, socketId, fastify.io)
          .catch(err => fastify.log.error(`Error crawling ${site}: ${err.message}`));
      }
      
      return {
        success: true,
        message: `Crawl started for ${sitesToCrawl.join(', ')}`
      };
    } catch (error) {
      fastify.log.error(`Failed to start crawl: ${error.message}`);
      return reply.code(500).send({ success: false, error: error.message });
    }
  });
  
  // Start crawling all configured sites
  fastify.post('/api/crawler/start-all', async (request, reply) => {
    try {
      const { socketId } = request.body || {};
      const domainsConfig = config.get('domainsConfig');
      const sitesToCrawl = domainsConfig.map(conf => conf.domainName);
      
      // Start the crawl in the background for each site
      for (const site of sitesToCrawl) {
        crawlerService.crawlDomain(site, {}, socketId, fastify.io)
          .catch(err => fastify.log.error(`Error crawling ${site}: ${err.message}`));
      }
      
      return {
        success: true,
        message: `Crawl started for all ${sitesToCrawl.length} configured sites`
      };
    } catch (error) {
      fastify.log.error(`Failed to start all crawls: ${error.message}`);
      return reply.code(500).send({ success: false, error: error.message });
    }
  });
  
  // Get crawler status
  fastify.get('/api/crawler/status/:domain', async (request, reply) => {
    const { domain } = request.params;
    
    if (!domain) {
      return reply.code(400).send({ success: false, error: 'Domain parameter is required' });
    }
    
    const crawler = crawlerService.getActiveCrawler(domain);
    if (!crawler) {
      return {
        active: false,
        stats: {
          pagesVisited: 0,
          productsFound: 0,
          queueSize: 0
        }
      };
    }
    
    return {
      active: true,
      stats: {
        pagesVisited: crawler.crawlStats.totalPages,
        productsFound: crawler.productLinks.size,
        queueSize: crawler.queue.length,
        elapsedSeconds: Math.floor((new Date() - crawler.crawlStats.startTime) / 1000)
      }
    };
  });
  
  // Get live product links directly from active crawler
  fastify.get('/api/crawler/live-products', async (request, reply) => {
    const { domain } = request.query;
    
    if (!domain) {
      return reply.code(400).send({ success: false, error: 'Domain parameter is required' });
    }
    
    const crawler = crawlerService.getActiveCrawler(domain);
    
    if (!crawler || !crawler.productLinks) {
      return {
        success: true,
        products: []
      };
    }
    
    return {
      success: true,
      products: Array.from(crawler.productLinks),
      count: crawler.productLinks.size
    };
  });
  
  // Get crawl results
  fastify.get('/api/crawler/results', async (request, reply) => {
    const { domain } = request.query;
    
    if (!domain) {
      return reply.code(400).send({ success: false, error: 'Domain parameter is required' });
    }
    
    // First try to get results from active crawler
    const activeCrawlerResults = crawlerService.getCrawlResults(domain);
    
    if (activeCrawlerResults) {
      return { success: true, results: activeCrawlerResults };
    }
    
    // If no active crawler, check saved results
    try {
      const outputDir = path.resolve(process.cwd(), config.get('outputDir'));
      const sanitizedDomain = domain.replace(/https?:\/\//g, '').replace(/\W+/g, '_');
      
      // Look for the most recent file for this domain
      const files = fs.readdirSync(outputDir).filter(
        file => file.startsWith(sanitizedDomain) && file.endsWith('.json')
      ).sort().reverse();
      
      if (files.length > 0) {
        const latestFile = files[0];
        const filePath = path.join(outputDir, latestFile);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const results = JSON.parse(fileContent);
        
        return { success: true, results, filePath: latestFile };
      }
    } catch (err) {
      fastify.log.error(`Error reading saved results: ${err.message}`);
    }
    
    return {
      success: true,
      results: {
        domain,
        products: [],
        stats: { crawling: false, pagesVisited: 0, productsFound: 0 }
      }
    };
  });
  
  // Stop crawling
  fastify.post('/api/crawler/stop', async (request, reply) => {
    const { domain } = request.body || {};
    
    let result;
    if (domain) {
      result = await crawlerService.stopCrawler(domain);
    } else {
      result = await crawlerService.stopAllCrawlers();
    }
    
    return { 
      success: true, 
      message: result.message
    };
  });
  
  // Download results file
  fastify.get('/api/crawler/download', async (request, reply) => {
    const { file } = request.query;
    
    if (!file) {
      return reply.code(400).send({ success: false, error: 'File parameter is required' });
    }
    
    // Security: Ensure the file is from our output directory and use basename
    const outputDir = path.resolve(process.cwd(), config.get('outputDir'));
    const filePath = path.join(outputDir, path.basename(file));
    
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'Results file not found' });
    }
    
    return reply.sendFile(path.basename(filePath), outputDir);
  });
}

module.exports = routes;
