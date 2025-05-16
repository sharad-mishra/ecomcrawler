// Product URL patterns - Add more patterns for specific sites
const PRODUCT_PATTERNS = [
  // Generic product patterns that work across most sites
  /\/p\/[\w\d-]+/i,           // Common /p/ pattern (Nykaa, Ajio)
  /\/products\/[\w\d-]+/i,     // /products/ pattern (Westside, Virgio)
  /\/product\/[\w\d-]+/i,      // /product/ pattern
  /\/p-mp[\w\d]+/i,            // TataCliq pattern
  /\/[^\/]+\/p-mp[\w\d]+/i,    // Alternative TataCliq pattern
  
  // Site-specific patterns
  /\/[\w\d-]+\/buy$/i,         // Myntra pattern: /numeric-id/buy
  /\/[\w\d]+\/buy/i,           // Myntra alternative pattern
  
  // General common patterns
  /\/pdp\//i,                  // Product detail page
  /\/item\//i,                 // Item pattern
  /\/collections\/[^\/]+\/products\/[^\/]+$/i, // Shopify pattern
  
  // Additional helpful patterns
  /\/[\d]+\/?$/i,              // Ends with numeric ID
  /\/dp\//i,                   // Amazon style
  /\/product-detail\//i,       // Detail pattern
  /\/detail\//i                // Short detail pattern
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
 * Enhanced product URL validator that checks against known e-commerce patterns
 * Works with examples from TataCliq, Westside, NykaaFashion, Virgio, Ajio, and Myntra
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
    
    // Complete URL pattern checks for each site type
    
    // 1. TataCliq: https://www.tatacliq.com/campus-mens-north-plus-dark-grey-running-shoes/p-mp000000008351719
    if (domain.includes('tatacliq.com')) {
      if (url.includes('/p-mp')) return true;
    }
    
    // 2. Westside (Shopify): https://www.westside.com/products/hop-baby-light-taupe-high-rise-denim-shorts-301016143
    if (domain.includes('westside.com')) {
      // Very specific check for Westside
      if (url.includes('/products/')) return true;
      if (url.match(/\/collections\/[^\/]+\/products\//i)) return true;
    }
    
    // 3. NykaaFashion: https://www.nykaafashion.com/mabish-by-sonal-jain-pink-crop-top-with-draped-skirt-and-cape-set-of-3/p/18431713
    if (domain.includes('nykaafashion.com')) {
      // Stricter checking for NykaaFashion - must have /p/ followed by numeric ID
      if (url.match(/\/p\/\d{5,}/)) return true;
    }
    
    // 4. Virgio: https://www.virgio.com/products/boho-west-trucotton-peplum-waist-tie-front-top
    if (domain.includes('virgio.com')) {
      if (url.includes('/products/')) return true;
      if (url.includes('/product/')) return true;
      if (url.includes('/product-detail/')) return true;
    }
    
    // 5. Ajio: https://www.ajio.com/red-tape-men-quilted-regular-fit-puffer-jacket/p/700384757_olive
    if (domain.includes('ajio.com')) {
      if (url.includes('/p/')) return true;
    }
    
    // 6. Myntra: https://www.myntra.com/handbags/caprese/caprese-animal-textured-faux-leather-structured-satchel-bag/30777604/buy
    if (domain.includes('myntra.com')) {
      if (url.endsWith('/buy') || url.includes('/buy?')) return true;
    }
    
    // Generic pattern checks (for all sites)
    
    // Check path segments for product indicators
    try {
      const pathname = new URL(url).pathname;
      
      // Fast pattern matching for common patterns
      const productPatterns = [
        /\/products\/[\w-]+/i,       // Shopify pattern
        /\/product\/[\w-]+/i,         // Common pattern
        /\/p\/[\w-]+\/?\d+/i,         // Pattern with ID
        /\/p-mp[\w\d]+/i,             // TataCliq pattern
        /\/[\w-]+\/p-mp[\w\d]+/i,     // TataCliq alternative
        /\/[\d]+\/buy$/i,             // Myntra pattern
        /\/product-detail\/[\w-]+/i   // Virgio pattern
      ];
      
      for (const pattern of productPatterns) {
        if (pattern.test(pathname)) return true;
      }
      
      // Only check numeric ID if the URL doesn't have common category patterns
      if (!pathname.includes('/category/') && 
          !pathname.includes('/collection') && 
          !pathname.includes('/shop/') &&
          !pathname.includes('/search')) {
        
        // Check numeric ID indicators (very reliable)
        const segments = pathname.split('/').filter(Boolean);
        for (const segment of segments) {
          // If a segment is purely numeric with 5+ digits, probably a product ID
          if (/^\d{5,}$/.test(segment)) return true;
        }
      }
    } catch (e) {
      // URL parsing failed, fall back to simpler checks
    }
    
    // Check URL query parameters often used for products
    try {
      const urlObj = new URL(url);
      const productParams = ['pid', 'productId', 'product_id', 'itemId', 'sku', 'variant'];
      for (const param of productParams) {
        if (urlObj.searchParams.has(param)) return true;
      }
    } catch (e) {
      // URL parsing failed
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

// Change from CommonJS to ES Module exports
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