/**
 * URL utility functions for E-commerce crawler
 * 
 * Contains patterns and functions to identify product pages, category pages,
 * and exclude unwanted URLs.
 */

// Product URL patterns for supported sites
const PRODUCT_PATTERNS = [
  // Generic product patterns
  /\/p\/[\w\d-]+/i,           
  /\/products\/[\w\d-]+/i,     // /products/ pattern (Westside, Virgio)
  /\/product\/[\w\d-]+/i,      // /product/ pattern
  /\/p-mp[\w\d]+/i,            // TataCliq pattern
  /\/[^\/]+\/p-mp[\w\d]+/i,    
  /\/pdp\//i,                  
  /\/item\//i,                 // Item pattern
  /\/collections\/[^\/]+\/products\/[^\/]+$/i, // Shopify pattern
  /\/product-detail\//i,       
  /\/detail\//i,
  // Additional patterns to catch more product URLs
  /\/buy\/[\w\d-]+/i,          // Buy pattern
  /\/shop\/[\w\d-]+\/[\w\d-]+$/i, // Shop specific product pattern
  /\/dp\/[\w\d]+/i,            // Amazon-style product pattern
  /\/skus?\/[\w\d-]+/i,        // SKU-based patterns
  /\/prod\/[\w\d-]+/i,         // Product catalog pattern
  /\/prod-[\w\d]+/i,           // Product with ID pattern
  /\/[^\/]+\/\d{5,}($|\?)/i    // Numeric ID-based product (common pattern)
];

// Category patterns
const CATEGORY_PATTERNS = [
  /\/collections\//i,
  /\/c-/i,
  /\/c\//i,
  /\/category\//i
];

const EXCLUDE_PATTERNS = [
  /\.(jpg|jpeg|png|gif|css|js|ico|svg|webp|pdf)($|\?)/i,
  /\/(cart|checkout|login|register|account|track|help|search)/i,
  /\/(api|graphql|rest|cdn|static)/i,
  /\?(utm_|fbclid|gclid|source|ref)/i,
  /#.*$/,
  /^(mailto|tel|javascript):/i
];

// Pagination patterns
const PAGINATION_PATTERNS = [
  /[\?&]page=(\d+)/i,
  /[\?&]p=(\d+)/i,
  /\/page[\/\-](\d+)/i,
  /\/p[\/\-](\d+)/i,
  /\/pages\/(\d+)/i,
];

// Specific patterns for Nykaa Fashion - Enhanced with new patterns
const NYKAA_PATTERNS = [
  /\/[^\/]+\/p\/\d{5,}($|\?)/i,   // Standard Nykaa product URL like /product-name/p/12345678
  /\/brands\/[^\/]+\/p\/\d+/i,     // Brand product URL
  /\/[^\/]+\/c\/\d+\/p\/\d+/i,     // Category-based product URL
  /\/p\/\d{7,8}($|\?)/i,           // Direct product ID format
  /\/products\/[^\/]+\/\d+/i,      // Products specific format
  /\/plp\/[^\/]+\/\d+/i,           // PLP format
  /\/shopping\/[^\/]+\/p\/\d+/i,   // Shopping section format
];

// Add Westside-specific product patterns
const WESTSIDE_PRODUCT_PATTERNS = [
  /\/products\/[^\/]+-\d{6,}$/i,             // Products with numeric ID
  /\/products\/[^\/]+$/i,                    // Standard product URL
  /\/collections\/[^\/]+\/products\/[^\/]+$/i, // Collection product
  /\/products\/[^\/]+\?variant=\d+$/i        // Product with variant ID
];

// Update TataCliq specific patterns
const TATACLIQ_PRODUCT_PATTERNS = [
  /\/p-mp[\w\d-]+/i,           // Basic p-mp pattern
  /\/[^\/]+\/p-mp[\w\d-]+/i,   // Category with p-mp pattern
  /\/shop-product-detail\//i,  // Shop product detail pattern
  /\/product-detail\//i,       // Product detail pattern
  /\/pdp\//i,                  // PDP pattern
  /-p-\d+\.?\d*$/i,            // Product number pattern
  /\/product\/[\w\d-]+/i,      // Direct product path
  /\/products\/[\w\d-]+/i      // Products path
];

/**
 * Identifies if a URL is a product page - ENHANCED VERSION
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
      const match = url.match(/https?:\/\/([^\/]+)/i);
      domain = match ? match[1] : '';
    }
    
    // NykaaFashion specific check - ENHANCED
    if (domain.includes('nykaafashion.com')) {
      // Do not match category URLs with /c/ pattern
      if (url.includes('/c/') && !url.includes('/p/')) {
        return false;
      }
      
      // Check all NykaaFashion patterns
      for (const pattern of NYKAA_PATTERNS) {
        if (pattern.test(url)) {
          return true;
        }
      }
      
      // Strict check for NykaaFashion product URLs
      // Must have: /product-name/p/12345 pattern
      const nykaaProductPattern = /\/[^\/]+\/p\/\d{5,}($|\?)/i;
      if (nykaaProductPattern.test(url)) {
        return true;
      }
      
      // Check for intcmp parameter which is often in product pages
      if (url.includes('/p/') && url.includes('intcmp=')) {
        return true;
      }
      
      // Check for product-specific parameters
      const urlObj = new URL(url);
      if (urlObj.searchParams.has('ppid') || urlObj.searchParams.has('productId')) {
        return true;
      }
      
      // Don't need additional checks for NykaaFashion here
      return false;
    }
    
    // TataCliq specific check
    if (domain.includes('tatacliq.com')) {
      // Categories should not be matched as products
      if (url.match(/\/(category|categories|collection|collections)\//) ||
          url.match(/\/c-\d+/)) {
        return false;
      }
      
      // Direct match for p-mp which is very specific to TataCliq products
      if (url.includes('/p-mp')) return true;
      
      // Check all TataCliq patterns
      for (const pattern of TATACLIQ_PRODUCT_PATTERNS) {
        if (pattern.test(url)) return true;
      }
      
      // Check for numeric patterns specific to TataCliq
      const match = url.match(/\/(\d{7,})($|\?|\/)/);
      if (match) return true;
      
      // Check for p-mp in the query string
      if (url.includes('?p-mp=')) return true;
      
      // Additional TataCliq detection
      if (url.match(/\/shop\/p-\d+\//i) || url.match(/\/product-detail\/[\w\d-]+\//i)) {
        return true;
      }
    }
    
    // Westside specific check
    if (domain.includes('westside.com')) {
      for (const pattern of WESTSIDE_PRODUCT_PATTERNS) {
        if (pattern.test(url)) return true;
      }
      
      if (url.includes('/products/') && 
          !url.includes('/collections/all/products') && 
          !url.endsWith('/products/')) {
        return true;
      }
      
      if (url.match(/\/products\/[^\/]+(-\d+|\?variant=\d+)/i)) {
        return true;
      }
    }
    
    // Virgio specific check
    if (domain.includes('virgio.com')) {
      if (url.includes('/products/') || url.includes('/product/') || url.includes('/product-detail/')) 
        return true;
    }
    
    // Generic pattern checks
    try {
      const pathname = new URL(url).pathname;
      
      for (const pattern of PRODUCT_PATTERNS) {
        if (pattern.test(pathname)) return true;
      }
      
      // Numeric product ID detection - commonly used in e-commerce
      if (!pathname.includes('/category/') && 
          !pathname.includes('/collection') && 
          !pathname.includes('/shop/') &&
          !pathname.includes('/search')) {
        
        // Check for product IDs in path segments
        const segments = pathname.split('/').filter(Boolean);
        
        // Check for segment that is purely numeric and likely a product ID
        for (const segment of segments) {
          // Product IDs are typically 5+ digits
          if (/^\d{5,}$/.test(segment)) return true;
          
          // SKU pattern with letters-numbers
          if (/^[a-z]{2,4}\d{4,}$/i.test(segment)) return true;
        }
        
        // Check for common product patterns like /something-productname-12345678/
        if (pathname.match(/\/[^\/]+-\d{5,}(\?|\/|$)/)) {
          return true;
        }
      }
      
      // Check query parameters for product indicators
      const searchParams = new URL(url).searchParams;
      if (searchParams.has('productId') || searchParams.has('pid') || 
          searchParams.has('product_id') || searchParams.has('itemId')) {
        return true;
      }
    } catch (e) {
      // URL parsing failed
    }
    
    return false;
  } catch (error) {
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
 * Checks if a URL should be excluded from crawling
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
 */
function getStartingPoints(domain) {
  // Special case for TataCliq to include relevant starting categories
  if (domain.includes('tatacliq.com')) {
    return [
      'https://www.tatacliq.com/',
      'https://www.tatacliq.com/fashion',
      'https://www.tatacliq.com/mens-clothing',
      'https://www.tatacliq.com/womens-clothing',
      'https://www.tatacliq.com/accessories',
      'https://www.tatacliq.com/watches',
      'https://www.tatacliq.com/footwear',
      'https://www.tatacliq.com/jewellery'
    ];
  } else if (domain.includes('nykaafashion.com')) {
    return [
      'https://www.nykaafashion.com/',
      'https://www.nykaafashion.com/women/c/6557',
      'https://www.nykaafashion.com/men/c/6823',
      'https://www.nykaafashion.com/kids/c/6266',
      'https://www.nykaafashion.com/best-sellers/c/10056',
      'https://www.nykaafashion.com/trending-now/c/10057',
      'https://www.nykaafashion.com/new-arrivals/c/14240',
      'https://www.nykaafashion.com/ethnic-wear/c/10046',
      'https://www.nykaafashion.com/kurta-sets/c/10047',
      'https://www.nykaafashion.com/top-brands/c/14275'
    ];
  }
  
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
 * Validates a product URL by examining URL structure more deeply
 * Useful for sites where simple pattern matching isn't sufficient
 */
function enhancedProductUrlValidation(url, domain) {
  try {
    if (!url) return false;
    
    // 1. First run the basic check
    if (isProductUrl(url)) return true;
    
    // 2. Enhanced checks for specific domains
    if (domain.includes('westside.com')) {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      if (path.includes('/products/')) {
        if (!path.endsWith('/products/') && !path.includes('collections/all/products')) {
          const productMatch = path.match(/\/products\/([a-z0-9-]+(?:-\d+)?)$/i);
          if (productMatch && productMatch[1] && productMatch[1].length > 0) {
            // Look for numeric ID (like 301017097) at the end
            const hasNumericId = /\d{6,}$/.test(productMatch[1]);
            if (hasNumericId) {
              return true;
            }
            
            if (productMatch[1].length > 5 && productMatch[1].includes('-')) {
              return true;
            }
          }
        }
      }
      
      if (path.match(/\/collections\/[^\/]+\/products\/[^\/\?]+/)) {
        return true;
      }
      
      if (urlObj.searchParams.has('variant') && path.includes('/products/')) {
        return true;
      }
    }
    
    if (domain.includes('nykaafashion.com')) {
      // Strict format for Nykaa Fashion product URLs
      // Must be: /some-product-name/p/12345678
      const match = url.match(/\/([^\/]+)\/p\/(\d+)(\?|$)/);
      if (match && match[2] && match[2].length >= 5) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Specialized function for validating NykaaFashion product URLs
 * @param {string} url - URL to check
 * @returns {boolean} - True if it's a valid product URL
 */
function isNykaaFashionProductUrl(url) {
  if (!url || !url.includes('nykaafashion.com')) return false;
  
  try {
    // The most definitive pattern for NykaaFashion product URLs
    const mainPattern = /\/[^\/]+\/p\/\d{5,}($|\?)/i;
    if (mainPattern.test(url)) return true;
    
    // Secondary patterns
    const secondaryPatterns = [
      /\/p\/\d{7,8}($|\?)/i,
      /\/brands\/[^\/]+\/p\/\d+/i
    ];
    
    for (const pattern of secondaryPatterns) {
      if (pattern.test(url)) return true;
    }
    
    // Check for product-specific parameters
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('ppid') || 
        urlObj.searchParams.has('productId') ||
        (urlObj.searchParams.has('intcmp') && url.includes('/p/'))) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
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
  enhancedProductUrlValidation,
  isNykaaFashionProductUrl, // Export the new specialized function
  PRODUCT_PATTERNS,
  CATEGORY_PATTERNS,
  EXCLUDE_PATTERNS,
  PAGINATION_PATTERNS,
  WESTSIDE_PRODUCT_PATTERNS,
  TATACLIQ_PRODUCT_PATTERNS,
  NYKAA_PATTERNS // Export the NykaaFashion patterns
};