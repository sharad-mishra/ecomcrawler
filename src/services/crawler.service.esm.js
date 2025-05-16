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

// Define all other functions from crawler.service.js here
// ...

// Export as ES module
export default {
  crawlDomain,
  stopCrawler,
  stopAllCrawlers,
  getActiveCrawler,
  getCrawlResults,
  killBrowserProcess
};
