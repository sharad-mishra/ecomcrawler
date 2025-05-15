// Product URL patterns
const PRODUCT_PATTERNS = [
  /\/products\//i,
  /\/product\//i, 
  /\/p\//i, 
  /\/item\//i,
  /\/p-mp/i,
  /\/pdp\//i
];

// Category patterns
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
 * Fast check if URL is a product page
 */
function isProductUrl(url) {
  try {
    const { pathname } = new URL(url);
    // Fast loop instead of .some()
    for (let i = 0; i < PRODUCT_PATTERNS.length; i++) {
      if (PRODUCT_PATTERNS[i].test(pathname)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fast check if URL is a category page
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
 * Fast check if URL should be excluded
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
 * Optimized URL normalization
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
 * Get starting point for crawling
 */
function getStartingPoints(domain) {
  try {
    const url = new URL(domain);
    return [url.origin];
  } catch {
    return [`https://www.${domain.replace(/^www\./, '')}`];
  }
}

/**
 * Optimized domain matching
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
 * Get normalized domain from URL
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