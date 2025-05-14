const PRODUCT_PATTERNS = [
  // Virgio
  /\/products\/[a-zA-Z0-9-_]+$/i,
  // TataCliq
  /\/p-mp\d+$/i,
  /\/[a-zA-Z0-9-]+\/p-mp/i,
  // Westside
  /\/products\/[a-zA-Z0-9-_]+-\d+$/i,
  /\/products\/[a-zA-Z0-9-_]+$/i,
  // NykaaFashion
  /\/[a-zA-Z0-9-_]+\/\d+$/i,
  /\/prod\/\d+$/i,
  /\/p\/\d+$/i,
  // Generic patterns
  /\/product\/[a-zA-Z0-9-_]+$/i,
  /\/item\/[a-zA-Z0-9-_]+$/i
];

const CATEGORY_PATTERNS = [
  /\/collections\//i,
  /\/c-[a-zA-Z0-9]+/i,
  /\/c\/\d+$/i,
  /\/category\//i,
  /\/(men|women|kids)(\/|$)/i
];

const EXCLUDE_PATTERNS = [
  /\.(jpg|jpeg|png|gif|css|js|ico|svg|webp|pdf)($|\?)/i,
  /\/(cart|checkout|login|register|account|track|help|search)/i,
  /\/(api|graphql|rest|cdn|static)/i,
  /\?(utm_|fbclid|gclid|source|ref)/i,
  /#.*$/,
  /^(mailto|tel|javascript):/i
];

function isProductUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    
    // Domain-specific detection logic first (more accurate)
    if (hostname.includes('tatacliq.com')) {
      return pathname.includes('/p-mp') || 
             pathname.includes('/product-details');
    }
    
    if (hostname.includes('westside.com')) {
      return pathname.includes('/products/') && 
             !pathname.includes('/collections/');
    }
    
    if (hostname.includes('nykaa') || hostname.includes('nykaafashion')) {
      return pathname.includes('/prod/') || 
             /\/[^\/]+\/\d+$/.test(pathname) || 
             pathname.includes('/p/');
    }
    
    if (hostname.includes('virgio.com')) {
      return pathname.includes('/products/') && 
             !pathname.includes('/collections/');
    }
    
    // General pattern matching as fallback
    return PRODUCT_PATTERNS.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

function isCategoryUrl(url) {
  try {
    const { pathname } = new URL(url);
    return CATEGORY_PATTERNS.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

function shouldExcludeUrl(url) {
  if (isProductUrl(url)) return false;
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
}

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

function getStartingPoints(domain) {
  try {
    const { hostname } = new URL(domain);
    
    const startingPointsMap = {
      'virgio.com': [
        'https://www.virgio.com/collections/new-launch',
        'https://www.virgio.com/collections/date-collection'
      ],
      'westside.com': [
        'https://www.westside.com/collections/women',
        'https://www.westside.com/collections/men',
        'https://www.westside.com/collections/kids'
      ],
      'tatacliq.com': [
        'https://www.tatacliq.com/women-clothing/c-msh11170',
        'https://www.tatacliq.com/men-clothing/c-msh11150'
      ],
      'nykaafashion.com': [
        'https://www.nykaafashion.com/women/c/8',
        'https://www.nykaafashion.com/men/c/558'
      ]
    };
    
    // Find matching domain entry
    for (const [key, urls] of Object.entries(startingPointsMap)) {
      if (hostname.includes(key)) {
        return urls;
      }
    }
    
    return [domain];
  } catch {
    return [domain];
  }
}

function isSameDomain(url, baseDomain) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Handle case where baseDomain might not have protocol
    let baseHostname;
    if (baseDomain.includes('://')) {
      baseHostname = new URL(baseDomain).hostname;
    } else {
      baseHostname = baseDomain;
    }
    
    // Clean hostnames (remove www.)
    const cleanHostname = hostname.replace(/^www\./, '');
    const cleanBaseHostname = baseHostname.replace(/^www\./, '');
    
    // Check if hostname matches base hostname
    return cleanHostname === cleanBaseHostname ||
           cleanHostname.endsWith(`.${cleanBaseHostname}`);
  } catch {
    return false;
  }
}

function getNormalizedDomain(url) {
  try {
    if (!url) return '';
    
    let domain = url;
    // Add protocol if missing
    if (!url.includes('://')) {
      domain = `https://${url}`;
    }
    
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