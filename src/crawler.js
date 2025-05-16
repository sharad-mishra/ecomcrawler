import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import config from 'config';
import { isProductUrl, normalizeUrl, getStartingPoints } from './utils/url.utils.js';

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
  const { domainName, loadButtonClassName, loadButtonInnerText } = domainInfo;
  
  // Get proper starting URL
  const startingUrls = getStartingPoints(domainName);
  const startUrl = startingUrls[0];
  
  if (onUpdate) onUpdate({ 
    domain: domainName, 
    status: `Launching browser`, 
    type: 'info' 
  });

  // Launch browser
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const visited = new Set();
  const queue = [...startingUrls];
  const productUrls = new Set();
  const failedUrls = new Set();
  
  if (onUpdate) onUpdate({ 
    domain: domainName, 
    status: `Starting crawl from ${startUrl}`, 
    type: 'info' 
  });

  try {
    while (queue.length > 0) {
      const url = queue.shift();
      const normalizedUrl = normalizeUrl(url);
      
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);
      
      if (onUpdate) onUpdate({ 
        domain: domainName, 
        status: `Visiting: ${normalizedUrl}`,
        type: 'info'
      });
      
      try {
        await page.goto(normalizedUrl, { 
          waitUntil: "networkidle2", 
          timeout: 30000 
        });
        
        // Check for lazy loading
        const isLazyLoading = await page.evaluate(() => {
          return !!document.querySelector('img[loading="lazy"]') || 
                 !!document.querySelector("[data-lazy]");
        });

        if (isLazyLoading) {
          if (onUpdate) onUpdate({ 
            domain: domainName, 
            status: `Lazy loading detected on ${normalizedUrl}, scrolling...`,
            type: 'info'
          });
          await scrollToLoadMore(page, domainName, onUpdate);
        }

        // Check for "Load More" button
        if (loadButtonClassName) {
          const loadMoreButton = await page.$(loadButtonClassName);
          if (loadMoreButton) {
            if (onUpdate) onUpdate({ 
              domain: domainName, 
              status: `Load More button detected on ${normalizedUrl}, clicking...`,
              type: 'info'
            });
            await clickLoadMoreButton(page, loadButtonClassName, loadButtonInnerText);
          }
        }
        
        // Extract links
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"), (a) => a.href)
        );
        
        if (onUpdate) onUpdate({ 
          domain: domainName, 
          status: `Found ${links.length} links on ${normalizedUrl}`,
          type: 'info'
        });

        for (const link of links) {
          const normalizedLink = normalizeUrl(link);
          
          if (isProductUrl(normalizedLink)) {
            if (!productUrls.has(normalizedLink)) {
              productUrls.add(normalizedLink);
              
              // Emit event for each new product URL found
              if (onUpdate) onUpdate({ 
                type: 'product',
                domain: domainName, 
                url: normalizedLink
              });
              
              // Also emit specific product found event if callback exists
              if (typeof onProductFound === 'function') {
                onProductFound({
                  domain: domainName,
                  url: normalizedLink
                });
              }
            }
          } else if (!visited.has(normalizedLink) && normalizedLink.includes(domainName)) {
            queue.push(normalizedLink);
          }
        }
        
        if (onUpdate) onUpdate({ 
          domain: domainName, 
          status: `Found ${productUrls.size} product URLs so far`,
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
  } finally {
    await browser.close();
    
    if (onUpdate) onUpdate({ 
      domain: domainName, 
      status: `Completed. Found ${productUrls.size} product URLs.`,
      type: 'success'
    });
  }

  return {
    domainName,
    productUrls: Array.from(productUrls),
    failedUrls: Array.from(failedUrls),
  };
}

// Scroll function for lazy loading pages
async function scrollToLoadMore(page, domain, onUpdate) {
  const maxScrollAttempts = config.get('maxScrollAttempts') || 10;
  let previousHeight;
  
  try {
    previousHeight = await page.evaluate("document.body.scrollHeight");
    let scrollCount = 0;
    
    while (scrollCount++ < maxScrollAttempts) {
      if (onUpdate) onUpdate({ 
        domain, 
        status: `Scroll #${scrollCount}/${maxScrollAttempts}`,
        type: 'info'
      });
      
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      const newHeight = await page.evaluate("document.body.scrollHeight");
      if (newHeight === previousHeight) break;
      previousHeight = newHeight;
    }
    
    if (scrollCount >= maxScrollAttempts) {
      if (onUpdate) onUpdate({ 
        domain, 
        status: `Reached max scroll attempts`,
        type: 'warning'
      });
    }
  } catch (error) {
    if (onUpdate) onUpdate({ 
      domain, 
      status: `Error during scroll: ${error.message}`,
      type: 'error'
    });
  }
}

// Click "Load More" button
async function clickLoadMoreButton(page, selector, loadButtonInnerText) {
  const maxScrollAttempts = config.get('maxScrollAttempts') || 10;
  
  try {
    let clickCount = 0;

    while (clickCount++ < maxScrollAttempts) {
      const button = await page.$(selector);
      if (!button) break;
      
      if (loadButtonInnerText) {
        const buttonInnerText = await page.evaluate(
          (button) => button.innerText,
          button
        );
        
        if (buttonInnerText !== loadButtonInnerText) break;
      }
      
      await button.evaluate(b => b.scrollIntoView({ behavior: "smooth", block: "center" }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      await button.click();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error("Error while clicking 'Load More' button:", error);
  }
}
