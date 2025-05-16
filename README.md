# 🕸️ E-Commerce Product URL Crawler

This project is a scalable and stealthy web crawler designed to extract product page URLs from e-commerce websites. It is built using Puppeteer with the Stealth plugin to evade bot detection and supports crawling multiple domains concurrently with customizable crawling logic.

## ✨ Features

- **Stealth Mode**: Uses puppeteer-extra with Stealth plugin to avoid bot detection
- **Multiple Domains**: Crawl multiple e-commerce sites concurrently
- **Site-Specific Handling**: Custom logic for different e-commerce platforms
- **Real-time Updates**: Web UI with Socket.io for real-time crawling status
- **Configurable**: Adjust crawling parameters through UI or config files
- **Progress Tracking**: Visual progress bar and detailed logs
- **Result Management**: Download results in CSV format

## 🧠 How It Works

The crawler uses a **breadth-first search (BFS)** approach to traverse all internal pages of an e-commerce website. For each visited page, it extracts all internal links and identifies product pages using pattern matching and site-specific logic.

### 🔍 Crawling Strategy

1. **Start with domain URLs** configured in the system
2. **Launch a stealth Puppeteer browser** instance to avoid detection
3. **Queue internal links** and iterate over them while maintaining a set of visited URLs
4. For each page:
   - Visit the URL with Puppeteer
   - Detect and handle **lazy loading** by scrolling the page
   - Click **"Load More"** buttons when present
   - Extract links using site-specific handlers
   - Filter links using pattern matching to identify product URLs
5. **Output results** to JSON files and provide CSV download option

## 🔧 Supported Websites

The crawler is specifically optimized for:

- **Virgio** (virgio.com)
- **Westside** (westside.com)
- **TataCliq** (tatacliq.com)
- **NykaaFashion** (nykaafashion.com)

## 🚀 Adding Support for New Websites

To add support for additional e-commerce websites:

1. **Update URL patterns** in `src/utils/url.utils.js`:
   - Add new patterns to `PRODUCT_PATTERNS`
   - Add site-specific logic to `isProductUrl()`

2. **Create a site-specific handler** in `src/crawler.js`:
   - Create a function like `handleXYZLinks(page)`
   - Add detection logic in the crawlSite function

3. **Add domain configuration** in `config/default.json`:
   - Add a new entry to the `domainsConfig` array
   - Configure any site-specific parameters

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ecom-crawler.git
cd ecom-crawler

# Install dependencies
npm install

# Start the application
npm start
```

## 📊 Usage

1. Open the web interface at `http://localhost:3000`
2. Select the websites you want to crawl
3. Configure crawling options (max pages, scroll attempts)
4. Click "Start Crawling" and monitor progress in real-time
5. When complete, download results as CSV

## 🛠 Configuration

Key configuration options in `config/default.json`:

- `outputDir`: Directory for saving results
- `browserOptions`: Puppeteer browser configuration
- `maxScrollAttempts`: Maximum scroll attempts for lazy-loaded content
- `concurrencyLimit`: Number of concurrent browser instances
- `domainsConfig`: Site-specific configurations

## 📂 Output

Results are saved to:

- `crawled-data/product-links.json` — Map of domains to product URLs
- `crawled-data/failed-urls.json` — URLs that failed during crawling

## 📋 License

This project is licensed under the MIT License.
