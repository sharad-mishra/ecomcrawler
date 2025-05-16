const fs = require('fs');
const path = require('path');
const config = require('config');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { isProductUrl, normalizeUrl, isSameDomain } = require('../utils/url.utils');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Track active crawlers
const activeCrawlers = new Map();
// Add heartbeat tracking for all crawlers
const crawlerHeartbeats = new Map();
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const MAX_MISSED_HEARTBEATS = 3; // Consider crawler dead after missing 3 heartbeats

// Start heartbeat monitoring for all crawlers
const heartbeatChecker = setInterval(() => {
  const now = Date.now();
  
  // Check each crawler's last heartbeat
  for (const [domain, crawler] of activeCrawlers.entries()) {
    const lastHeartbeat = crawlerHeartbeats.get(domain) || 0;
    
    // If crawler hasn't sent a heartbeat recently, force terminate it
    if (now - lastHeartbeat > (MAX_MISSED_HEARTBEATS * HEARTBEAT_INTERVAL)) {
      console.warn(`Crawler for ${domain} appears to be stalled, forcing termination`);
      stopCrawler(domain).catch(err => console.error(`Error force stopping crawler: ${err.message}`));
    }
  }
}, HEARTBEAT_INTERVAL);

// Ensure heartbeat checker is cleaned up on process exit
process.on('exit', () => {
  clearInterval(heartbeatChecker);
});

/**
 * Crawl a specific domain for product URLs
 */
async function crawlDomain(domain, options = {}, socketId = null, io = null) {
  const timestamp = Date.now();
  const domainConfig = getDomainConfig(domain);
  
  // Get settings from config with overrides from options
  const settings = {
    maxPages: options.maxPages || 500,
    indefiniteCrawling: options.indefiniteCrawling || false,
    navigationTimeout: domainConfig.navigationTimeout || 30000,
    waitUntil: domainConfig.waitUntil || 'domcontentloaded',
    ...options
  };

  // Initialize crawler statistics
  const crawlStats = {
    totalPages: 0,
    productsFound: 0,
    startTime: new Date(),
    endTime: null,
    durationSeconds: 0,
    crawlCompleted: false
  };

  // Set up browser
  const browser = await puppeteer.launch({
    headless: "new", 
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });
  
  const page = await browser.newPage();
  
  // Set up crawler state
  const visited = new Set();
  const queue = [];
  const productLinks = new Set();
  const failedUrls = new Set();
  
  // Create crawler object
  const crawler = {
    browser,
    page,
    domain,
    queue,
    visited,  // Important: add visited to the crawler object
    productLinks,
    failedUrls,
    crawlStats,
    settings,
    active: true,
    cancelRequested: false,
    socketId,
    io
  };
  
  // Register crawler and set initial heartbeat
  activeCrawlers.set(domain, crawler);
  crawlerHeartbeats.set(domain, Date.now());
  
  // Set up heartbeat update inside the crawling loop
  const heartbeatUpdater = setInterval(() => {
    // Only update heartbeat if crawler is still active
    if (activeCrawlers.has(domain) && !crawler.cancelRequested) {
      crawlerHeartbeats.set(domain, Date.now());
    } else {
      clearInterval(heartbeatUpdater);
    }
  }, HEARTBEAT_INTERVAL / 2);
  
  // Register socket disconnect handler if socket exists
  if (io && socketId) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      // Set up one-time disconnect handler for this specific crawler
      const disconnectHandler = () => {
        console.log(`Socket ${socketId} disconnected, stopping crawler for ${domain}`);
        stopCrawler(domain).catch(err => console.error(`Error stopping crawler on disconnect: ${err.message}`));
        socket.removeListener('disconnect', disconnectHandler);
      };
      
      socket.once('disconnect', disconnectHandler);
    }
  }
  
  // Determine starting points - use category URLs for TataCliq
  if (domainConfig.categoryUrls && domainConfig.categoryUrls.length > 0) {
    // Use category URLs as starting points for TataCliq
    domainConfig.categoryUrls.forEach(url => crawler.queue.push(url));
    console.log(`Starting with ${domainConfig.categoryUrls.length} category URLs for ${domain}`);
  } else {
    // Default to domain root
    crawler.queue.push(domain);
  }
  
  // Emit initial crawler info if Socket.IO is available
  if (io && socketId) {
    io.to(socketId).emit('crawl_start', { 
      domain, 
      status: 'started',
      queueSize: crawler.queue.length
    });
  }
  
  try {
    // Main crawling loop
    while (queue.length > 0 && crawler.active && !crawler.cancelRequested) {
      // CHECK CANCELLATION FIRST before any processing
      if (crawler.cancelRequested) {
        console.log(`Crawler for ${domain} was cancelled - exiting crawl loop`);
        break;
      }
      
      // Update heartbeat at the beginning of each loop iteration
      crawlerHeartbeats.set(domain, Date.now());
      
      // Check if we've reached the page limit
      if (!settings.indefiniteCrawling && crawlStats.totalPages >= settings.maxPages) {
        console.log(`[${domain}] Reached max pages limit (${settings.maxPages})`);
        break;
      }
      
      const url = crawler.queue.shift();
      
      // Skip if already visited
      if (crawler.visited.has(normalizeUrl(url))) {
        continue;
      }
      
      // Mark as visited
      crawler.visited.add(normalizeUrl(url));
      crawlStats.totalPages++;
      
      // Log progress
      console.log(`[${crawlStats.totalPages}/${settings.maxPages}] Visiting: ${url}`);
      
      // Update UI if Socket.IO is available
      if (io && socketId) {
        io.to(socketId).emit('progress_update', {
          domain,
          url,
          pagesVisited: crawlStats.totalPages,
          productsFound: crawler.productLinks.size,
          queueSize: crawler.queue.length
        });
      }
      
      try {
        // Double-check cancellation again before navigation
        if (crawler.cancelRequested) {
          console.log(`Crawler for ${domain} was cancelled before navigation`);
          break;
        }
        
        // Navigate to the page with proper timeout
        await crawler.page.goto(url, { 
          waitUntil: settings.waitUntil || 'networkidle2',
          timeout: settings.navigationTimeout || 60000
        });
        
        // Check cancellation a third time after navigation
        if (crawler.cancelRequested) {
          console.log(`Crawler for ${domain} was cancelled after navigation`);
          break;
        }
        
        // First extract links from the current page before clicking "Show More"
        const initialLinks = await extractLinks(crawler.page, domain);
        
        // Process initial links before clicking "Show More"
        const newProductsFromInitialScan = processLinks(initialLinks, domain, crawler.visited, crawler.queue, crawler.productLinks);
        if (newProductsFromInitialScan.length > 0) {
          console.log(`Found ${newProductsFromInitialScan.length} product links on initial scan`);
          
          // Update UI with new products if Socket.IO is available
          if (io && socketId) {
            for (const productUrl of newProductsFromInitialScan) {
              io.to(socketId).emit('product_found', {
                domain,
                url: productUrl,
                count: crawler.productLinks.size
              });
            }
          }
        }
        
        // For TataCliq, handle "Show More Products" button
        if (domain.includes('tatacliq.com') && domainConfig.loadButtonClassName) {
          let buttonClicked = false;
          let clickAttempts = 0;
          const maxClickAttempts = 10;
          
          // Try to click "Show More Products" button multiple times
          while (clickAttempts < maxClickAttempts) {
            try {
              // Check if button exists and is visible
              const buttonVisible = await crawler.page.evaluate((selector, buttonText) => {
                const buttons = Array.from(document.querySelectorAll(selector));
                const button = buttons.find(b => b.innerText.includes(buttonText));
                
                if (button && button.offsetParent !== null) {
                  // Scroll button into view
                  button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return true;
                }
                return false;
              }, domainConfig.loadButtonClassName, "Show More Products");
              
              if (!buttonVisible) break;
              
              // Click the button
              console.log(`Clicking "Show More Products" button (attempt ${clickAttempts + 1})`);
              await crawler.page.click(domainConfig.loadButtonClassName);
              buttonClicked = true;
              clickAttempts++;
              
              // Wait for new content to load
              await crawler.page.waitForTimeout(2000);
              
              // Extract and process new links after each click
              if (buttonClicked) {
                const newLinks = await extractLinks(crawler.page, domain);
                const newProducts = processLinks(newLinks, domain, crawler.visited, crawler.queue, crawler.productLinks);
                
                if (newProducts.length > 0) {
                  console.log(`Found ${newProducts.length} new products after clicking "Show More"`);
                  
                  // Update UI with new products
                  if (io && socketId) {
                    for (const productUrl of newProducts) {
                      io.to(socketId).emit('product_found', {
                        domain,
                        url: productUrl,
                        count: crawler.productLinks.size
                      });
                    }
                  }
                }
              }
            } catch (err) {
              console.log(`Error clicking button: ${err.message}`);
              break;
            }
          }
        }
      } catch (err) {
        // Check cancellation on error too
        if (crawler.cancelRequested) {
          console.log(`Crawler for ${domain} was cancelled during error handling`);
          break;
        }
        
        console.error(`Error crawling ${url}: ${err.message}`);
        failedUrls.add(url);
      }
    }
    
    // Save results
    crawlStats.endTime = new Date();
    crawlStats.durationSeconds = (crawlStats.endTime - crawlStats.startTime) / 1000;
    crawlStats.crawlCompleted = !crawler.cancelRequested;
    crawlStats.productsFound = crawler.productLinks.size;
    
    const result = {
      domain,
      products: Array.from(crawler.productLinks),
      totalLinks: crawler.productLinks.size,
      stats: crawlStats,
      timestamp: new Date().toISOString()
    };
    
    // Save to file with proper directory handling
    const outputDir = path.resolve(process.cwd(), config.get('outputDir'));
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const sanitizedDomain = domain.replace(/https?:\/\//g, '').replace(/\W+/g, '_');
    const outputPath = path.join(outputDir, `${sanitizedDomain}-${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    // Emit completion event if Socket.IO is available
    if (io && socketId) {
      io.to(socketId).emit('crawl_complete', {
        domain,
        productCount: crawler.productLinks.size,
        filePath: outputPath
      });
    }
    
    console.log(`Crawling complete for ${domain}. Found ${crawler.productLinks.size} products.`);
    return result;
  } catch (err) {
    console.error(`Crawler error for ${domain}:`, err);
    throw err;
  } finally {
    // Clean up
    crawler.active = false;
    clearInterval(heartbeatUpdater);
    crawlerHeartbeats.delete(domain);
    
    // Only delete from activeCrawlers if we weren't already cancelled
    // This prevents race conditions with the stopCrawler function
    if (!crawler.cancelRequested) {
      activeCrawlers.delete(domain);
    }
    
    try {
      await browser.close();
    } catch (err) {
      console.error('Error closing browser:', err);
    }
  }
}

/**
 * Helper function to extract links from a page
 */
async function extractLinks(page, domain) {
  // Extract all links on the page using a selector that's specific to TataCliq product cards
  const links = await page.evaluate(() => {
    // Get general links from the page
    const allLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(href => href && href.startsWith('http'));
    
    // Get TataCliq product links (which might be in product cards)
    const productCards = Array.from(document.querySelectorAll('.ProductModule__base a, .product-list a, .product-grid a, a[href*="/p-mp"]'));
    const productLinks = productCards.map(a => a.href).filter(href => href && href.startsWith('http'));
    
    // Combine and return unique links
    return [...new Set([...allLinks, ...productLinks])];
  });
  
  console.log(`Found ${links.length} links on ${await page.url()}`);
  return links;
}

/**
 * Helper function to process links
 * Returns array of new product links
 */
function processLinks(links, domain, visited, queue, productLinks) {
  const newProductLinks = [];
  
  for (const link of links) {
    // Skip if not on the same domain
    if (!isSameDomain(link, domain)) {
      continue;
    }
    
    const normalizedLink = normalizeUrl(link);
    
    // Check if it's a product URL
    const isTataCliqProduct = domain.includes('tatacliq.com') && 
      (normalizedLink.includes('/p-mp') || normalizedLink.match(/\/[^\/]+\/p-mp/));
    
    if (isProductUrl(normalizedLink) || isTataCliqProduct) {
      if (!productLinks.has(normalizedLink)) {
        productLinks.add(normalizedLink);
        newProductLinks.push(normalizedLink);
        console.log(`Found product link: ${normalizedLink}`);
      }
    } 
    // Add to queue if not visited and not a product
    else if (!visited.has(normalizedLink)) {
      queue.push(normalizedLink);
    }
  }
  
  return newProductLinks;
}

/**
 * Get configuration for a specific domain
 */
function getDomainConfig(domain) {
  const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  const domainsConfig = config.get('domainsConfig');
  
  const domainConfig = domainsConfig.find(conf => {
    const configDomain = conf.domainName.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    return configDomain.includes(normalizedDomain) || normalizedDomain.includes(configDomain);
  });
  
  return domainConfig || {};
}

/**
 * Stop a crawler for a specific domain
 */
async function stopCrawler(domain) {
  const crawler = activeCrawlers.get(domain);
  
  if (!crawler) {
    return { message: `No active crawler for ${domain}` };
  }
  
  console.log(`Force stopping crawler for ${domain}`);
  
  // Set flags first to prevent further processing
  crawler.cancelRequested = true;
  crawler.active = false;
  
  // Empty the queue immediately
  if (crawler.queue) crawler.queue.length = 0;
  
  // Remove heartbeat monitoring
  crawlerHeartbeats.delete(domain);
  
  // Create stop result FIRST to save progress before potentially crashing
  const result = {
    domain,
    products: crawler.productLinks ? Array.from(crawler.productLinks) : [],
    count: crawler.productLinks ? crawler.productLinks.size : 0,
    timestamp: new Date().toISOString(),
    status: 'stopped'
  };
  
  try {
    // If this crawler has a socket, notify it that stopping is in progress
    if (crawler.io && crawler.socketId) {
      try {
        crawler.io.to(crawler.socketId).emit('crawl_stopping', {
          domain,
          message: 'Crawler is being terminated'
        });
      } catch (err) {
        console.error(`Error sending stop notification: ${err.message}`);
      }
    }
    
    // Use a multiple-strategy approach to kill the browser
    if (crawler.browser) {
      // 1. Try normal browser close with short timeout first
      try {
        const closePromise = crawler.browser.close();
        await Promise.race([
          closePromise,
          new Promise(r => setTimeout(r, 500))
        ]);
      } catch (err) {
        console.warn(`Normal browser close failed: ${err.message}`);
      }
      
      // 2. If browser has process, try to kill it directly
      try {
        const browserProcess = crawler.browser.process();
        if (browserProcess && browserProcess.pid) {
          const pid = browserProcess.pid;
          console.log(`Force killing browser process PID: ${pid}`);
          
          if (process.platform === 'win32') {
            try {
              exec(`taskkill /pid ${pid} /T /F`, (error) => {
                if (error) {
                  console.error(`Process kill error: ${error.message}`);
                }
              });
            } catch (killErr) {
              console.error(`Failed to execute taskkill: ${killErr.message}`);
            }
          } else {
            try {
              process.kill(pid, 'SIGKILL');
            } catch (killErr) {
              console.error(`Failed to kill process: ${killErr.message}`);
            }
          }
        }
      } catch (err) {
        console.error(`Error accessing browser process: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`Error during stopCrawler: ${err.message}`);
  } finally {
    // Always make sure we remove from active crawlers
    activeCrawlers.delete(domain);
    
    // Always notify the client if possible
    if (crawler.io && crawler.socketId) {
      crawler.io.to(crawler.socketId).emit('crawl_forcibly_stopped', {
        domain,
        message: 'Crawler has been forcibly terminated',
        productCount: result.count
      });
    }
  }
  
  return { 
    message: `Stopped crawler for ${domain}`, 
    result 
  };
}

/**
 * Stop all active crawlers
 */
async function stopAllCrawlers() {
  const domains = Array.from(activeCrawlers.keys());
  const savedResults = [];
  
  // Stop all crawlers in parallel for faster stopping
  const stopPromises = domains.map(async domain => {
    try {
      const result = await stopCrawler(domain);
      if (result && result.result) {
        savedResults.push(result.result);
      }
    } catch (err) {
      console.error(`Error stopping crawler for ${domain}:`, err.message);
    }
  });
  
  // Wait for all stops to complete
  await Promise.all(stopPromises);
  
  return savedResults;
}

/**
 * Get active crawler information
 */
function getActiveCrawler(domain) {
  return activeCrawlers.get(domain) || null;
}

/**
 * Get crawl results for a domain
 */
function getCrawlResults(domain) {
  const crawler = activeCrawlers.get(domain);
  if (crawler && crawler.productLinks) {
    return Array.from(crawler.productLinks);
  }
  return [];
}

// Create CommonJS exports that handle both direct and destructured imports
module.exports = {
  crawlDomain,
  stopCrawler,
  stopAllCrawlers,
  getActiveCrawler,
  getCrawlResults
};

// Export default for ESM compatibility
module.exports.default = module.exports;