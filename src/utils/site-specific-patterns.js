/**
 * Site-specific patterns for detecting product URLs
 */

// Westside.com (Shopify-based)
export const westsidePatterns = {
  productPatterns: [
    /\/products\/[\w-]+$/i,
    /\/collections\/[\w-]+\/products\/[\w-]+$/i
  ],
  productSelectors: [
    '.product-card',
    '.product-grid__item',
    '.grid-view-item',
    '.product-item',
    '[data-product-id]'
  ]
};

// Virgio.com 
export const virgioPatterns = {
  productPatterns: [
    /\/product-detail\//i,
    /\/product\/[\w-]+$/i
  ],
  productSelectors: [
    '.product-item',
    '.product-box',
    '.product-card',
    '.product-tile'
  ]
};

// NykaaFashion.com - Enhanced with improved patterns
export const nykaaFashionPatterns = {
  productPatterns: [
    /\/[^\/]+\/p\/\d{5,}($|\?)/i,   // Primary pattern: /product-name/p/12345678
    /\/p\/\d{7,8}($|\?)/i,           // Direct product ID format
    /\/brands\/[^\/]+\/p\/\d+/i,     // Brand product URL
    /\/shopping\/[^\/]+\/p\/\d+/i    // Shopping section format
  ],
  productSelectors: [
    '.plp-prod-list',
    '.product-item',
    '[data-item-id]',
    '[class*="product-card"]',
    '.css-n0pt9j', // Common product card class
    '.css-1tewyts', // Another product card class
    '.css-d6ukp1', // Container that often holds product cards
    '.css-1icrjt', // Recent product card class
    '.product-grid-item',
    '.css-1oqhjhj', // Listing page product card
    'div[data-reactid*="product"]',
    'a[href*="/p/"]' // Direct product link selector
  ],
  categoryPatterns: [
    /\/c\/\d+/i,
    /\/women\/c\//i,
    /\/men\/c\//i,
    /\/kids\/c\//i,
    /\/brands\//i
  ],
  startingPoints: [
    'https://www.nykaafashion.com/',
    'https://www.nykaafashion.com/women/c/6557',
    'https://www.nykaafashion.com/men/c/6823',
    'https://www.nykaafashion.com/kids/c/6266',
    'https://www.nykaafashion.com/best-sellers/c/10056',
    'https://www.nykaafashion.com/new-arrivals/c/14240',
    'https://www.nykaafashion.com/ethnic-wear/c/10046'
  ],
  // Pagination selectors to help find "Load More" or page navigation
  paginationSelectors: [
    '.css-1q7tqyw', // Load more button
    '.load-more-button',
    '.css-1pe7halt', // Pagination container
    '.css-dd2kcz', // Pagination controls
    'button[data-at*="load_more"]'
  ]
};

// TataCliq.com
export const tataCliqPatterns = {
  productPatterns: [
    /\/p-mp/i,
    /\/[^\/]+\/p-mp/i
  ],
  productSelectors: [
    '.ProductModule__base',
    '.product-module',
    '[class*="productModule"]'
  ]
};

// Helper function to get patterns for a specific domain
export function getPatternsForDomain(domain) {
  if (!domain) return null;
  
  const domainLower = domain.toLowerCase();
  
  if (domainLower.includes('westside.com')) return westsidePatterns;
  if (domainLower.includes('virgio.com')) return virgioPatterns;
  if (domainLower.includes('nykaafashion.com')) return nykaaFashionPatterns;
  if (domainLower.includes('tatacliq.com')) return tataCliqPatterns;
  
  return null;
}
