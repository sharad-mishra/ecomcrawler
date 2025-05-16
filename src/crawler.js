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
 */
export async function startCrawling({ domains, onUpdate, onComplete, onError, onProductFound }) {
  // Add onProductFound to parameters
  
  // Validate domains
  if (!domains || domains.length === 0) {
    if (onError) onError({ message: 'No domains provided' });
    return;
  }

  // Send initial update
  if (onUpdate) onUpdate({ message: 'Starting crawl process' });

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
    
    return output;
  } catch (error) {
    console.error('Error during crawling:', error);
    if (onError) onError({ message: error.message });
    throw error;
  }
}

/**
 * Crawl a single site/domain
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
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

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
    // Main crawling loop with prioritized queue
    while (queue.length > 0 && 
           pagesVisited < maxPages && 
           (!maxCrawlTime || (startTime && Date.now() - startTime < maxCrawlTime)) &&
           noNewProductsCounter < MAX_NO_PRODUCT_PAGES) {
      
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
          console.log(`Using special handling for Virgio page: ${page.url()}`);
          try {
            // Handle Virgio differently - perform more aggressive link extraction
            await scrollPage(page, domainName, onUpdate);
            links = await handleVirgioLinks(page);
            console.log(`Found ${links.length} Virgio-specific links`);
            usedSiteSpecificHandler = true;
          } catch (err) {
            console.error(`Error in Virgio handler: ${err.message}`);
            // Fall back to standard extraction
            usedSiteSpecificHandler = false; 
          }
        } else if (currentDomain.includes('westside.com')) {
          console.log(`Using special handling for Westside page: ${page.url()}`);
          try {
            // Handle Westside differently - they use Shopify platform
            await scrollPage(page, domainName, onUpdate);
            links = await handleWestsideLinks(page);
            console.log(`Found ${links.length} Westside-specific links`);
            usedSiteSpecificHandler = true;
          } catch (err) {
            console.error(`Error in Westside handler: ${err.message}`);
            // Fall back to standard extraction
            usedSiteSpecificHandler = false;
          }
        } else if (currentDomain.includes('nykaafashion.com')) {
          try {
            // Special handling for Nykaa Fashion
            await scrollPage(page, domainName, onUpdate);
            links = await extractNykaaFashionLinks(page);
            console.log(`Found ${links.length} NykaaFashion-specific links`);
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
    
    // Log why we stopped crawling
    if (queue.length === 0) {
      if (onUpdate) onUpdate({
        domain: domainName,
        status: `Completed crawl: No more URLs to visit`,
        type: 'success'
      });
    } else if (pagesVisited >= maxPages) {
      if (onUpdate) onUpdate({
        domain: domainName,
        status: `Completed crawl: Reached maximum page limit (${maxPages})`,
        type: 'success' 
      });
    } else if (noNewProductsCounter >= MAX_NO_PRODUCT_PAGES) {
      if (onUpdate) onUpdate({
        domain: domainName,
        status: `Completed crawl: No new products found in ${MAX_NO_PRODUCT_PAGES} consecutive pages`,
        type: 'success'
      });
    } else if (maxCrawlTime && Date.now() - startTime > maxCrawlTime) {
      if (onUpdate) onUpdate({
        domain: domainName,
        status: `Completed crawl: Reached maximum crawl time`,
        type: 'success'
      });
    }
  } finally {
    await browser.close();
    
    if (onUpdate) onUpdate({ 
      domain: domainName, 
      status: `Completed. Found ${productUrls.size} product URLs from ${pagesVisited} pages.`,
      type: 'success'
    });
  }

  return {
    domainName,
    productUrls: Array.from(productUrls),
    failedUrls: Array.from(failedUrls),
  };
}

/**
 * Detect the type of page we're on
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
 * Add this function to validate product URLs
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
 * Extract product links from a grid layout with site-specific enhancements
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
    
    console.log(`Using Westside-specific selectors for ${url}`);
  } else if (domain.includes('virgio.com')) {
    additionalSelectors.push(
      // Virgio specific selectors
      '.product-item', 
      '.product-card',
      '.item-container',
      'a[href*="/products/"]'
    );
    
    console.log(`Using Virgio-specific selectors for ${url}`);
  }
  
  // Add debug logging to see what's happening
  const productLinks = await page.evaluate((additionalSelectors) => {
    const links = new Set();
    const debugInfo = { 
      selectors: {},
      totalFound: 0,
      directProductLinks: 0,
      cardLinks: 0
    };
    
    // Log found elements for each selector
    const checkSelector = (selector) => {
      try {
        const elements = document.querySelectorAll(selector);
        debugInfo.selectors[selector] = elements.length;
        return elements;
      } catch (e) {
        debugInfo.selectors[selector] = `Error: ${e.message}`;
        return [];
      }
    };
    
    // 1. Direct product link check - most reliable
    [
      'a[href*="/products/"]',
      'a[href*="/product/"]',
      'a[href*="/p/"]',
      'a[href*="/p-mp"]',
      'a[href$="/buy"]'
    ].forEach(selector => {
      const elements = checkSelector(selector);
      elements.forEach(el => {
        if (el.href && el.href.includes('http')) {
          links.add(el.href);
          debugInfo.directProductLinks++;
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
      const cards = checkSelector(selector);
      cards.forEach(card => {
        const anchors = card.querySelectorAll('a[href]');
        anchors.forEach(a => {
          if (a.href && a.href.includes('http')) {
            links.add(a.href);
            debugInfo.cardLinks++;
          }
        });
      });
    });
    
    debugInfo.totalFound = links.size;
    
    // Log debug info in browser console
    console.table(debugInfo.selectors);
    console.log(`Total links found: ${debugInfo.totalFound}`);
    
    return {
      links: Array.from(links),
      debug: debugInfo
    };
  }, additionalSelectors);
  
  // Log debug information to node console
  console.log(`[Debug] Found ${productLinks.debug.totalFound} potential product links:`);
  console.log(`  - Direct product links: ${productLinks.debug.directProductLinks}`);
  console.log(`  - Card-based links: ${productLinks.debug.cardLinks}`);
  
  return productLinks.links;
}

/**
 * Helper function to scroll a page
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
 * Special handler for Virgio pages
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
    
    console.log(`Found ${links.size} links on Virgio page`);
    return Array.from(links);
  });
}

/**
 * Special handler for Westside (Shopify) pages
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
    
    console.log(`Found ${links.size} links on Westside page`);
    return Array.from(links);
  });
}

/**
 * Special extraction and validation for NykaaFashion
 */
async function extractNykaaFashionLinks(page) {
  return await page.evaluate(() => {
    const links = new Set();
    
    // Direct product links
    document.querySelectorAll('a[href*="/p/"]').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Product cards - Nykaa Fashion specific
    document.querySelectorAll('.product-item, .plp-prod-list a, [data-item-id] a').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Category links
    document.querySelectorAll('a[href*="/category/"]').forEach(a => {
      if (a.href && a.href.startsWith('http')) links.add(a.href);
    });
    
    // Get all other links for breadth
    document.querySelectorAll('a[href]').forEach(a => {
      if (a.href && a.href.startsWith('http') && a.href.includes('nykaafashion.com')) {
        links.add(a.href);
      }
    });
    
    return Array.from(links);
  });
}

/**
 * Validate Nykaa Fashion product URLs more strictly
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
 * Extract standard links from a page (all links)
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
 * Handle product listing page - scroll to load more products
 */
async function handleProductListPage(page, domain, onUpdate) {
  // Simply use the existing scrollPage function
  await scrollPage(page, domain, onUpdate);
  return true;
}

/**
 * Handle category page - scroll and look for subcategories
 */
async function handleCategoryPage(page, domain, onUpdate) {
  // Simply use the existing scrollPage function
  await scrollPage(page, domain, onUpdate);
  return true;
}
