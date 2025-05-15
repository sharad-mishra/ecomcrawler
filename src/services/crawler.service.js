const BaseCrawler = require('../crawlers/base.crawler');
const fs = require('fs');
const path = require('path');
const config = require('config');
const { getNormalizedDomain } = require('../utils/url.utils');

// Active crawlers and results
let crawlers = {};
let crawlResults = {};

// Add a global stop flag at the top of the file
let isGlobalStopRequested = false;

/**
 * Crawl a domain
 * @param {string} domain - The domain to crawl
 * @param {object} options - Crawling options (primarily maxPages)
 * @param {string|null} socketId - Socket ID for real-time updates (optional)
 * @param {object|null} io - Socket.io instance (optional)
 * @returns {Promise<object>} - Crawl results
 */
async function crawlDomain(domain, options = {}, socketId = null, io = null) {
  try {
    const normalizedDomain = getNormalizedDomain(domain);
    console.log(`Starting crawl for ${normalizedDomain}`);
    
    if (crawlers[normalizedDomain]) {
      console.log(`Crawler already running for ${normalizedDomain}`);
      return { 
        status: 'already_running', 
        message: `Crawler already running for ${normalizedDomain}` 
      };
    }
    
    // Create crawler with updated options
    const crawler = new BaseCrawler(normalizedDomain, {
      maxPages: options.maxPages || 500,
      indefiniteCrawling: options.indefiniteCrawling || false
    });
    
    // Set event emitter if socket info provided
    if (socketId && io) {
      crawler.setEventEmitter(io, socketId);
    }
    
    // Initialize browser
    await crawler.init();
    
    // Track active crawlers
    crawlers[normalizedDomain] = crawler;
    
    // Start crawling
    const resultsFile = await crawler.crawl();
    
    // Store results
    if (resultsFile) {
      try {
        const resultData = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
        crawlResults[normalizedDomain] = resultData;
      } catch (err) {
        console.error(`Error reading results file: ${err.message}`);
      }
    }
    
    // Clean up after crawl
    delete crawlers[normalizedDomain];
    await crawler.close();
    
    console.log(`Completed crawl for ${normalizedDomain}, found ${crawlResults[normalizedDomain]?.totalLinks || 0} product links`);
    
    return {
      domain: normalizedDomain,
      links: crawlResults[normalizedDomain]?.products || [], 
      totalLinks: crawlResults[normalizedDomain]?.totalLinks || 0,
      crawlId: Date.now().toString(),
      resultsFile
    };
  } catch (error) {
    console.error(`Error crawling ${domain}:`, error);
    
    // Clean up in case of error
    if (crawlers[domain]) {
      try {
        await crawlers[domain].close();
      } catch (closeError) {
        console.error(`Error closing crawler for ${domain}:`, closeError);
      }
      delete crawlers[domain];
    }
    
    throw error;
  }
}

/**
 * Crawl multiple domains sequentially
 * @param {string[]} domains - Array of domains to crawl
 * @param {object} options - Crawling options
 * @param {string|null} socketId - Socket ID for real-time updates
 * @param {object|null} io - Socket.io instance
 * @returns {Promise<object[]>} - Array of crawl results
 */
async function crawlMultipleDomains(domains, options = {}, socketId = null, io = null) {
  try {
    console.log(`Starting crawl for ${domains.length} domains`);
    isGlobalStopRequested = false;
    
    const results = [];
    
    // Process domains sequentially
    for (const domain of domains) {
      // Check if a global stop was requested
      if (isGlobalStopRequested) {
        console.log('Global stop requested, skipping remaining domains');
        break;
      }
      
      const result = await crawlDomain(domain, options, socketId, io);
      results.push(result);
    }
    
    console.log(`Completed crawling ${results.length} domains`);
    return results;
  } catch (error) {
    console.error('Error in crawlMultipleDomains:', error);
    throw error;
  }
}

/**
 * Get completed crawl results
 * @param {string|null} domain - Optional domain to filter results
 * @returns {object} - Crawl results
 */
function getCrawlResults(domain = null) {
  if (domain) {
    const normalizedDomain = getNormalizedDomain(domain);
    return crawlResults[normalizedDomain] || null;
  }
  
  return crawlResults;
}

/**
 * Get status of active crawlers
 * @returns {object} - Status object with active crawlers
 */
function getCrawlerStatus() {
  return {
    activeCrawlers: Object.keys(crawlers),
    count: Object.keys(crawlers).length,
    activeSince: Object.entries(crawlers).reduce((acc, [domain, crawler]) => {
      acc[domain] = crawler.crawlStats.startTime;
      return acc;
    }, {})
  };
}

/**
 * Stop all active crawlers
 * @returns {Promise<object>} - Result of the operation
 */
async function stopAllCrawlers() {
  // Set global stop flag to prevent new domains from being processed
  isGlobalStopRequested = true;
  
  const domains = Object.keys(crawlers);
  
  if (domains.length === 0) {
    return { message: 'No active crawlers to stop' };
  }
  
  console.log(`Stopping ${domains.length} active crawlers...`);
  const savedResults = [];
  
  for (const domain of domains) {
    try {
      // First set the stopRequested flag
      if (crawlers[domain]) {
        crawlers[domain].stopRequested = true;
        console.log(`Set stopRequested flag for ${domain}`);
      }
    } catch (error) {
      console.error(`Error setting stop flag for ${domain}:`, error);
    }
  }
  
  // Wait a brief moment for any in-progress operations to recognize the stop flag
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Now close browsers and save results
  for (const domain of domains) {
    try {
      // Save results before closing the browser
      let resultsFile = null;
      if (crawlers[domain]) {
        resultsFile = await crawlers[domain].saveResults();
        savedResults.push({ domain, resultsFile });
      
        // Close browser and clean up
        await crawlers[domain].close();
        delete crawlers[domain];
        console.log(`Stopped crawler for ${domain}`);
      }
    } catch (error) {
      console.error(`Error stopping crawler for ${domain}:`, error);
    }
  }
  
  return { 
    message: `Stopped ${domains.length} crawlers`,
    savedResults 
  };
}

/**
 * Stop a specific crawler
 * @param {string} domain - Domain to stop crawling
 * @returns {Promise<object>} - Result of the operation
 */
async function stopCrawler(domain) {
  const normalizedDomain = getNormalizedDomain(domain);
  
  if (!crawlers[normalizedDomain]) {
    return { status: 'not_running', message: `No active crawler for ${normalizedDomain}` };
  }
  
  try {
    // Save results before stopping
    const resultsFile = await crawlers[normalizedDomain].saveResults();
    
    // Close and clean up
    await crawlers[normalizedDomain].close();
    delete crawlers[normalizedDomain];
    console.log(`Stopped crawler for ${normalizedDomain}`);
    
    return { 
      status: 'stopped', 
      message: `Stopped crawler for ${normalizedDomain}`,
      resultsFile
    };
  } catch (error) {
    console.error(`Error stopping crawler for ${normalizedDomain}:`, error);
    throw error;
  }
}

module.exports = {
  crawlDomain,
  crawlMultipleDomains,
  getCrawlResults,
  getCrawlerStatus,
  stopAllCrawlers,
  stopCrawler,
  crawlers
};