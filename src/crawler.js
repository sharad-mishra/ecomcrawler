/**
 * E-commerce Product URL Crawler
 * 
 * This module provides functionality to crawl e-commerce websites and extract product URLs.
 * It uses Puppeteer with Stealth mode to avoid bot detection and implements various
 * site-specific handlers for better crawling results.
 * 
 * Supported websites:
 * - virgio.com
 * - westside.com
 * - tatacliq.com
 * - nykaafashion.com
 * 
 * To add support for additional websites:
 * 1. Add site-specific handlers in this file similar to handleVirgioLinks()
 * 2. Add corresponding patterns in the url.utils.js file
 * 3. Configure the new site in the config file
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import config from 'config';
import { 
  isProductUrl, 
  normalizeUrl, 
  getStartingPoints, 
  isCategoryUrl,
  shouldExcludeUrl,
  isSameDomain
} from './utils/url.utils.js';

// Register the stealth plugin
puppeteer.use(StealthPlugin());

// Create output directory if it doesn't exist
const outputDir = config.get('outputDir');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Start the crawling process
 * 
 * @param {Object} options - Crawling options
 * @param {string[]} options.domains - Array of domains to crawl
 * @param {Function} options.onUpdate - Callback for status updates
 * @param {Function} options.onComplete - Callback when crawling completes
 * @param {Function} options.onError - Callback for errors
 * @param {Function} options.onProductFound - Callback when a product URL is found
 * @returns {Object} - Crawl process object with stop method
 */
export async function startCrawling({ domains, onUpdate, onComplete, onError, onProductFound }) {
  // Add a global cancellation flag
  global.crawlCancelled = false;
  
  // Validate domains
  if (!domains || domains.length === 0) {
    if (onError) onError({ message: 'No domains provided' });
    return;
  }

  // Send initial update
  if (onUpdate) onUpdate({ message: 'Starting crawl process' });

  // Create a single, robust crawlProcess object with stop method
  const crawlProcess = {
    domains,
    activeBrowsers: new Set(),
    currentResults: {},
    
    // Add method to save current results at any time
    saveCurrentResults: async function() {
      try {
        // Create a partial results object with current product URLs
        const output = {};
        
        // Add all domains that have been processed so far
        for (const domain of this.domains) {
          if (this.currentResults[domain]) {
            output[domain] = {
              productUrls: this.currentResults[domain],
              count: this.currentResults[domain].length
            };
          } else {
            output[domain] = { productUrls: [], count: 0 };
          }
        }
        
        // Save to file
        const productFileName = config.get('productFileName');
        
        fs.writeFileSync(
          path.join(outputDir, productFileName),
          JSON.stringify(output, null, 2)
        );
        
        return output;
      } catch (err) {
        console.error('Error saving current results:', err);
        throw err;
      }
    },
    
    stop: async function() {
      try {
        // Set global flag - this stops all crawling processes
        global.crawlCancelled = true;
        
        if (onUpdate) onUpdate({ message: 'Crawler stop requested, terminating all processes...', type: 'warning' });
        
        try {
          // Save current results before closing browsers
          await this.saveCurrentResults();
        } catch (saveError) {
          console.error('Error saving partial results during stop:', saveError);
        }
        
        // Close all browsers with improved error handling
        for (const browser of this.activeBrowsers) {
          try {
            // Try normal close with timeout
            await Promise.race([
              browser.close().catch(err => console.error('Error closing browser:', err.message)),
              new Promise(resolve => setTimeout(resolve, 1000))
            ]);
          } catch (err) {
            console.error('Error closing browser during stop:', err);
          }
        }
        
        this.activeBrowsers.clear();
        
        // Wait a moment for cancellation to take effect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (onUpdate) onUpdate({ message: 'Crawling stopped by user', type: 'success' });
        return true;
      } catch (err) {
        console.error('Error in stop function:', err);
        throw err;
      }
    }
  };
  
  try {
    // Configure concurrent crawling
    const concurrencyLimit = config.get('concurrencyLimit') || 2;
    const limit = pLimit(concurrencyLimit);
    
    // Create domain config objects
    const domainsConfig = domains.map(domain => ({ 
      domainName: domain
    }));

    // Start crawling in parallel
    const results = await Promise.allSettled(
      domainsConfig.map(domainInfo => 
        limit(async () => {
          if (onUpdate) onUpdate({ 
            domain: domainInfo.domainName, 
            status: 'Starting crawl', 
            type: 'info' 
          });
          
          try {
            const result = await crawlSite(domainInfo, onUpdate, onProductFound);
            return result;
          } catch (error) {
            if (onUpdate) onUpdate({ 
              domain: domainInfo.domainName, 
              status: `Failed: ${error.message}`, 
              type: 'error' 
            });
            throw error;
          }
        })
      )
    );

    // Process results
    const output = {};
    const failedUrlsOutput = {};

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        const { domainName, productUrls, failedUrls } = result.value;
        output[domainName] = { productUrls, count: productUrls.length };
        failedUrlsOutput[domainName] = failedUrls;
      } else {
        const domainName = result.reason?.domainName || 'unknown';
        const error = result.reason?.message || result.reason;
        output[domainName] = { productUrls: [], count: 0, error };
        failedUrlsOutput[domainName] = [`Failed to crawl: ${error}`];
      }
    });

    // Save results to files
    const productFileName = config.get('productFileName');
    const failedUrlsFileName = config.get('failedUrlsFileName');
    
    fs.writeFileSync(
      path.join(outputDir, productFileName),
      JSON.stringify(output, null, 2)
    );
    
    fs.writeFileSync(
      path.join(outputDir, failedUrlsFileName),
      JSON.stringify(failedUrlsOutput, null, 2)
    );

    // Send completion update
    if (onComplete) onComplete(output);
    
    return crawlProcess; // Return the process with stop function
  } catch (error) {
    console.error('Error during crawling:', error);
    if (onError) onError({ message: error.message });
    throw error;
  }
}

/**
 * Crawl a single site/domain
 * 
 * @param {Object} domainInfo - Domain configuration
 * @param {Function} onUpdate - Callback for status updates
 * @param {Function} onProductFound - Callback when a product URL is found
 * @returns {Object} - Results of the crawl
 */
async function crawlSite(domainInfo, onUpdate, onProductFound) {
  const { domainName, loadButtonClassName, loadButtonInnerText, maxCrawlTime, startTime } = domainInfo;
  
  // Get proper starting URL
  const startingUrls = getStartingPoints(domainName);
  const startUrl = startingUrls[0];
  
  if (onUpdate) onUpdate({ 
    domain: domainName, 
    status: `Launching browser`, 
    type: 'info' 
  });

  // Launch browser with improved settings
  let browser = null;
  
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    // Add browser to active browsers for cleanup
    if (global.crawlProcess && global.crawlProcess.activeBrowsers) {
      global.crawlProcess.activeBrowsers.add(browser);
    }
    
    const page = await browser.newPage();
    
    // Tracking variables - initialize these to fix the "not defined" error
    let pagesVisited = 0;
    let noNewProductsCounter = 0;
    const MAX_NO_PRODUCT_PAGES = 20; // Stop after this many pages with no new products
    const maxPages = config.has('maxPages') ? config.get('maxPages') : 500; // Use default if not configured
    
    // Set up enhanced crawl state with prioritization
    const visited = new Set();
    const queue = [...startingUrls.map(url => ({ url, priority: 0, depth: 0 }))];  // Track priority & depth
    const productUrls = new Set();
    const failedUrls = new Set();
    
    // Cache for pages that have already been checked for pagination
    const paginationChecked = new Set();
    
    // Additional tracking for improved crawling
    const categoryPages = new Set();
    const productListingPages = new Set();
    
    if (onUpdate) onUpdate({ 
      domain: domainName, 
      status: `Starting crawl from ${startUrl}`, 
      type: 'info' 
    });

    try {
      // Check for cancellation flag periodically
      const checkCancellation = setInterval(() => {
        if (global.crawlCancelled) {
          clearInterval(checkCancellation);
          queue.length = 0; // Clear queue to stop crawling
        }
      }, 1000);
      
      // Main crawling loop with prioritized queue
      while (queue.length > 0 && 
             pagesVisited < maxPages && 
             (!maxCrawlTime || (startTime && Date.now() - startTime < maxCrawlTime)) &&
             noNewProductsCounter < MAX_NO_PRODUCT_PAGES) {
        
        // CHECK CANCELLATION FLAG - Exit immediately if cancelled
        if (global.crawlCancelled) {
          if (onUpdate) onUpdate({ 
            domain: domainName, 
            status: `Crawling cancelled by user request`,
            type: 'warning'
          });
          break;
        }
        
        // Sort queue by priority: category pages first, then by depth (breadth-first)
        queue.sort((a, b) => {
          // Higher priority number = higher precedence
          if (a.priority !== b.priority) return b.priority - a.priority;
          // Lower depth = higher precedence (breadth-first)
          return a.depth - b.depth;
        });
        
        // Get next URL from queue
        const queueItem = queue.shift();
        const url = queueItem.url;
        const depth = queueItem.depth || 0;
        const pageType = queueItem.pageType || 'general';
        
        const normalizedUrl = normalizeUrl(url);
        
        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);
        
        if (onUpdate) onUpdate({ 
          domain: domainName, 
          status: `Visiting: ${normalizedUrl} [${pagesVisited+1}/${maxPages}]`,
          type: 'info'
        });
        
        try {
          // Check cancellation before navigation
          if (global.crawlCancelled) break;
          
          // Navigate to page - ALWAYS navigate first before any processing
          await page.goto(normalizedUrl, { 
            waitUntil: "networkidle2", 
            timeout: 30000 
          });
          
          const productCountBefore = productUrls.size;
          
          // Check current domain for site-specific handling AFTER page loads
          const currentDomain = new URL(page.url()).hostname;
          
          // Extract links using appropriate method based on site
          let links = [];
          let usedSiteSpecificHandler = false;
          
          // Site-specific handling AFTER the page is loaded
          if (currentDomain.includes('virgio.com')) {
            try {
              // Handle Virgio differently - perform more aggressive link extraction
              await scrollPage(page, domainName, onUpdate);
              links = await handleVirgioLinks(page);
              usedSiteSpecificHandler = true;
            } catch (err) {
              console.error(`Error in Virgio handler: ${err.message}`);
              // Fall back to standard extraction
              usedSiteSpecificHandler = false; 
            }
          } else if (currentDomain.includes('westside.com')) {
            try {
              // Handle Westside differently - they use Shopify platform
              await scrollPage(page, domainName, onUpdate);
              links = await handleWestsideLinks(page);
              usedSiteSpecificHandler = true;
            } catch (err) {
              console.error(`Error in Westside handler: ${err.message}`);
              // Fall back to standard extraction
              usedSiteSpecificHandler = false;
            }
          } else if (currentDomain.includes('nykaafashion.com')) {
            try {
              // Enhanced handling for Nykaa Fashion with more comprehensive scrolling and extraction
              await page.waitForTimeout(1500); // Additional time for AJAX content
              
              // Perform a more thorough scroll for Nykaa Fashion
              await scrollNykaaFashionPage(page, domainName, onUpdate);
              
              // Use the enhanced NykaaFashion link extractor
              links = await extractNykaaFashionLinks(page);
              
              usedSiteSpecificHandler = true;
            } catch (err) {
              console.error(`Error in NykaaFashion handler: ${err.message}`);
              usedSiteSpecificHandler = false;
            }
          }
          
          // If site-specific handler failed or wasn't used, fallback to generic handling
          if (!usedSiteSpecificHandler) {
            // If we detect this is a product page, add it to product URLs
            if (isProductUrl(page.url())) {
              const currentProductUrl = normalizeUrl(page.url());
              if (!productUrls.has(currentProductUrl)) {
                productUrls.add(currentProductUrl);
                
                if (onUpdate) onUpdate({ 
                  type: 'product',
                  domain: domainName, 
                  url: currentProductUrl
                });
                
                if (typeof onProductFound === 'function') {
                  onProductFound({
                    domain: domainName,
                    url: currentProductUrl
                  });
                }
              }
            }
            
            try {
              // Try to detect page type
              const pageClassification = await detectPageType(page);
              
              // Handle different page types appropriately
              if (pageClassification === 'productList') {
                // This is a product listing page - try extracting product cards directly
                await handleProductListPage(page, domainName, onUpdate);
                links = await extractProductLinksFromGrid(page);
              } else if (pageClassification === 'category') {
                // This is a category page - get subcategories and any featured products
                await handleCategoryPage(page, domainName, onUpdate);
                links = await extractCategoryLinks(page);
              } else {
                // Standard page - extract all links
                links = await extractStandardLinks(page);
              }
            } catch (err) {
              // Fallback to basic link extraction if the improved methods fail
              console.error(`Error during specialized extraction: ${err.message}`);
              links = await page.evaluate(() => 
                Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
                  .filter(href => href && href.startsWith('http'))
              );
            }
          }
          
          if (onUpdate) onUpdate({ 
            domain: domainName, 
            status: `Found ${links.length} links on ${normalizedUrl}`,
            type: 'info'
          });

          // Process links
          for (const link of links) {
            const normalizedLink = normalizeUrl(link);
            
            // Skip if already visited or queued
            if (visited.has(normalizedLink) || queue.some(item => item.url === normalizedLink)) {
              continue;
            }
            
            // Only process links on the same domain
            if (!isSameDomain(link, domainName)) {
              continue;
            }
            
            // Skip excluded URLs (unless they're product URLs)
            if (shouldExcludeUrl(link) && !isProductUrl(link)) {
              continue;
            }
            
            // Prioritize links based on type
            if (isProductUrl(normalizedLink)) {
              // Validate product URL more strictly if it's NykaaFashion
              let isValidProduct = true;
              if (domainName.includes('nykaafashion')) {
                isValidProduct = validateNykaaFashionProductUrl(normalizedLink);
              }
              
              // It's a product - add directly to results if valid
              if (isValidProduct && !productUrls.has(normalizedLink)) {
                productUrls.add(normalizedLink);
                noNewProductsCounter = 0; // Reset counter
                
                // Add to current results for partial saves
                if (global.crawlProcess && global.crawlProcess.currentResults) {
                  if (!global.crawlProcess.currentResults[domainName]) {
                    global.crawlProcess.currentResults[domainName] = [];
                  }
                  global.crawlProcess.currentResults[domainName].push(normalizedLink);
                }
                
                if (onUpdate) onUpdate({ 
                  type: 'product',
                  domain: domainName, 
                  url: normalizedLink
                });
                
                if (typeof onProductFound === 'function') {
                  onProductFound({
                    domain: domainName,
                    url: normalizedLink
                  });
                }
              }
            } else {
              // Determine priority and page type for the queue
              let priority = 0;
              let newPageType = 'general';
              
              if (isCategoryUrl(normalizedLink)) {
                // Category pages get highest priority
                priority = 3;
                newPageType = 'category';
              } else if (link.includes('collection') || link.includes('shop-by') || 
                        link.includes('products') || link.match(/\/[^\/]+\/[^\/]+\/?$/)) {
                // Potential product listing pages get medium-high priority
                priority = 2;
                newPageType = 'productList';
              } else if (depth < 2) {
                // Main navigation links (shallow depth) get medium priority
                priority = 1;
              }
              
              // Add to queue with priority and increased depth
              queue.push({
                url: normalizedLink,
                priority,
                depth: depth + 1,
                pageType: newPageType
              });
            }
          }
          
          // Update stats and check for stopping conditions
          pagesVisited++;
          if (productUrls.size > productCountBefore) {
            noNewProductsCounter = 0; // Reset if we found new products
          } else {
            noNewProductsCounter++; // Increment if no new products found
          }
          
          if (onUpdate) onUpdate({ 
            domain: domainName, 
            status: `Found ${productUrls.size} product URLs so far (${noNewProductsCounter} pages with no new products)`,
            type: 'info'
          });
        } catch (err) {
          console.error(`Failed to crawl ${url}: ${err.message}`);
          failedUrls.add(url);
          
          if (onUpdate) onUpdate({ 
            domain: domainName, 
            status: `Failed to crawl ${url}: ${err.message}`,
            type: 'error'
          });
        }
      }
      
      // Clear the cancellation check
      clearInterval(checkCancellation);
    } finally {
      // IMPORTANT: Make sure browser is always closed, even if cancelled
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error(`Error closing browser: ${closeErr.message}`);
        }
      }
      
      // Clear cancellation state when this crawler instance finishes
      if (global.crawlCancelled) {
        if (onUpdate) onUpdate({ 
          domain: domainName, 
          status: `Crawling terminated by stop request`,
          type: 'warning'
        });
      } else {
        if (onUpdate) onUpdate({ 
          domain: domainName, 
          status: `Completed. Found ${productUrls.size} product URLs from ${pagesVisited} pages.`,
          type: 'success'
        });
      }
    }

    return {
      domainName,
      productUrls: Array.from(productUrls),
      failedUrls: Array.from(failedUrls),
    };
  } catch (error) {
    console.error('Error during crawling:', error);
    if (onError) onError({ message: error.message });
    throw error;
  }
}

/**
 * Detect the type of page we're on
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string} - Page type: 'productList', 'category', or 'general'
 */
async function detectPageType(page) {
  return await page.evaluate(() => {
    // Check for product listing indicators
    const hasProductGrid = !!document.querySelector(
      '.product-grid, .products-grid, .product-listing, [class*="product-grid"], ' +
      '.styles-grid, [class*="productGrid"], .search-results, .collection-grid, ' + 
      '.plp-product-grid, [data-component="product-grid"]'
    );
    
    const hasMultipleProductCards = document.querySelectorAll(
      '.product-card, .product-item, [class*="productCard"], [class*="ProductCard"], ' +
      '.product-tile, [data-product-id], [data-productid], [class*="productTile"]'
    ).length >= 4;
    
    // Check for category indicators
    const hasCategoryLinks = document.querySelectorAll(
      '.category-nav, .categories, .departments, .collections-grid, ' +
      'nav [href*="category"], nav [href*="collection"], [class*="categoryList"]'
    ).length >= 3;
    
    const hasFilters = !!document.querySelector(
      '.filters, .filter, [class*="filter"], .facets, .refinements, ' +
      '[data-component="filter"], .sort-by'
    );
    
    // Classification logic
    if (hasProductGrid || hasMultipleProductCards) {
      return 'productList';
    } else if (hasCategoryLinks && !hasProductGrid) {
      return 'category';
    } else if (hasFilters) {
      return 'productList';
    }
    
    return 'general';
  });
}

/**
 * Validate if a URL is a legitimate product URL
 * 
 * @param {Object} page - Puppeteer page object
 * @param {string} url - URL to validate
 * @param {string} domain - Domain of the site
 * @returns {boolean} - True if URL is a valid product URL
 */
async function validateProductUrl(page, url, domain) {
  try {
    // First use pattern matching from utils
    if (!isProductUrl(url)) return false;
    
    // Additional site-specific validations could be added here
    return true;
  } catch (err) {
    console.error(`Error validating product URL ${url}: ${err.message}`);
    return false;
  }
}

/**
 * Helper function to scroll a page to load dynamic content
 * 
 * @param {Object} page - Puppeteer page object
 * @param {string} domain - Domain of the site
 * @param {Function} onUpdate - Callback for status updates
 * @returns {boolean} - True if scrolling was successful
 */
async function scrollPage(page, domain, onUpdate) {
  try {
    if (onUpdate) onUpdate({ 
      domain, 
      status: `Scrolling page to load content`,
      type: 'info'
    });
    
    // Initial wait for page to be fully loaded
    await page.waitForTimeout(1000);
    
    // Get initial height
    let previousHeight = await page.evaluate('document.body.scrollHeight');
    let scrollCount = 0;
    const maxScrolls = 5; // Limit scrolls to avoid infinite scrolling
    
    // Scroll multiple times with pauses
    while (scrollCount < maxScrolls) {
      // Scroll to bottom
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.waitForTimeout(1500); // Wait for content to load
      
      // Check if the page height has changed
      const currentHeight = await page.evaluate('document.body.scrollHeight');
      if (currentHeight === previousHeight) {
        break; // No more content loading, break the loop
      }
      
      previousHeight = currentHeight;
      scrollCount++;
    }
    
    // Final scroll to top for good measure
    await page.evaluate('window.scrollTo(0, 0)');
    await page.waitForTimeout(500);
    
    return true;
  } catch (e) {
    console.error(`Error scrolling page: ${e.message}`);
    return false;
  }
}

/**
 * Extract standard links from a page (all links)
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of links
 */
async function extractStandardLinks(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(href => href && href.startsWith('http'));
  });
}

/**
 * Extract category links from a page
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of category links
 */
async function extractCategoryLinks(page) {
  return await page.evaluate(() => {
    const links = new Set();
    
    // Category section links
    document.querySelectorAll('.category-section a, [class*="category"] a, .collections a, .departments a').forEach(a => {
      if (a.href && a.href.startsWith('http')) {
        links.add(a.href);
      }
    });
    
    // If we didn't find many specific links, get all links from the page
    if (links.size < 5) {
      document.querySelectorAll('a[href]').forEach(a => {
        if (a.href && a.href.startsWith('http')) {
          links.add(a.href);
        }
      });
    }
    
    return Array.from(links);
  });
}

/**
 * Extract product links from a grid layout with site-specific enhancements
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of product links
 */
async function extractProductLinksFromGrid(page) {
  const url = await page.url();
  const domain = new URL(url).hostname;
  
  // Site-specific selectors based on domain
  const additionalSelectors = [];
  
  if (domain.includes('westside.com')) {
    additionalSelectors.push(
      // Westside specific selectors
      '.grid__item',
      '.grid-product__content',
      '.product-card',
      '.product-item',
      'a[href*="/products/"]'
    );
  } else if (domain.includes('virgio.com')) {
    additionalSelectors.push(
      // Virgio specific selectors
      '.product-item', 
      '.product-card',
      '.item-container',
      'a[href*="/products/"]'
    );
  }
  
  const productLinks = await page.evaluate((additionalSelectors) => {
    const links = new Set();
    
    // 1. Direct product link check - most reliable
    [
      'a[href*="/products/"]',
      'a[href*="/product/"]',
      'a[href*="/p/"]',
      'a[href*="/p-mp"]',
      'a[href$="/buy"]'
    ].forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (el.href && el.href.includes('http')) {
          links.add(el.href);
        }
      });
    });
    
    // 2. Check product cards with site-specific selectors
    const allSelectors = [
      '.product-card', 
      '.product-item', 
      '.product-tile', 
      '.grid-view-item',
      '[class*="product-card"]',
      '[class*="productCard"]', 
      ...additionalSelectors
    ];
    
    allSelectors.forEach(selector => {
      const cards = document.querySelectorAll(selector);
      cards.forEach(card => {
        const anchors = card.querySelectorAll('a[href]');
        anchors.forEach(a => {
          if (a.href && a.href.includes('http')) {
            links.add(a.href);
          }
        });
      });
    });
    
    return Array.from(links);
  }, additionalSelectors);
  
  return productLinks;
}

/**
 * Handle product listing page - scroll to load more products
 * 
 * @param {Object} page - Puppeteer page object
 * @param {string} domain - Domain of the site
 * @param {Function} onUpdate - Callback for status updates
 * @returns {boolean} - True if handling was successful
 */
async function handleProductListPage(page, domain, onUpdate) {
  try {
    if (onUpdate) onUpdate({ 
      domain, 
      status: `Scrolling product listing page to load more products`,
      type: 'info' 
    });
    
    // Simply use the existing scrollPage function for standard pages
    await scrollPage(page, domain, onUpdate);
    
    // For NykaaFashion, try to find and click any "Load More" buttons
    if (domain.includes('nykaafashion.com')) {
      await tryClickLoadMoreButton(page, '.css-1q7tqyw, button[data-at*="load_more"]');
    }
    
    return true;
  } catch (error) {
    console.error(`Error handling product list page: ${error.message}`);
    return false;
  }
}

/**
 * Handle category page - scroll and look for subcategories
 * 
 * @param {Object} page - Puppeteer page object
 * @param {string} domain - Domain of the site
 * @param {Function} onUpdate - Callback for status updates
 * @returns {boolean} - True if handling was successful
 */
async function handleCategoryPage(page, domain, onUpdate) {
  try {
    if (onUpdate) onUpdate({ 
      domain, 
      status: `Handling category page`,
      type: 'info' 
    });
    
    // For category pages, we just need to scroll to make sure all links are loaded
    await scrollPage(page, domain, onUpdate);
    
    return true;
  } catch (error) {
    console.error(`Error handling category page: ${error.message}`);
    return false;
  }
}

/**
 * Specialized scrolling function for NykaaFashion pages
 * They often load content dynamically on scroll and have "Load More" buttons
 * Fixed to avoid document is not defined errors
 */
async function scrollNykaaFashionPage(page, domain, onUpdate) {
  if (onUpdate) onUpdate({ 
    domain, 
    status: `Scrolling NykaaFashion page to load dynamic content`,
    type: 'info'
  });
  
  try {
    // Initial scroll to trigger lazy loading - first quick scan
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight * 0.3);
    });
    
    await page.waitForTimeout(1500);
    
    // More thorough scrolling
    let previousHeight = await page.evaluate('document.body.scrollHeight');
    let scrollCount = 0;
    const maxScrolls = 8; // More scrolls for NykaaFashion
    
    while (scrollCount++ < maxScrolls) {
      if (onUpdate && scrollCount % 2 === 0) onUpdate({
        domain,
        status: `Scroll #${scrollCount} of ${maxScrolls} to load more products`,
        type: 'info'
      });
      
      // Scroll down in increments for smoother loading - Fixed to use template literals properly
      await page.evaluate((scrollCount, maxScrolls) => {
        window.scrollTo(0, scrollCount * document.body.scrollHeight / maxScrolls);
      }, scrollCount, maxScrolls);
      
      await page.waitForTimeout(800); // Wait for content to load
      
      // Check if we're at the end of the page
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === previousHeight && scrollCount > 3) {
        // Try clicking "Load More" if available
        const loadMoreClicked = await page.evaluate(() => {
          const loadMoreButton = document.querySelector('.css-1q7tqyw, button[data-at*="load_more"]');
          if (loadMoreButton && loadMoreButton.innerText.toLowerCase().includes('load')) {
            loadMoreButton.scrollIntoView();
            loadMoreButton.click();
            return true;
          }
          return false;
        });
        
        if (loadMoreClicked) {
          if (onUpdate) onUpdate({
            domain,
            status: `Clicked "Load More" button`,
            type: 'info'
          });
          
          // Wait for new content to load after clicking Load More
          await page.waitForTimeout(2500);
          
          // Get new height
          previousHeight = await page.evaluate('document.body.scrollHeight');
        } else {
          // If no Load More button and height hasn't changed, we're done
          break;
        }
      } else {
        previousHeight = newHeight;
      }
    }
    
    // Final scroll to top to reset view
    await page.evaluate('window.scrollTo(0, 0)');
    await page.waitForTimeout(500);
    
    return true;
  } catch (e) {
    console.error(`Error scrolling NykaaFashion page: ${e.message}`);
    return false;
  }
}

/**
 * Validate NykaaFashion product URLs with specific pattern checking
 * 
 * @param {string} url - URL to validate
 * @returns {boolean} - True if URL is a valid NykaaFashion product URL
 */
function validateNykaaFashionProductUrl(url) {
  try {
    // Must be a Nykaa Fashion URL
    if (!url.includes('nykaafashion.com')) return false;
    
    // Must match the specific pattern for Nykaa products
    // Pattern is usually: /some-product-description/p/12345678
    if (url.match(/\/p\/\d{5,}/)) return true;
    
    // Alternate pattern seen on their site
    if (url.match(/\/[^\/]+\/\d{5,}\/buy/)) return true;
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Special handler for Virgio pages to extract links
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of extracted links
 */
async function handleVirgioLinks(page) {
  // First make sure we're actually on the Virgio site
  const url = await page.url();
  if (!url.includes('virgio.com')) {
    console.error('Not a Virgio page, cannot extract links');
    return [];
  }

  // Set longer timeout and scroll first
  await page.setDefaultTimeout(60000);
  
  return await page.evaluate(() => {
    const links = new Set();
    
    // First add all navigation links
    document.querySelectorAll('nav a, header a, .menu a, .navigation a').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Get main site links that could be categories or special sections
    document.querySelectorAll('a[href*="/collections"], a[href*="/products"], a[href*="/categories"]').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Try to find product cards
    document.querySelectorAll('.product-card, .product-item, [class*="product"], [class*="collection"], [class*="card"]').forEach(card => {
      const anchor = card.querySelector('a');
      if (anchor && anchor.href) links.add(anchor.href);
    });
    
    // If still no links, get absolutely all links from the page as a fallback
    if (links.size < 5) {
      document.querySelectorAll('a[href]').forEach(a => {
        if (a.href && a.href.startsWith('http') && a.href.includes('virgio.com')) {
          links.add(a.href);
        }
      });
    }
    
    return Array.from(links);
  });
}

/**
 * Special handler for Westside (Shopify) pages to extract links
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of extracted links
 */
async function handleWestsideLinks(page) {
  // First make sure we're actually on the Westside site
  const url = await page.url();
  if (!url.includes('westside.com')) {
    console.error('Not a Westside page, cannot extract links');
    return [];
  }

  // Set longer timeout and scroll page fully
  await page.setDefaultTimeout(60000);
  
  return await page.evaluate(() => {
    const links = new Set();
    
    // Shopify-specific product link patterns
    document.querySelectorAll('a[href*="/products/"]').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Collection links (categories)
    document.querySelectorAll('a[href*="/collections/"]').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Try to find product grids (Shopify standard)
    document.querySelectorAll('.grid-view-item a, .grid__item a, .product-card a').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // If we found very few links, get all links from the page
    if (links.size < 5) {
      document.querySelectorAll('a[href]').forEach(a => {
        if (a.href && a.href.startsWith('http') && a.href.includes('westside.com')) {
          links.add(a.href);
        }
      });
    }
    
    return Array.from(links);
  });
}

/**
 * Special function for NykaaFashion links extraction
 * ENHANCED with deeper inspection and better element targeting
 * 
 * @param {Object} page - Puppeteer page object
 * @returns {string[]} - Array of extracted links
 */
async function extractNykaaFashionLinks(page) {
  // First wait a bit for all dynamic content to load
  await page.waitForTimeout(1500);
  
  // Detect and click "Load More" button if present
  await tryClickLoadMoreButton(page, '.css-1q7tqyw, button[data-at*="load_more"]');
  
  return await page.evaluate(() => {
    const links = new Set();
    
    // STEP 1: Get all direct product links first (most reliable)
    const productLinkSelectors = [
      'a[href*="/p/"]',
      'a[data-reactid*="product"]',
      '.css-d6ukp1 a', 
      '.css-n0pt9j a',
      '.css-1tewyts a',
      '.css-1oqhjhj a',
      '.plp-prod-list a',
      '.css-adnlip a',
      '.product-item a',
      '[data-item-id] a'
    ];
    
    // Process each selector
    productLinkSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(a => {
          if (a.href && a.href.startsWith('http') && a.href.includes('/p/')) {
            links.add(a.href);
          }
        });
      } catch (e) {
        // Ignore errors for individual selectors
      }
    });
    
    // STEP 2: Get product cards by looking for parent containers
    const productCardContainers = [
      '.plp-prod-list',
      '.product-grid',
      '.css-1kbdyxh',
      '.css-1pe7halt',
      '.css-xow0on',
      '.productListingContent',
      '[data-comp="ProductList"]'
    ];
    
    productCardContainers.forEach(container => {
      try {
        const cards = document.querySelectorAll(container);
        cards.forEach(card => {
          const anchors = card.querySelectorAll('a[href]');
          anchors.forEach(a => {
            if (a.href && a.href.startsWith('http') && a.href.includes('nykaafashion.com')) {
              links.add(a.href);
            }
          });
        });
      } catch (e) {
        // Skip errors for container selectors
      }
    });
    
    // STEP 3: Find main navigation links for categories
    const categorySelectors = [
      '.leftMenuBox a',
      '.css-1x4qz13 a', // Main navigation
      '.css-9mhssf a',  // Category links
      'a[href*="/c/"]',
      'a[data-at="gnav"]'
    ];
    
    categorySelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(a => {
          if (a.href && a.href.startsWith('http') && a.href.includes('nykaafashion.com')) {
            links.add(a.href);
          }
        });
      } catch (e) {
        // Skip errors for categories
      }
    });
    
    // STEP 4: Get all remaining links for breadth (with lower priority)
    document.querySelectorAll('a[href]').forEach(a => {
      if (a.href && a.href.startsWith('http') && a.href.includes('nykaafashion.com')) {
        links.add(a.href);
      }
    });
    
    return Array.from(links);
  });
}

/**
 * Helper function to try clicking a load more button on NykaaFashion
 */
async function tryClickLoadMoreButton(page, selector, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const buttonExists = await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button && button.innerText.toLowerCase().includes('load more')) {
          // Scroll to the button first
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        return false;
      }, selector);
      
      if (buttonExists) {
        // Wait a bit for any smooth scrolling to complete
        await page.waitForTimeout(1000);
        
        // Click the button
        await page.click(selector);
        
        // Wait for content to load
        await page.waitForTimeout(2000);
        
        // Scroll a bit to ensure new content is in view
        await page.evaluate(() => {
          window.scrollBy(0, 300);
        });
        
        // Wait again for any new items to render
        await page.waitForTimeout(1000);
      } else {
        break; // No button found, exit loop
      }
    } catch (error) {
      console.error(`Error clicking load more button on attempt ${i+1}:`, error.message);
      break;
    }
  }
}
