const crawlerService = require('../services/crawler.service');
const { getNormalizedDomain } = require('../utils/url.utils');
const path = require('path');
const fs = require('fs');
const config = require('config');

// Update controllers to use Fastify's request/reply pattern

/**
 * Start a crawl operation for a domain
 */
exports.crawl = async (request, reply) => {
  try {
    const { domain } = request.body;
    
    if (!domain) {
      return reply.badRequest('Domain is required');
    }
    
    // Get socket ID if available for real-time updates
    const socketId = request.body.socketId || null;
    const io = request.server.io;
    
    // Normalize domain to ensure consistent format
    const normalizedDomain = getNormalizedDomain(domain);
    
    // Start the crawl
    const result = await crawlerService.crawlDomain(normalizedDomain, socketId, io);
    
    return { success: true, domain: normalizedDomain, result };
  } catch (error) {
    request.log.error('Error in crawl controller:', error);
    return reply.internalServerError(error.message || 'An error occurred during crawling');
  }
};

/**
 * Get crawler status (active crawlers)
 */
exports.getStatus = async (request, reply) => {
  try {
    const status = crawlerService.getCrawlerStatus();
    
    return { success: true, status };
  } catch (error) {
    request.log.error('Error in getStatus controller:', error);
    return reply.internalServerError(error.message || 'Error retrieving crawler status');
  }
};

/**
 * Start a crawl with options
 */
exports.startCrawl = async (request, reply) => {
  try {
    const { websites, crawlOptions } = request.body;
    
    if (!websites || !Array.isArray(websites) || websites.length === 0) {
      return reply.badRequest('At least one website is required');
    }
    
    // Process crawl options from frontend, supporting indefinite crawling
    const options = {
      maxPages: parseInt(crawlOptions?.maxPages) || 500,
      indefiniteCrawling: crawlOptions?.indefiniteCrawling === true
    };
    
    // Get socket ID if available for real-time updates
    const socketId = request.body.socketId || null;
    const io = request.server.io;
    
    let results;
    if (websites.length === 1) {
      // Single domain crawling
      results = [await crawlerService.crawlDomain(websites[0], options, socketId, io)];
    } else {
      // Multiple domains crawling
      results = await crawlerService.crawlMultipleDomains(websites, options, socketId, io);
    }
    
    return { success: true, websites, options, results };
  } catch (error) {
    request.log.error('Error in startCrawl controller:', error);
    return reply.internalServerError(error.message || 'Error starting crawl');
  }
};

/**
 * Start crawling all supported e-commerce sites
 */
exports.startCrawlAll = async (request, reply) => {
  try {
    // Define all supported websites
    const allWebsites = [
      'virgio.com',
      'westside.com',
      'tatacliq.com',
      'nykaafashion.com'
    ];
    
    // Get socket ID if available for real-time updates
    const socketId = request.body.socketId || null;
    const io = request.server.io;
    
    // Start the crawl for all websites
    const results = await crawlerService.crawlMultipleDomains(allWebsites, {}, socketId, io);
    
    // Create an "all sites" summary
    const allResults = {
      timestamp: new Date().toISOString(),
      domains: allWebsites,
      totalProducts: results.reduce((sum, r) => sum + (r.totalLinks || 0), 0)
    };
    
    return {
      success: true,
      message: 'Crawling started for all supported websites',
      results: allResults
    };
  } catch (error) {
    request.log.error('Error in startCrawlAll controller:', error);
    return reply.internalServerError(error.message || 'Error starting crawl for all sites');
  }
};

/**
 * Get crawl results for domains
 */
exports.getResults = async (request, reply) => {
  try {
    const domain = request.query.domain;
    
    // If domain is specified, get results for that domain only
    if (domain) {
      const results = crawlerService.getCrawlResults(domain);
      
      if (!results) {
        return reply.notFound(`No results found for domain: ${domain}`);
      }
      
      return { success: true, domain, results };
    }
    
    // Otherwise, get all results
    const allResults = crawlerService.getCrawlResults();
    
    return {
      success: true,
      domains: Object.keys(allResults),
      results: allResults
    };
  } catch (error) {
    request.log.error('Error in getResults controller:', error);
    return reply.internalServerError(error.message || 'Error retrieving crawl results');
  }
};

/**
 * Download crawl results file
 */
exports.downloadResults = async (request, reply) => {
  try {
    const { file } = request.query;
    
    if (!file) {
      return reply.badRequest('File parameter is required');
    }
    
    // Ensure file is from our output directory for security
    const outputDir = path.resolve(process.cwd(), config.get('outputDir'));
    const filePath = path.resolve(outputDir, path.basename(file));
    
    if (!fs.existsSync(filePath)) {
      return reply.notFound('File not found');
    }
    
    return reply.sendFile(path.basename(filePath), outputDir);
  } catch (error) {
    request.log.error('Error in downloadResults controller:', error);
    return reply.internalServerError(error.message || 'Error downloading results');
  }
};

/**
 * Stop all active crawlers
 */
exports.stopCrawlers = async (request, reply) => {
  try {
    request.log.info('Stopping all crawlers...');
    
    const io = request.server.io;
    const socketId = request.body.socketId;
    
    // Notify frontend that stopping has started
    if (io && socketId) {
      io.to(socketId).emit('stop_initiated', {
        message: 'Stop request received, stopping all crawlers...'
      });
    }
    
    const result = await crawlerService.stopAllCrawlers();
    
    // If there were no active crawlers or no results saved, send a stop_complete event
    if (result.savedResults?.length === 0 || !result.savedResults) {
      if (io && socketId) {
        io.to(socketId).emit('stop_complete', {
          message: 'All crawlers stopped successfully'
        });
      }
    } else if (io && socketId && result.savedResults) {
      // For each saved result, emit a crawl_stopped event
      for (const { domain, resultsFile } of result.savedResults) {
        io.to(socketId).emit('crawl_stopped', {
          domain,
          filePath: resultsFile,
          message: 'Crawling stopped by user'
        });
      }
      
      // Also emit a final stop_complete event
      io.to(socketId).emit('stop_complete', {
        message: `Stopped ${result.savedResults.length} crawlers`
      });
    }
    
    return {
      success: true,
      message: result.message,
      savedResults: result.savedResults || []
    };
  } catch (error) {
    request.log.error('Error stopping crawlers:', error);
    return reply.internalServerError(error.message || 'Error stopping crawlers');
  }
};

/**
 * Stop a specific crawler
 */
exports.stopCrawler = async (request, reply) => {
  try {
    const { domain } = request.body;
    
    if (!domain) {
      return reply.badRequest('Domain is required');
    }
    
    const result = await crawlerService.stopCrawler(domain);
    
    return {
      success: true,
      domain,
      message: result.message
    };
  } catch (error) {
    request.log.error('Error stopping crawler:', error);
    return reply.internalServerError(error.message || 'Error stopping crawler');
  }
};