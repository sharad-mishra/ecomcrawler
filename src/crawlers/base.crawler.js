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
  constructor(domain, options = {}) {
    this.domain = domain;
    this.browser = null;
    this.visited = new Set();
    this.productLinks = new Set();
    this.queue = [];
    this.failedUrls = new Set();
    
    // Only support maxPages from options, handle other parameters internally
    this.maxPages = options.maxPages || 200;
    
    // Get single homepage as starting point - just like web-crawler
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
    this.queue = this.startingPoints.map(url => ({ url }));
    this.visited.clear();
    this.productLinks.clear();
    this.failedUrls.clear();
    this.stopRequested = false;

    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('crawl_start', {
        domain: this.domain,
        timestamp: new Date().toISOString()
      });
    }

    let pagesVisited = 0;
    
    // Simple BFS approach like web-crawler - no phases
    while (this.queue.length > 0 && pagesVisited < this.maxPages && !this.stopRequested) {
      const { url } = this.queue.shift();
      const normalizedUrl = normalizeUrl(url);
      
      // Skip already visited URLs
      if (this.visited.has(normalizedUrl)) continue;
      
      try {
        // Mark as visited before processing
        this.visited.add(normalizedUrl);
        
        const page = await this.browser.newPage();
        await this.setupPage(page);
        
        console.log(`Visiting [${pagesVisited+1}/${this.maxPages}]: ${url}`);
        
        // Navigate to the URL with reasonable timeout
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 30000 
        });
        
        // Get current URL (after possible redirects)
        const currentUrl = page.url();
        
        // Check if it's a product page
        if (isProductUrl(currentUrl)) {
          this.productLinks.add(normalizeUrl(currentUrl));
          this.crawlStats.totalProducts = this.productLinks.size;
          this.emitProductFound(normalizeUrl(currentUrl));
          console.log(`Product found: ${currentUrl}`);
        }
        
        // Handle lazy loading content - like in web-crawler
        const hasLazyLoading = await page.evaluate(() => {
          return !!document.querySelector('img[loading="lazy"]') || 
                 !!document.querySelector('[data-lazy]');
        });
        
        if (hasLazyLoading) {
          console.log("Lazy loading detected, scrolling to load more content");
          await this.scrollPage(page);
        }
        
        // Look for "Load More" buttons and click them - like in web-crawler
        await this.clickLoadMoreButton(page);
        
        // Extract all links - just like web-crawler
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
        });
        
        // Add links to queue - simple approach from web-crawler
        for (const link of links) {
          const normalizedLink = normalizeUrl(link);
          if (!this.visited.has(normalizedLink) && 
              !this.queue.some(item => item.url === normalizedLink) &&
              isSameDomain(link, this.domain) &&
              !shouldExcludeUrl(link)) {
            
            // If it's a product URL, prioritize it by adding to front of queue
            if (isProductUrl(link)) {
              this.queue.unshift({ url: link });
            } else {
              this.queue.push({ url: link });
            }
          }
        }
        
        // Close page to free memory
        await page.close();
        
        // Update stats
        pagesVisited++;
        this.crawlStats.totalPages = pagesVisited;
        
        // Update progress
        this.emitProgress(pagesVisited, this.maxPages);
        
      } catch (error) {
        console.error(`Failed to process ${url}: ${error.message}`);
        this.failedUrls.add(url);
      }
    }
    
    // Save results
    this.crawlStats.endTime = new Date();
    const resultFile = await this.saveResults();
    
    console.log(`Crawl completed for ${this.domain}`);
    console.log(`Found ${this.productLinks.size} products from ${pagesVisited} pages`);
    
    // Emit completion event
    if (this.events?.io) {
      this.events.io.to(this.events.socketId).emit('crawl_complete', {
        domain: this.domain,
        totalProducts: this.productLinks.size,
        totalPages: pagesVisited,
        filePath: resultFile,
        duration: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
      });
    }

    return resultFile;
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
      // Scroll like in web-crawler
      let previousHeight;
      let scrollAttempts = 0;
      const maxScrollAttempts = 10;
      
      previousHeight = await page.evaluate('document.body.scrollHeight');
      
      while (scrollAttempts++ < maxScrollAttempts) {
        console.log(`Scroll attempt #${scrollAttempts}, scrolling to bottom...`);
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(1000);
        
        const newHeight = await page.evaluate('document.body.scrollHeight');
        if (newHeight === previousHeight) break;
        previousHeight = newHeight;
      }
    } catch (error) {
      console.log(`Error during scrolling: ${error.message}`);
    }
  }

  async clickLoadMoreButton(page) {
    try {
      // Common load more button selectors - similar to web-crawler
      const loadMoreSelectors = [
        '.load-more', '.more-products', '.view-more', 
        'button:contains("Load More")', 'button:contains("Show More")',
        '[class*="loadMore"]', '[class*="LoadMore"]',
        '.Button-sc-1antbdu-0', '.collection-load-more', '.css-1q7tqyw'
      ];
      
      // Try each selector - like in web-crawler
      for (const selector of loadMoreSelectors) {
        try {
          const buttonExists = await page.$(selector);
          if (buttonExists) {
            const isVisible = await buttonExists.isIntersectingViewport();
            if (!isVisible) {
              await buttonExists.evaluate(button => 
                button.scrollIntoView({ behavior: 'smooth', block: 'center' })
              );
              await page.waitForTimeout(1000);
            }
            
            console.log(`Clicking ${selector} button`);
            await buttonExists.click();
            await page.waitForTimeout(2000);
            await this.scrollPage(page);
            break;
          }
        } catch (e) {
          // Ignore errors with specific selectors
        }
      }
    } catch (error) {
      console.log(`Error clicking load more: ${error.message}`);
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