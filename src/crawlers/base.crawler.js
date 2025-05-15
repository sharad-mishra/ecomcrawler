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
    this.stopRequested = true;
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
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

    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('crawl_start', {
        domain: this.domain,
        timestamp: new Date().toISOString()
      });
    }

    let pagesVisited = 0;
    let estimatedTotal = Math.min(this.maxPages, this.queue.length * 20);

    while (this.queue.length > 0 && pagesVisited < this.maxPages && !this.stopRequested) {
      // Get next URL from queue
      const { url, depth } = this.queue.shift();
      const normalizedUrl = normalizeUrl(url);
      
      // Skip already visited URLs and respect max depth
      if (this.visited.has(normalizedUrl) || depth > this.maxDepth) continue;
      
      try {
        // Mark as visited before processing
        this.visited.add(normalizedUrl);
        
        const page = await this.browser.newPage();
        await this.setupPage(page);
        
        console.log(`Visiting [${pagesVisited+1}/${this.maxPages}]: ${url} (depth: ${depth})`);
        
        // Navigate to the URL
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 30000 
        });
        
        // Simple wait after page load
        await page.waitForTimeout(2000);
        
        // Get current URL (after possible redirects)
        const currentUrl = page.url();
        
        // Scroll to load lazy content
        await this.scrollPage(page);
        
        // Try to click load more button
        await this.clickLoadMoreButton(page);
        
        // Check if it's a product page
        let isProduct = isProductUrl(currentUrl);
        
        // If not detected by URL pattern, check using DOM elements
        if (!isProduct) {
          isProduct = await this.isProductPageByDOM(page);
        }
        
        if (isProduct) {
          this.productLinks.add(normalizeUrl(currentUrl));
          this.crawlStats.totalProducts = this.productLinks.size;
          this.emitProductFound(normalizeUrl(currentUrl));
          console.log(`Product found: ${currentUrl}`);
        }
        
        // Extract links from the page
        const links = await this.extractLinks(page);
        
        // Queue new links if not at max depth
        if (depth < this.maxDepth) {
          this.queueLinks(links, depth + 1);
        }
        
        // Close page to free memory
        await page.close();
        
        // Update stats
        pagesVisited++;
        this.crawlStats.totalPages = pagesVisited;
        
        // Update progress
        this.emitProgress(pagesVisited, estimatedTotal);
      } catch (error) {
        console.error(`Failed to process ${url}: ${error.message}`);
        this.failedUrls.add(url);
      }
    }
    
    this.crawlStats.endTime = new Date();
    
    // Emit completion event
    if (this.events?.io) {
      const resultFile = await this.saveResults();
      this.events.io.to(this.events.socketId).emit('crawl_complete', {
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
      // Simple page scrolling
      for (let i = 0; i < 3; i++) {
        await page.evaluate(`window.scrollTo(0, ${(i + 1) * document.body.scrollHeight / 3})`);
        await page.waitForTimeout(500);
      }
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
        total: total || this.maxPages,
        products: this.productLinks.size,
        queue: this.queue.length
      });
    }
  }

  saveResults() {
    const outputDir = path.resolve(process.cwd(), config.get('outputDir') || './crawled-data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const results = {
      domain: this.domain,
      products: Array.from(this.productLinks),
      totalLinks: this.productLinks.size,
      stats: {
        pagesVisited: this.crawlStats.totalPages,
        productsFound: this.crawlStats.totalProducts,
        startTime: this.crawlStats.startTime,
        endTime: this.crawlStats.endTime,
        durationSeconds: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
      },
      timestamp: new Date().toISOString()
    };

    const filename = path.join(outputDir, `${this.domain.replace(/\./g, '_')}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${filename}`);
    return filename;
  }
}

module.exports = BaseCrawler;