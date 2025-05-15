/**
 * Utility functions for optimizing crawler performance
 */

const config = require('config');

/**
 * Initialize performance metrics
 * @returns {Object} Performance metrics object
 */
function initPerformanceMetrics() {
  return {
    startTime: Date.now(),
    pagesVisited: 0,
    pagesPerSecond: 0,
    pageLoadTimes: [],
    resourcesBlocked: 0,
    errors: 0,
    memoryUsage: process.memoryUsage()
  };
}

/**
 * Update performance metrics
 * @param {Object} metrics - Metrics object to update
 * @param {Object} data - New data to include
 * @returns {Object} Updated metrics
 */
function updateMetrics(metrics, data) {
  const updatedMetrics = { ...metrics };
  
  if (data.pageLoaded) {
    updatedMetrics.pagesVisited++;
    updatedMetrics.pageLoadTimes.push(data.loadTime || 0);
    
    // Calculate pages per second
    const elapsedSeconds = (Date.now() - metrics.startTime) / 1000;
    if (elapsedSeconds > 0) {
      updatedMetrics.pagesPerSecond = updatedMetrics.pagesVisited / elapsedSeconds;
    }
  }
  
  if (data.resourceBlocked) {
    updatedMetrics.resourcesBlocked++;
  }
  
  if (data.error) {
    updatedMetrics.errors++;
  }
  
  // Update memory usage every 10 page loads
  if (updatedMetrics.pagesVisited % 10 === 0) {
    updatedMetrics.memoryUsage = process.memoryUsage();
  }
  
  return updatedMetrics;
}

/**
 * Get performance report from metrics
 * @param {Object} metrics - Performance metrics
 * @returns {Object} Performance report
 */
function getPerformanceReport(metrics) {
  const elapsedSeconds = (Date.now() - metrics.startTime) / 1000;
  const avgLoadTime = metrics.pageLoadTimes.length > 0 
    ? metrics.pageLoadTimes.reduce((sum, time) => sum + time, 0) / metrics.pageLoadTimes.length 
    : 0;
  
  return {
    totalPages: metrics.pagesVisited,
    duration: elapsedSeconds,
    pagesPerSecond: metrics.pagesPerSecond,
    averageLoadTime: avgLoadTime,
    resourcesBlocked: metrics.resourcesBlocked,
    errors: metrics.errors,
    memoryUsage: {
      rss: Math.round(metrics.memoryUsage.rss / 1024 / 1024) + "MB",
      heapTotal: Math.round(metrics.memoryUsage.heapTotal / 1024 / 1024) + "MB",
      heapUsed: Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024) + "MB"
    }
  };
}

/**
 * Setup page optimizations for performance
 * @param {Page} page - Puppeteer page object
 */
async function optimizePage(page) {
  const perfSettings = config.get('performance') || {};
  
  // Enable or disable cache
  await page.setCacheEnabled(perfSettings.useCache !== false);
  
  // Set default timeouts
  if (perfSettings.navigationTimeout) {
    page.setDefaultNavigationTimeout(perfSettings.navigationTimeout);
  }
  
  if (perfSettings.waitForSelector) {
    page.setDefaultTimeout(perfSettings.waitForSelector);
  }
  
  // Disable JavaScript animations
  await page.evaluateOnNewDocument(() => {
    // Override requestAnimationFrame
    window.requestAnimationFrame = callback => setTimeout(callback, 0);
    
    // Override CSS animations and transitions
    if (window.CSSStyleDeclaration) {
      window.CSSStyleDeclaration.prototype.setProperty = function(name, value) {
        if (name.includes('animation') || name.includes('transition')) {
          arguments[1] = 'none';
        }
        return Object.getPrototypeOf(this).setProperty.apply(this, arguments);
      };
    }
  });
}

module.exports = {
  initPerformanceMetrics,
  updateMetrics,
  getPerformanceReport,
  optimizePage
};
