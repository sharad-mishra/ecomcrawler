const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { isProductUrl, isCategoryUrl, normalizeUrl, shouldExcludeUrl, isSameDomain, getStartingPoints } = require('../utils/url.utils');
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
    this.maxPages = options.indefiniteCrawling ? Infinity : (options.maxPages || 200);
    this.startingPoints = getStartingPoints(domain.includes('://') ? domain : `https://www.${domain}`);
    this.events = null;
    this.crawlStats = { startTime: null, endTime: null, totalPages: 0, totalProducts: 0 };
    this.stopRequested = false;
  }

  setEventEmitter(io, socketId) { this.events = { io, socketId }; }

  async init() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }

  async close() {
    console.log(`Closing crawler for ${this.domain}`);
    this.stopRequested = true;
    
    if (this.crawlStats.startTime && !this.crawlStats.endTime) {
      this.crawlStats.endTime = new Date();
      await this.saveResults();
    }
    
    if (this.browser) {
      try {
        // Close pages and browser
        const pages = await this.browser.pages();
        await Promise.all(pages.map(p => p.close().catch(() => {})));
        await this.browser.close().catch(err => console.log(`Error closing browser: ${err.message}`));
      } catch (error) {
        console.error(`Error closing browser: ${error.message}`);
      } finally {
        this.browser = null;
        this.visited.clear();
        this.queue = [];
        this.failedUrls.clear();
      }
    }
  }

  async crawl() {
    console.log(`Starting crawl for ${this.domain}`);
    console.log(`Crawl mode: ${this.maxPages === Infinity ? 'Indefinite' : `Limited to ${this.maxPages} pages`}`);
    this.crawlStats.startTime = new Date();
    
    // Initialize crawl state
    this.queue = this.startingPoints;
    this.visited.clear();
    this.productLinks.clear();
    this.failedUrls.clear();
    this.stopRequested = false;

    // Emit start event
    this.events?.io?.to(this.events.socketId).emit('crawl_start', {
      domain: this.domain,
      timestamp: new Date().toISOString()
    });

    // Crawl tracking variables
    let pagesVisited = 0;
    let noNewProductsCounter = 0;
    const MAX_NO_PRODUCT_PAGES = 20;
    
    // Setup browser page
    const page = await this.browser.newPage();
    await this.setupPage(page);
    
    // Main crawl loop
    while (this.queue.length > 0 && 
           pagesVisited < this.maxPages && 
           !this.stopRequested && 
           (this.maxPages !== Infinity || noNewProductsCounter < MAX_NO_PRODUCT_PAGES)) {
      
      const url = this.queue.shift();
      const normalizedUrl = normalizeUrl(url);
      
      if (this.visited.has(normalizedUrl)) continue;
      
      try {
        this.visited.add(normalizedUrl);
        console.log(`Visiting [${pagesVisited+1}/${this.maxPages === Infinity ? 'Unlimited' : this.maxPages}]: ${url}`);
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const currentUrl = page.url();
        const productCountBefore = this.productLinks.size;
        
        // Process product page
        if (isProductUrl(currentUrl)) {
          this.productLinks.add(normalizeUrl(currentUrl));
          this.crawlStats.totalProducts = this.productLinks.size;
          this.emitProductFound(normalizeUrl(currentUrl));
        }
        
        // Handle lazy loading & load more buttons
        const hasLazyLoading = await page.evaluate(() => 
          !!document.querySelector('img[loading="lazy"]') || !!document.querySelector('[data-lazy]')
        );
        if (hasLazyLoading) await this.scrollPage(page);
        await this.clickLoadMoreButton(page);
        
        // Extract and process links
        const links = await page.evaluate(() => 
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(href => href && href.startsWith('http'))
        );
        
        for (const link of links) {
          const normalizedLink = normalizeUrl(link);
          if (!this.visited.has(normalizedLink) && 
              !this.queue.includes(normalizedLink) &&
              isSameDomain(link, this.domain) &&
              !shouldExcludeUrl(link)) {
            // Prioritize certain URLs
            if (isProductUrl(normalizedLink)) {
              this.productLinks.add(normalizedLink);
              this.crawlStats.totalProducts = this.productLinks.size;
              this.emitProductFound(normalizedLink);
              console.log(`Product found: ${normalizedLink}`);
            } else if (isCategoryUrl(normalizedLink)) {
              this.queue.unshift(normalizedLink); // Categories at front
            } else {
              this.queue.push(normalizedLink);
            }
          }
        }
        
        // Update stats
        this.productLinks.size > productCountBefore ? (noNewProductsCounter = 0) : noNewProductsCounter++;
        pagesVisited++;
        this.crawlStats.totalPages = pagesVisited;
        this.emitProgress(pagesVisited);
        
      } catch (error) {
        console.error(`Failed to process ${url}: ${error.message}`);
        this.failedUrls.add(url);
      }
    }
    
    // Finalize crawl
    this.crawlStats.endTime = new Date();
    const resultFile = await this.saveResults();
    
    console.log(`Crawl completed for ${this.domain} - Found ${this.productLinks.size} products from ${pagesVisited} pages`);
    
    // Emit completion
    this.events?.io?.to(this.events.socketId).emit('crawl_complete', {
      domain: this.domain,
      totalProducts: this.productLinks.size,
      totalPages: pagesVisited,
      filePath: resultFile,
      duration: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
    });

    return resultFile;
  }

  // Helper methods - simplified but functionality preserved
  async setupPage(page) {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || 
                             req.resourceType() === 'font' || req.resourceType() === 'media' ? 
                             req.abort() : req.continue());
    page.setDefaultNavigationTimeout(30000);
  }

  async scrollPage(page) {
    try {
      let previousHeight = await page.evaluate('document.body.scrollHeight');
      for (let i = 0; i < 10; i++) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(1000);
        const newHeight = await page.evaluate('document.body.scrollHeight');
        if (newHeight === previousHeight) break;
        previousHeight = newHeight;
      }
    } catch (error) { console.log(`Error scrolling: ${error.message}`); }
  }

  async clickLoadMoreButton(page) {
    const selectors = ['.load-more', '.more-products', '.view-more', 'button:contains("Load More")', 
                     'button:contains("Show More")', '[class*="loadMore"]', '[class*="LoadMore"]'];
    for (const selector of selectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          if (!(await button.isIntersectingViewport())) {
            await button.evaluate(btn => btn.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await page.waitForTimeout(1000);
          }
          await button.click();
          await page.waitForTimeout(2000);
          await this.scrollPage(page);
          break;
        }
      } catch {}
    }
  }

  // Event emission methods
  emitProductFound(url) {
    this.events?.io?.to(this.events.socketId).emit('product_found', {
      url, count: this.productLinks.size, domain: this.domain
    });
  }

  emitProgress(pagesVisited) {
    this.events?.io?.to(this.events.socketId).emit('progress_update', {
      domain: this.domain,
      crawled: pagesVisited,
      products: this.productLinks.size,
      queue: this.queue.length
    });
  }

  saveResults() {
    const outputDir = path.resolve(process.cwd(), config.get('outputDir') || './crawled-data');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    this.crawlStats.endTime = this.crawlStats.endTime || new Date();
    
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

    const filename = path.join(outputDir, `${this.domain.replace(/\./g, '_')}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    
    if (this.events?.io && this.stopRequested) {
      this.events.io.to(this.events.socketId).emit('crawl_stopped', {
        domain: this.domain, totalProducts: this.productLinks.size,
        totalPages: this.crawlStats.totalPages, filePath: filename,
        duration: (this.crawlStats.endTime - this.crawlStats.startTime) / 1000
      });
    }
    
    return filename;
  }
}

module.exports = BaseCrawler;