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

// NykaaFashion.com
export const nykaaFashionPatterns = {
  productPatterns: [
    /\/prod\//i,
    /\/p\/[\w-]+/i
  ],
  productSelectors: [
    '.plp-prod-list',
    '.product-item',
    '[data-item-id]',
    '[class*="product-card"]'
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
