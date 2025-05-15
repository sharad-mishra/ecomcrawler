const crawlerService = require('../services/crawler.service');
const { getNormalizedDomain } = require('../utils/url.utils');
const path = require('path');
const fs = require('fs');

/**
 * Start a crawl operation for a domain
 * @param {*} req - Request object with domain in the body
 * @param {*} res - Response object
 */
exports.crawl = async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        success: false,
        message: 'Domain is required'
      });
    }
    
    // Get socket ID if available for real-time updates
    const socketId = req.body.socketId || null;
    const io = req.app.get('io') || null;
    
    // Normalize domain to ensure consistent format
    const normalizedDomain = getNormalizedDomain(domain);
    
    // Start the crawl
    const result = await crawlerService.crawlDomain(normalizedDomain, socketId, io);
    
    return res.json({
      success: true,
      domain: normalizedDomain,
      result
    });
  } catch (error) {
    console.error('Error in crawl controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'An error occurred during crawling'
    });
  }
};

/**
 * Get crawler status (active crawlers)
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.getStatus = (req, res) => {
  try {
    const status = crawlerService.getCrawlerStatus();
    
    return res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error in getStatus controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving crawler status'
    });
  }
};

/**
 * Start a crawl with options
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.startCrawl = async (req, res) => {
  try {
    const { websites, crawlOptions } = req.body;
    
    if (!websites || !Array.isArray(websites) || websites.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one website is required'
      });
    }
    
    // Process simplified crawl options from frontend
    const options = {
      maxPages: parseInt(crawlOptions?.maxPages) || 500
    };
    
    // Get socket ID if available for real-time updates
    const socketId = req.body.socketId || null;
    const io = req.app.locals.io || null;
    
    let results;
    if (websites.length === 1) {
      // Single domain crawling
      results = [await crawlerService.crawlDomain(websites[0], options, socketId, io)];
    } else {
      // Multiple domains crawling
      results = await crawlerService.crawlMultipleDomains(websites, options, socketId, io);
    }
    
    return res.json({
      success: true,
      websites,
      options,
      results
    });
  } catch (error) {
    console.error('Error in startCrawl controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error starting crawl'
    });
  }
};

/**
 * Start crawling all supported e-commerce sites
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.startCrawlAll = async (req, res) => {
  try {
    // Define all supported websites
    const allWebsites = [
      'virgio.com',
      'westside.com',
      'tatacliq.com',
      'nykaafashion.com'
    ];
    
    // Get socket ID if available for real-time updates
    const socketId = req.body.socketId || null;
    const io = req.app.locals.io || null;
    
    // Start the crawl for all websites
    const results = await crawlerService.crawlMultipleDomains(allWebsites, socketId, io);
    
    // Create an "all sites" summary
    const allResults = {
      timestamp: new Date().toISOString(),
      domains: allWebsites,
      totalProducts: results.reduce((sum, r) => sum + (r.totalLinks || 0), 0)
    };
    
    return res.json({
      success: true,
      message: 'Crawling started for all supported websites',
      results: allResults
    });
  } catch (error) {
    console.error('Error in startCrawlAll controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error starting crawl for all sites'
    });
  }
};

/**
 * Get crawl results for domains
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.getResults = async (req, res) => {
  try {
    const domain = req.query.domain;
    
    // If domain is specified, get results for that domain only
    if (domain) {
      const results = crawlerService.getCrawlResults(domain);
      
      if (!results) {
        return res.status(404).json({
          success: false,
          message: `No results found for domain: ${domain}`
        });
      }
      
      return res.json({
        success: true,
        domain,
        results
      });
    }
    
    // Otherwise, get all results
    const allResults = crawlerService.getCrawlResults();
    
    return res.json({
      success: true,
      domains: Object.keys(allResults),
      results: allResults
    });
  } catch (error) {
    console.error('Error in getResults controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving crawl results'
    });
  }
};

/**
 * Download crawl results file
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.downloadResults = async (req, res) => {
  try {
    const { file } = req.query;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'File parameter is required'
      });
    }
    
    // Ensure file is from our output directory for security
    const outputDir = path.resolve(process.cwd(), 'crawled-data');
    const filePath = path.resolve(outputDir, path.basename(file));
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    return res.download(filePath);
  } catch (error) {
    console.error('Error in downloadResults controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error downloading results'
    });
  }
};

/**
 * Stop all active crawlers
 * @param {*} req - Request object
 * @param {*} res - Response object 
 */
exports.stopCrawlers = async (req, res) => {
  try {
    console.log('Stopping all crawlers...');
    
    const io = req.app.locals.io;
    const socketId = req.body.socketId;
    
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
    
    return res.json({
      success: true,
      message: result.message,
      savedResults: result.savedResults || []
    });
  } catch (error) {
    console.error('Error stopping crawlers:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error stopping crawlers'
    });
  }
};

/**
 * Stop a specific crawler
 * @param {*} req - Request object
 * @param {*} res - Response object
 */
exports.stopCrawler = async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        success: false,
        message: 'Domain is required'
      });
    }
    
    const result = await crawlerService.stopCrawler(domain);
    
    return res.json({
      success: true,
      domain,
      message: result.message
    });
  } catch (error) {
    console.error('Error stopping crawler:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error stopping crawler'
    });
  }
};