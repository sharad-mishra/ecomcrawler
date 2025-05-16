/**
 * Debug utilities for the crawler
 */

/**
 * Analyze a URL to see if it's a product page and why/why not
 */
export function analyzeUrl(url) {
  console.log(`\nAnalyzing URL: ${url}`);
  
  try {
    // Parse URL
    const parsed = new URL(url);
    console.log(`Domain: ${parsed.hostname}`);
    console.log(`Path: ${parsed.pathname}`);
    
    // Check domain-specific patterns
    if (parsed.hostname.includes('westside.com')) {
      console.log('Site type: Westside (Shopify platform)');
      console.log(`Is product URL? ${url.includes('/products/')}`);
    } else if (parsed.hostname.includes('virgio.com')) {
      console.log('Site type: Virgio');
      console.log(`Is product URL? ${url.includes('/products/') || url.includes('/product/')}`);
    } else if (parsed.hostname.includes('nykaafashion.com')) {
      console.log('Site type: Nykaa Fashion');
      const isProduct = url.match(/\/p\/\d{5,}/) !== null;
      console.log(`Is product URL? ${isProduct}`);
    } else if (parsed.hostname.includes('tatacliq.com')) {
      console.log('Site type: TataCliq');
      console.log(`Is product URL? ${url.includes('/p-mp')}`);
    } else {
      console.log('Site type: Generic');
    }
    
    // Check common patterns
    const patterns = [
      { name: '/products/', match: url.includes('/products/') },
      { name: '/product/', match: url.includes('/product/') },
      { name: '/p/', match: url.includes('/p/') },
      { name: 'numeric ID', match: parsed.pathname.match(/\/\d{5,}/) !== null },
      { name: '/buy endpoint', match: url.endsWith('/buy') }
    ];
    
    console.log('\nPattern matches:');
    patterns.forEach(p => {
      console.log(`- ${p.name}: ${p.match ? 'YES' : 'no'}`);
    });
    
  } catch (e) {
    console.log(`Error analyzing URL: ${e.message}`);
  }
}

/**
 * A more advanced URL validator that can be used for debugging
 */
export function validateProductUrl(url, verbose = false) {
  try {
    // Basic checks
    if (!url || typeof url !== 'string') {
      if (verbose) console.log('Invalid input: not a string');
      return false;
    }
    
    const normalizedUrl = url.toLowerCase();
    
    // Parse the URL
    let domain, pathname;
    try {
      const parsed = new URL(normalizedUrl);
      domain = parsed.hostname;
      pathname = parsed.pathname;
    } catch (e) {
      if (verbose) console.log(`URL parsing error: ${e.message}`);
      return false;
    }
    
    // Site-specific checks with detailed feedback
    if (domain.includes('westside.com')) {
      const isProduct = pathname.includes('/products/');
      if (verbose) {
        console.log(`Westside URL check: ${isProduct ? 'IS PRODUCT' : 'not product'}`);
        console.log(`Path contains '/products/': ${pathname.includes('/products/')}`);
      }
      if (isProduct) return true;
    }
    
    if (domain.includes('virgio.com')) {
      const isProduct = pathname.includes('/products/') || pathname.includes('/product/');
      if (verbose) {
        console.log(`Virgio URL check: ${isProduct ? 'IS PRODUCT' : 'not product'}`);
        console.log(`Path contains '/products/': ${pathname.includes('/products/')}`);
        console.log(`Path contains '/product/': ${pathname.includes('/product/')}`);
      }
      if (isProduct) return true;
    }
    
    if (domain.includes('nykaafashion.com')) {
      const hasP = pathname.includes('/p/');
      const hasNumericId = !!pathname.match(/\/p\/\d{5,}/);
      if (verbose) {
        console.log(`NykaaFashion URL check: ${hasP && hasNumericId ? 'IS PRODUCT' : 'not product'}`);
        console.log(`Path contains '/p/': ${hasP}`);
        console.log(`Path contains numeric ID: ${hasNumericId}`);
      }
      if (hasP && hasNumericId) return true;
    }
    
    // Generic checks as fallback
    const genericProductPatterns = [
      '/product/', '/products/', '/p/', '/item/', '/buy'
    ];
    
    for (const pattern of genericProductPatterns) {
      if (pathname.includes(pattern)) {
        if (verbose) console.log(`Generic pattern match: ${pattern}`);
        return true;
      }
    }
    
    if (verbose) console.log('No product patterns matched');
    return false;
  } catch (error) {
    if (verbose) console.log(`Validation error: ${error.message}`);
    return false;
  }
}
