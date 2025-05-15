/**
 * Site-specific configuration for the crawler
 */

const siteConfig = {
  // Configuration for each domain
  domains: {
    'virgio.com': {
      loadMoreSelector: '.load-more-button, [data-testid="load-more"]',
      productSelectors: [
        '.product-card',
        '.product-title',
        '[data-product-id]'
      ]
    },
    'westside.com': {
      loadMoreSelector: '.more-products, .collection-load-more',
      productSelectors: [
        '.product-card',
        '.product__title',
        '.product-single'
      ]
    },
    'tatacliq.com': {
      loadMoreSelector: '.Button-sc-1antbdu-0, .view-more-button',
      productSelectors: [
        '.ProductModule__product',
        '.ProductDetailsMainCard',
        '.pdp-details'
      ]
    },
    'nykaafashion.com': {
      loadMoreSelector: '.css-1q7tqyw, .load-more-button',
      productSelectors: [
        '.product-info-main',
        '.plp-prod-list',
        '.css-d6ukp1'
      ]
    }
  },
  
  // Default configuration
  default: {
    loadMoreSelector: '.load-more, .view-more, .show-more',
    productSelectors: [
      '.product-card',
      '.product-title',
      '[data-product-id]',
      '.add-to-cart'
    ]
  },
  
  /**
   * Get configuration for a specific domain
   * @param {string} domain - Domain to get configuration for
   */
  getConfig(domain) {
    // Find matching domain config
    const domainKey = Object.keys(this.domains).find(key => 
      domain.includes(key)
    );
    
    // Return domain-specific config or default
    return domainKey ? this.domains[domainKey] : this.default;
  }
};

module.exports = siteConfig;
