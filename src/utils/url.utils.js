// Simple patterns matching web-crawler approach
const PRODUCT_PATTERNS = [
  /\/products\//i,
  /\/product\//i, 
  /\/p\//i, 
  /\/item\//i,
  /\/p-mp/i,
  /\/pdp\//i
];

// Simple category patterns
const CATEGORY_PATTERNS = [
  /\/collections\//i,
  /\/c-/i,
  /\/c\//i,
  /\/category\//i,
  /\/(men|women|kids)(\/|$)/i
];

// Exclude patterns
const EXCLUDE_PATTERNS = [
  /\.(jpg|jpeg|png|gif|css|js|ico|svg|webp|pdf)($|\?)/i,
  /\/(cart|checkout|login|register|account|track|help|search)/i,
  /\/(api|graphql|rest|cdn|static)/i,
  /\?(utm_|fbclid|gclid|source|ref)/i,
  /#.*$/,
  /^(mailto|tel|javascript):/i
];

/**
 * Simple product URL detection just like web-crawler
 */
function isProductUrl(url) {
  try {
    const { pathname } = new URL(url);
    return PRODUCT_PATTERNS.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

/**
 * Simple category URL detection
 */
function isCategoryUrl(url) {
  try {
    const { pathname } = new URL(url);
    return CATEGORY_PATTERNS.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

/**
 * Exclude certain types of URLs
 */
function shouldExcludeUrl(url) {
  if (isProductUrl(url)) return false;
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Normalize a URL by removing tracking parameters and standardizing format
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Remove tracking parameters
    const params = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      if (!/(utm_|ref|source|track)/i.test(key)) {
        params.set(key, value);
      }
    });
    
    // Standardize path
    let path = parsed.pathname
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
    
    // Rebuild URL
    parsed.search = params.toString();
    parsed.hash = '';
    parsed.pathname = path;
    
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Get starting point - just homepage like in web-crawler
 */
function getStartingPoints(domain) {
  try {
    const url = new URL(domain);
    return [url.origin]; // Just the homepage, no specialized seeds
  } catch {
    if (!domain.includes('://')) {
      return [`https://www.${domain.replace(/^www\./, '')}`];
    }
    return [domain];
  }
}

/**
 * Check if URL is from the same domain
 */
function isSameDomain(url, baseDomain) {
  try {
    const urlObj = new URL(url);
    const baseObj = baseDomain.includes('://') ? 
      new URL(baseDomain) : 
      new URL(`https://${baseDomain}`);
    
    const urlHost = urlObj.hostname.replace(/^www\./, '');
    const baseHost = baseObj.hostname.replace(/^www\./, '');
    
    return urlHost === baseHost || urlHost.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

/**
 * Get normalized domain from URL
 */
function getNormalizedDomain(url) {
  try {
    if (!url) return '';
    
    const domain = url.includes('://') ? url : `https://${url}`;
    const { hostname } = new URL(domain);
    return hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
}

module.exports = {
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