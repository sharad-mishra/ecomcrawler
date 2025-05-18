# 🕸️ E-Commerce Product URL Crawler

A scalable and stealthy web crawler designed to extract product page URLs from e-commerce websites. Built using Puppeteer with Stealth mode to evade bot detection.

## ✨ Key Features

- **Stealth Mode**: Avoids bot detection using puppeteer-extra with Stealth plugin
- **Multi-domain Crawling**: Crawl multiple e-commerce sites concurrently  
- **Site-specific Optimization**: Custom logic for different platforms
- **Real-time Updates**: Web UI with Socket.io for live crawling status
- **Fastify Backend**: High-performance REST API using Fastify instead of Express
- **Intelligent Detection**: Automatically detects product pages, categories, and lazy loading

## 🔧 Currently Supported Sites

- Westside (westside.com)
- TataCliq (tatacliq.com)
- NykaaFashion (nykaafashion.com)
- Virgio (virgio.com)

## 🚀 Future Enhancements

- **Domain Expansion**: Add support for more e-commerce sites with simple configuration
- **Enhanced UI**: More interactive dashboard with filtering and visualization options
- **Product Data Extraction**: Expand to extract product details beyond just URLs
- **Headless Mode Toggle**: Option to run with/without visible browser
- **Distributed Crawling**: Support for multi-node distributed crawling
- **Data Export Options**: Additional export formats beyond CSV

## 📦 Quick Start

```bash
# Install dependencies
npm install

# Start the application
npm start

# Access the web interface
# Open http://localhost:3000 in your browser
```

## 🛠️ Adding New Domains

To add support for additional e-commerce websites:

1. Update URL patterns in `src/utils/url.utils.js`
2. Create a site-specific handler in `src/crawler.js` if needed
3. Add domain configuration in `config/default.json`

## 📊 Usage

1. Select websites to crawl from the web interface
2. Configure crawling options
3. Track progress in real-time
4. Download results as CSV when complete
