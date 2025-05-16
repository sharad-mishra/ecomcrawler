const fs = require('fs');
const path = require('path');
const config = require('config');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { isProductUrl, normalizeUrl, isSameDomain } = require('../utils/url.utils');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Track active crawlers
const activeCrawlers = new Map();

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
  
  // Configure page
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  
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
    productLinks,
    failedUrls,
    crawlStats,
    settings,
    active: true,
    cancelRequested: false
  };
  
  // Store crawler in active crawlers map
  activeCrawlers.set(domain, crawler);
  
  // Determine starting points - use category URLs for TataCliq
  if (domainConfig.categoryUrls && domainConfig.categoryUrls.length > 0) {
    // Use category URLs as starting points for TataCliq
    domainConfig.categoryUrls.forEach(url => queue.push(url));
    console.log(`Starting with ${domainConfig.categoryUrls.length} category URLs for ${domain}`);
  } else {
    // Default to domain root
    queue.push(domain);
  }
  
  // Emit initial crawler info if Socket.IO is available
  if (io && socketId) {
    io.to(socketId).emit('crawl_start', { 
      domain, 
      status: 'started',
      queueSize: queue.length
    });
  }
  
  try {
    // Main crawling loop
    while (queue.length > 0 && crawler.active && !crawler.cancelRequested) {
      // Check if we've reached the page limit
      if (!settings.indefiniteCrawling && crawlStats.totalPages >= settings.maxPages) {
        console.log(`[${domain}] Reached max pages limit (${settings.maxPages})`);
        break;
      }
      
      const url = queue.shift();
      
      // Skip if already visited
      if (visited.has(normalizeUrl(url))) {
        continue;
      }
      
      // Mark as visited
      visited.add(normalizeUrl(url));
      crawlStats.totalPages++;
      
      // Log progress
      console.log(`[${crawlStats.totalPages}/${settings.maxPages}] Visiting: ${url}`);
      
      // Update UI if Socket.IO is available
      if (io && socketId) {
        io.to(socketId).emit('progress_update', {
          domain,
          url,
          pagesVisited: crawlStats.totalPages,
          productsFound: productLinks.size,
          queueSize: queue.length
        });
      }
      
      try {
        // Navigate to the page with proper timeout
        await page.goto(url, { 
          waitUntil: settings.waitUntil || 'networkidle2',
          timeout: settings.navigationTimeout || 60000
        });
        
        // First extract links from the current page before clicking "Show More"
        const initialLinks = await extractLinks(page, domain);
        
        // Process initial links before clicking "Show More"
        const newProductsFromInitialScan = processLinks(initialLinks, domain, visited, queue, productLinks);
        if (newProductsFromInitialScan.length > 0) {
          console.log(`Found ${newProductsFromInitialScan.length} product links on initial scan`);
          
          // Update UI with new products if Socket.IO is available
          if (io && socketId) {
            for (const productUrl of newProductsFromInitialScan) {
              io.to(socketId).emit('product_found', {
                domain,
                url: productUrl,
                count: productLinks.size
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
              const buttonVisible = await page.evaluate((selector, buttonText) => {
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
              await page.click(domainConfig.loadButtonClassName);
              buttonClicked = true;
              clickAttempts++;
              
              // Wait for new content to load
              await page.waitForTimeout(2000);
              
              // Extract and process new links after each click
              if (buttonClicked) {
                const newLinks = await extractLinks(page, domain);
                const newProducts = processLinks(newLinks, domain, visited, queue, productLinks);
                
                if (newProducts.length > 0) {
                  console.log(`Found ${newProducts.length} new products after clicking "Show More"`);
                  
                  // Update UI with new products
                  if (io && socketId) {
                    for (const productUrl of newProducts) {
                      io.to(socketId).emit('product_found', {
                        domain,
                        url: productUrl,
                        count: productLinks.size
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
        console.error(`Error crawling ${url}: ${err.message}`);
        failedUrls.add(url);
      }
    }
    
    // Save results
    crawlStats.endTime = new Date();
    crawlStats.durationSeconds = (crawlStats.endTime - crawlStats.startTime) / 1000;
    crawlStats.crawlCompleted = !crawler.cancelRequested;
    crawlStats.productsFound = productLinks.size;
    
    const result = {
      domain,
      products: Array.from(productLinks),
      totalLinks: productLinks.size,
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
        productCount: productLinks.size,
        filePath: outputPath
      });
    }
    
    console.log(`Crawling complete for ${domain}. Found ${productLinks.size} products.`);
    return result;
  } catch (err) {
    console.error(`Crawler error for ${domain}:`, err);
    throw err;
  } finally {
    // Clean up
    crawler.active = false;
    activeCrawlers.delete(domain);
    
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
  
  crawler.cancelRequested = true;
  crawler.active = false;
  
  try {
    await crawler.browser.close();
  } catch (err) {
    console.error(`Error closing browser for ${domain}:`, err);
  }
  
  activeCrawlers.delete(domain);
  
  return { message: `Stopped crawler for ${domain}` };
}

/**
 * Stop all active crawlers
 */
async function stopAllCrawlers() {
  const domains = Array.from(activeCrawlers.keys());
  
  for (const domain of domains) {
    await stopCrawler(domain);
  }
  
  return { message: `Stopped all crawlers (${domains.length})` };
}

/**
 * Get active crawler instance
 */
function getActiveCrawler(domain) {
  return activeCrawlers.get(domain);
}

/**
 * Get crawl results (for API)
 */
function getCrawlResults(domain) {
  const crawler = activeCrawlers.get(domain);
  
  if (!crawler) {
    return null;
  }
  
  return {
    domain,
    products: Array.from(crawler.productLinks),
    stats: {
      crawling: crawler.active,
      pagesVisited: crawler.crawlStats.totalPages,
      productsFound: crawler.productLinks.size,
      queueSize: crawler.queue.length
    }
  };
}

module.exports = {
  crawlDomain,
  stopCrawler,
  stopAllCrawlers,
  getActiveCrawler,
  getCrawlResults
};