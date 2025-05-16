/**
 * URL utility functions for E-commerce crawler
 * 
 * This module provides utility functions to detect and process URLs for the crawler.
 * It contains patterns and functions to identify product pages, category pages, and
 * exclude unwanted URLs.
 * 
 * Supported websites:
 * - virgio.com
 * - westside.com
 * - tatacliq.com
 * - nykaafashion.com
 * 
 * To add support for additional websites:
 * 1. Extend the PRODUCT_PATTERNS array with the site's product URL patterns
 * 2. Add site-specific logic to isProductUrl() function
 * 3. Update getStartingPoints() if needed for new site structure
 */

// Product URL patterns - focused on supported sites
const PRODUCT_PATTERNS = [
  // Generic product patterns
  /\/p\/[\w\d-]+/i,           // Common /p/ pattern (Nykaa)
  /\/products\/[\w\d-]+/i,     // /products/ pattern (Westside, Virgio)
  /\/product\/[\w\d-]+/i,      // /product/ pattern
  /\/p-mp[\w\d]+/i,            // TataCliq pattern
  /\/[^\/]+\/p-mp[\w\d]+/i,    // Alternative TataCliq pattern
  
  // Common patterns across e-commerce platforms
  /\/pdp\//i,                  // Product detail page
  /\/item\//i,                 // Item pattern
  /\/collections\/[^\/]+\/products\/[^\/]+$/i, // Shopify pattern
  /\/product-detail\//i,       // Detail pattern
  /\/detail\//i                // Short detail pattern
];

// Category patterns
const CATEGORY_PATTERNS = [
  /\/collections\//i,
  /\/c-/i,
  /\/c\//i,
  /\/category\//i
];

// Exclude patterns - URLs we want to skip
const EXCLUDE_PATTERNS = [
  /\.(jpg|jpeg|png|gif|css|js|ico|svg|webp|pdf)($|\?)/i,
  /\/(cart|checkout|login|register|account|track|help|search)/i,
  /\/(api|graphql|rest|cdn|static)/i,
  /\?(utm_|fbclid|gclid|source|ref)/i,
  /#.*$/,
  /^(mailto|tel|javascript):/i
];

/**
 * Identifies if a URL is a product page
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is a product page
 * 
 * How to add support for a new website:
 * 1. Add a new conditional block for your domain with specific patterns
 * 2. Test with examples to ensure it correctly identifies product pages
 */
function isProductUrl(url) {
  try {
    if (!url || typeof url !== 'string') return false;
    
    // Normalize URL for comparison
    url = url.toLowerCase();
    
    // Extract domain for site-specific checks
    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      // If URL parsing fails, try a simpler approach
      const match = url.match(/https?:\/\/([^\/]+)/i);
      domain = match ? match[1] : '';
    }
    
    // Site-specific checks for supported platforms
    
    // 1. TataCliq: https://www.tatacliq.com/product-name/p-mp000000008351719
    if (domain.includes('tatacliq.com')) {
      if (url.includes('/p-mp')) return true;
    }
    
    // 2. Westside (Shopify): https://www.westside.com/products/product-name-301016143
    if (domain.includes('westside.com')) {
      if (url.includes('/products/')) return true;
      if (url.match(/\/collections\/[^\/]+\/products\//i)) return true;
    }
    
    // 3. NykaaFashion: https://www.nykaafashion.com/product-name/p/18431713
    if (domain.includes('nykaafashion.com')) {
      // Stricter checking for NykaaFashion - must have /p/ followed by numeric ID
      if (url.match(/\/p\/\d{5,}/)) return true;
    }
    
    // 4. Virgio: https://www.virgio.com/products/product-name
    if (domain.includes('virgio.com')) {
      if (url.includes('/products/')) return true;
      if (url.includes('/product/')) return true;
      if (url.includes('/product-detail/')) return true;
    }
    
    // Generic pattern checks (for all sites)
    try {
      const pathname = new URL(url).pathname;
      
      // Fast pattern matching for common patterns
      for (const pattern of PRODUCT_PATTERNS) {
        if (pattern.test(pathname)) return true;
      }
      
      // Check numeric ID indicators (avoid false positives)
      if (!pathname.includes('/category/') && 
          !pathname.includes('/collection') && 
          !pathname.includes('/shop/') &&
          !pathname.includes('/search')) {
        
        // Check for numeric ID patterns (common in product URLs)
        const segments = pathname.split('/').filter(Boolean);
        for (const segment of segments) {
          // If a segment is purely numeric with 5+ digits, probably a product ID
          if (/^\d{5,}$/.test(segment)) return true;
        }
      }
    } catch (e) {
      // URL parsing failed, fall back to simpler checks
    }
    
    // If nothing matched, it's probably not a product URL
    return false;
  } catch (error) {
    console.error(`Error in isProductUrl: ${error.message}`);
    return false;
  }
}

/**
 * Fast check if URL is a category page
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is a category page
 */
function isCategoryUrl(url) {
  try {
    const { pathname } = new URL(url);
    // Fast loop instead of .some()
    for (let i = 0; i < CATEGORY_PATTERNS.length; i++) {
      if (CATEGORY_PATTERNS[i].test(pathname)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if a URL should be excluded from crawling
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL should be excluded
 */
function shouldExcludeUrl(url) {
  if (isProductUrl(url)) return false;
  // Fast loop instead of .some()
  for (let i = 0; i < EXCLUDE_PATTERNS.length; i++) {
    if (EXCLUDE_PATTERNS[i].test(url)) return true;
  }
  return false;
}

/**
 * Normalizes a URL by removing query parameters and fragments
 * 
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Clear search params (faster than filtering)
    parsed.search = '';
    parsed.hash = '';
    
    // Standardize path
    parsed.pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/$/, '');
    
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Gets the starting points for crawling a domain
 * 
 * @param {string} domain - The domain to get starting points for
 * @returns {string[]} - Array of starting URLs
 */
function getStartingPoints(domain) {
  try {
    // Check if domain already has protocol
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      // Add protocol if missing
      domain = 'https://' + domain;
    }
    
    // Parse URL to standardize it
    const url = new URL(domain);
    
    // Check if www is missing and should be added
    if (!url.hostname.startsWith('www.') && 
        !url.hostname.startsWith('luxury.') && 
        !url.hostname.startsWith('shop.')) {
      return [`https://www.${url.hostname}${url.pathname}`];
    }
    
    return [url.toString()];
  } catch (error) {
    // Fallback for malformed URLs
    if (!domain.startsWith('http')) {
      domain = 'https://www.' + domain.replace(/^www\./, '');
    }
    return [domain];
  }
}

/**
 * Checks if a URL belongs to the same domain as the base domain
 * 
 * @param {string} url - The URL to check
 * @param {string} baseDomain - The base domain to check against
 * @returns {boolean} - True if the URL belongs to the same domain
 */
function isSameDomain(url, baseDomain) {
  try {
    // Direct string check for better performance with TataCliq
    if (baseDomain.includes('tatacliq.com') && url.includes('luxury.tatacliq.com')) {
      return false;
    }
    
    const urlHost = new URL(url).hostname.replace(/^www\./, '');
    const baseHost = new URL(baseDomain.includes('://') ? baseDomain : `https://${baseDomain}`).hostname.replace(/^www\./, '');
    return urlHost === baseHost || urlHost.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

/**
 * Gets a normalized domain from a URL
 * 
 * @param {string} url - The URL to get the domain from
 * @returns {string} - The normalized domain
 */
function getNormalizedDomain(url) {
  try {
    if (!url) return '';
    const domain = url.includes('://') ? url : `https://${url}`;
    return new URL(domain).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
}

// Export functions
export {
  isProductUrl,
  isCategoryUrl,
  shouldExcludeUrl,
  normalizeUrl,
  getStartingPoints,
  isSameDomain,
  getNormalizedDomain,
  PRODUCT_PATTERNS,
  CATEGORY_PATTERNS,
  EXCLUDE_PATTERNS
};