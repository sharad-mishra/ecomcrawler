const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { 
  isProductUrl, 
  isCategoryUrl,
  normalizeUrl,
  shouldExcludeUrl,
  isSameDomain,
  getStartingPoints
} = require('../utils/url.utils');
const config = require('config');

puppeteer.use(StealthPlugin());

class BaseCrawler {
  constructor(domain) {
    this.domain = domain;
    this.browser = null;
    this.visited = new Set();
    this.productLinks = new Set();
    this.queue = [];
    this.failedUrls = new Set();
    
    // Use simple fixed settings
    this.maxPages = 300;
    this.maxDepth = 3;
    
    // Get starting points
    const formattedDomain = this.domain.includes('://') ? this.domain : `https://www.${this.domain}`;
    this.startingPoints = getStartingPoints(formattedDomain);
    
    this.events = null;
    this.crawlStats = {
      startTime: null,
      endTime: null,
      totalPages: 0,
      totalProducts: 0
    };
    this.stopRequested = false;
  }

  setEventEmitter(io, socketId) {
    this.events = { io, socketId };
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage'
      ]
    });
  }

  async close() {
    console.log(`Closing crawler for ${this.domain}`);
    this.stopRequested = true;
    
    // If crawling was in progress, make sure we save results
    if (this.crawlStats.startTime && !this.crawlStats.endTime) {
      this.crawlStats.endTime = new Date();
      await this.saveResults();
    }
    
    if (this.browser) {
      try {
        const pages = await this.browser.pages();
        
        // Close all open pages first
        for (const page of pages) {
          try {
            await page.close().catch(() => {});
          } catch (e) {
            // Ignore errors when closing individual pages
          }
        }
        
        // Then close the browser
        await this.browser.close().catch(err => {
          console.log(`Error when closing browser: ${err.message}`);
        });
      } catch (error) {
        console.error(`Error closing browser for ${this.domain}:`, error);
      } finally {
        this.browser = null;
      }
    }
    
    // Clear data structures to free memory
    this.visited.clear();
    this.queue = [];
    this.failedUrls.clear();
  }

  async crawl() {
    console.log(`Starting crawl for ${this.domain}`);
    this.crawlStats.startTime = new Date();
    this.queue = this.startingPoints.map(url => ({ url, depth: 0 }));
    this.visited.clear();
    this.productLinks.clear();
    this.failedUrls.clear();
    this.stopRequested = false; // Reset stop flag at start

    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('crawl_start', {
        domain: this.domain,
        timestamp: new Date().toISOString()
      });
    }

    let pagesVisited = 0;
    let estimatedTotal = Math.min(this.maxPages, this.queue.length * 20);

    // Check stopRequested more frequently
    while (this.queue.length > 0 && pagesVisited < this.maxPages && !this.stopRequested) {
      // Break immediately if stop requested
      if (this.stopRequested) {
        console.log(`Stop requested for ${this.domain}, breaking crawl loop`);
        break;
      }

      // Get next URL from queue
      const { url, depth } = this.queue.shift();
      const normalizedUrl = normalizeUrl(url);
      
      // Skip already visited URLs and respect max depth
      if (this.visited.has(normalizedUrl) || depth > this.maxDepth) continue;
      
      try {
        // Check stop requested again before starting page processing
        if (this.stopRequested) break;
        
        // Mark as visited before processing
        this.visited.add(normalizedUrl);
        
        const page = await this.browser.newPage();
        await this.setupPage(page);
        
        console.log(`Visiting [${pagesVisited+1}/${this.maxPages}]: ${url} (depth: ${depth})`);
        
        // Set a shorter timeout for navigation when stopping is requested
        const navigationTimeout = this.stopRequested ? 5000 : 30000;
        
        // Navigate to the URL
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: navigationTimeout 
        });
        
        // Early exit if stop requested
        if (this.stopRequested) {
          await page.close();
          break;
        }
        
        // Simple wait after page load
        await page.waitForTimeout(2000);
        
        // Get current URL (after possible redirects)
        const currentUrl = page.url();
        
        // Check stop requested before scrolling
        if (!this.stopRequested) {
          // Scroll to load lazy content
          await this.scrollPage(page);
        }
        
        // Check stop requested before clicking load more
        if (!this.stopRequested) {
          // Try to click load more button
          await this.clickLoadMoreButton(page);
        }
        
        // Check if it's a product page
        let isProduct = isProductUrl(currentUrl);
        
        // If not detected by URL pattern, check using DOM elements
        if (!isProduct && !this.stopRequested) {
          isProduct = await this.isProductPageByDOM(page);
        }
        
        if (isProduct) {
          this.productLinks.add(normalizeUrl(currentUrl));
          this.crawlStats.totalProducts = this.productLinks.size;
          this.emitProductFound(normalizeUrl(currentUrl));
          console.log(`Product found: ${currentUrl}`);
        }
        
        // Extract links from the page if not stopping
        let links = [];
        if (!this.stopRequested && depth < this.maxDepth) {
          links = await this.extractLinks(page);
          this.queueLinks(links, depth + 1);
        }
        
        // Close page to free memory
        await page.close();
        
        // Update stats
        pagesVisited++;
        this.crawlStats.totalPages = pagesVisited;
        
        // Update progress
        this.emitProgress(pagesVisited, estimatedTotal);
        
        // Check for stop after each page
        if (this.stopRequested) {
          console.log(`Stop requested after processing page for ${this.domain}`);
          break;
        }
        
      } catch (error) {
        console.error(`Failed to process ${url}: ${error.message}`);
        this.failedUrls.add(url);
        
        // If we got an error and stop is requested, break the loop
        if (this.stopRequested) break;
      }
    }
    
    // Set end time and record if crawl was completed or stopped
    this.crawlStats.endTime = new Date();
    this.crawlStats.wasCompleted = !this.stopRequested;
    
    console.log(`Crawl ${this.stopRequested ? 'stopped' : 'completed'} for ${this.domain}`);
    
    // Emit completion event
    if (this.events?.io) {
      const resultFile = await this.saveResults();
      
      // Use the appropriate event based on whether crawl was stopped or completed
      const eventName = this.stopRequested ? 'crawl_stopped' : 'crawl_complete';
      
      this.events.io.to(this.events.socketId).emit(eventName, {
        domain: this.domain,
        totalProducts: this.productLinks.size,
        totalPages: pagesVisited,
        filePath: resultFile,
        duration: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
      });
    }

    return this.saveResults();
  }

  async setupPage(page) {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setRequestInterception(true);
    
    // Block resource types to save memory and speed up crawling
    page.on('request', req => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Set reduced timeout
    page.setDefaultNavigationTimeout(30000);
  }

  async scrollPage(page) {
    try {
      // Fix for "document is not defined" error
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 3);
      });
      await page.waitForTimeout(500);
      
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight * 2/3);
      });
      await page.waitForTimeout(500);
      
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(500);
    } catch (error) {
      console.log(`Error during scrolling: ${error.message}`);
    }
  }

  async clickLoadMoreButton(page) {
    try {
      // Common load more button selectors for e-commerce sites
      const loadMoreSelectors = [
        '.load-more', '.more-products', '.view-more', 
        'button.load-more-button', '.Button-sc-1antbdu-0',
        '.collection-load-more', '.css-1q7tqyw'
      ];
      
      // Check if any of the load more buttons exist and click
      for (const selector of loadMoreSelectors) {
        const buttonExists = await page.$(selector);
        if (buttonExists) {
          await page.click(selector).catch(() => {});
          console.log(`Clicked ${selector} button`);
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch (error) {
      // Ignore errors when clicking load more button
      console.log(`Error clicking load more: ${error.message}`);
    }
  }

  async isProductPageByDOM(page) {
    try {
      // Check for product indicators in the DOM
      return await page.evaluate(() => {
        // Check for common product page elements
        const hasPrice = !!document.querySelector('.price, [data-price], .product-price');
        const hasAddToCart = !!document.querySelector('.add-to-cart, button[contains="cart"], [data-action="add-to-cart"]');
        const hasProductTitle = !!document.querySelector('.product-title, .product-name, h1.name, .pdp-title');
        
        // Check for site-specific selectors
        const hasSiteSpecificElements = !!document.querySelector(
          '.product-card, .product__title, .product-single, ' +
          '.ProductModule__product, .ProductDetailsMainCard, .pdp-details, ' +
          '.product-info-main, .plp-prod-list, .css-d6ukp1'
        );
        
        return hasSiteSpecificElements || 
               (hasPrice && hasAddToCart) || 
               (hasPrice && hasProductTitle);
      });
    } catch (error) {
      return false;
    }
  }

  async extractLinks(page) {
    try {
      return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(href => href && href.startsWith('http'));
      });
    } catch (error) {
      console.error(`Error extracting links: ${error.message}`);
      return [];
    }
  }

  queueLinks(links, depth) {
    for (const link of links) {
      if (!link) continue;
      
      const normalizedLink = normalizeUrl(link);
      
      // Skip already visited or queued URLs, or URLs from other domains
      if (this.visited.has(normalizedLink) || 
          this.queue.some(item => item.url === normalizedLink) || 
          !isSameDomain(link, this.domain) ||
          shouldExcludeUrl(link)) {
        continue;
      }
      
      // Add to queue with priority based on URL type
      if (isProductUrl(link)) {
        // Product URLs get highest priority (front of queue)
        this.queue.unshift({ url: link, depth });
      } else if (isCategoryUrl(link)) {
        // Category URLs get medium priority (after products but before other URLs)
        this.queue.splice(Math.min(10, this.queue.length), 0, { url: link, depth });
      } else {
        // Other URLs get lowest priority (end of queue)
        this.queue.push({ url: link, depth });
      }
    }
    
    // Limit queue size to prevent memory issues
    if (this.queue.length > 1000) {
      this.queue = this.queue.slice(0, 1000);
    }
  }

  emitProductFound(url) {
    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('product_found', {
        url: url,
        count: this.productLinks.size,
        domain: this.domain
      });
    }
  }

  emitProgress(pagesVisited, total) {
    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('progress_update', {
        domain: this.domain,
        crawled: pagesVisited,
        products: this.productLinks.size,
        queue: this.queue.length
      });
    }
  }

  saveResults() {
    const outputDir = path.resolve(process.cwd(), config.get('outputDir') || './crawled-data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Make sure we have an end time
    if (!this.crawlStats.endTime) {
      this.crawlStats.endTime = new Date();
    }

    // Prepare results data
    const results = {
      domain: this.domain,
      products: Array.from(this.productLinks),
      totalLinks: this.productLinks.size,
      stats: {
        pagesVisited: this.crawlStats.totalPages,
        productsFound: this.crawlStats.totalProducts,
        startTime: this.crawlStats.startTime,
        endTime: this.crawlStats.endTime,
        durationSeconds: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000,
        crawlCompleted: !this.stopRequested
      },
      timestamp: new Date().toISOString()
    };

    // Generate a unique filename with timestamp
    const filename = path.join(outputDir, `${this.domain.replace(/\./g, '_')}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${filename}`);
    
    // If we have event emitter and the crawl was stopped (not completed naturally)
    if (this.events?.io && this.stopRequested) {
      this.events.io.to(this.events.socketId).emit('crawl_stopped', {
        domain: this.domain,
        totalProducts: this.productLinks.size,
        totalPages: this.crawlStats.totalPages,
        filePath: filename,
        duration: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
      });
    }
    
    return filename;
  }
}

module.exports = BaseCrawler;