// This is an ES Module version of the crawler service for proper compatibility

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import config from 'config';
import { isProductUrl, normalizeUrl, isSameDomain } from '../utils/url.utils.js';

// ES Module helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Track active crawlers
const activeCrawlers = new Map();
const crawlerHeartbeats = new Map();
const HEARTBEAT_INTERVAL = 5000; 
const MAX_MISSED_HEARTBEATS = 3;

// Start heartbeat monitoring for all crawlers
const heartbeatChecker = setInterval(() => {
  const now = Date.now();
  
  for (const [domain, crawler] of activeCrawlers.entries()) {
    const lastHeartbeat = crawlerHeartbeats.get(domain) || 0;
    
    if (now - lastHeartbeat > (MAX_MISSED_HEARTBEATS * HEARTBEAT_INTERVAL)) {
      console.warn(`Crawler for ${domain} appears to be stalled, forcing termination`);
      stopCrawler(domain).catch(err => console.error(`Error force stopping crawler: ${err.message}`));
    }
  }
}, HEARTBEAT_INTERVAL);

// Cleanup on exit
process.on('exit', () => {
  clearInterval(heartbeatChecker);
});

// Functions go here - same as in crawler.service.js but with ES Module export at the end

/**
 * Kill browser process forcefully - compatible with ES modules
 */
async function killBrowserProcess(browser) {
  try {
    // Try normal close first
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise(r => setTimeout(r, 500))
    ]);
    
    // If that doesn't work, get the process and kill it
    const browserProcess = browser.process();
    if (browserProcess && browserProcess.pid) {
      const pid = browserProcess.pid;
      console.log(`Force killing browser process PID: ${pid}`);
      
      if (process.platform === 'win32') {
        await execAsync(`taskkill /pid ${pid} /T /F`);
      } else {
        process.kill(pid, 'SIGKILL');
      }
    }
    
    return true;
  } catch (e) {
    console.error(`Error killing browser: ${e.message}`);
    return false;
  }
}

/**
 * Stop a crawler for a specific domain
 */
async function stopCrawler(domain) {
  const crawler = activeCrawlers.get(domain);
  
  if (!crawler) {
    return { message: `No active crawler for ${domain}` };
  }
  
  console.log(`Stopping crawler for ${domain}`);
  
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
        message: 'Crawler has been terminated',
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
      }
    } 
    // Add to queue if not visited and not a product
    else if (!visited.has(normalizedLink)) {
      queue.push(normalizedLink);
    }
  }
  
  return newProductLinks;
}

// Export as ES module
export default {
  crawlDomain,
  stopCrawler,
  stopAllCrawlers,
  getActiveCrawler,
  getCrawlResults,
  killBrowserProcess
};
