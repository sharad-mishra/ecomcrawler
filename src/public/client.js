document.addEventListener('DOMContentLoaded', function() {
  // Connect to Socket.io server
  const socket = io();
  
  // DOM elements
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const indefiniteCrawl = document.getElementById('indefiniteCrawl');
  const maxPages = document.getElementById('maxPages');
  const maxScrolls = document.getElementById('maxScrolls');
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('statusText');
  const progressStats = document.getElementById('progressStats');
  const statusLog = document.getElementById('statusLog');
  const productList = document.getElementById('productList');
  const noResults = document.getElementById('noResults');
  const productCounter = document.getElementById('productCounter');
  const downloadButton = document.getElementById('downloadButton');
  const customDomain = document.getElementById('customDomain');
  const customCheck = document.getElementById('custom');
  
  // Track state
  let activeCrawls = {};
  let productUrls = new Set();
  let resultFilePath = null;
  
  // Toggle max pages input based on indefinite crawl checkbox
  indefiniteCrawl.addEventListener('change', function() {
    maxPages.disabled = this.checked;
  });
  
  // Enable custom domain input only when its checkbox is checked
  customCheck.addEventListener('change', function() {
    customDomain.disabled = !this.checked;
    if (this.checked) {
      customDomain.focus();
    }
  });
  customDomain.disabled = !customCheck.checked;
  
  // Start crawling
  startButton.addEventListener('click', function() {
    // Get selected websites
    const selectedWebsites = [];
    document.querySelectorAll('input[name="websites"]:checked').forEach(checkbox => {
      if (checkbox.value === 'custom') {
        if (customDomain.value.trim()) {
          selectedWebsites.push(customDomain.value.trim());
        }
      } else {
        selectedWebsites.push(checkbox.value);
      }
    });
    
    if (selectedWebsites.length === 0) {
      addLogEntry('Please select at least one website to crawl', 'error');
      return;
    }
    
    // Get crawl options
    const options = {
      indefiniteCrawling: indefiniteCrawl.checked,
      maxPages: parseInt(maxPages.value) || 500,
      maxScrollAttempts: parseInt(maxScrolls.value) || 20
    };
    
    // Reset UI
    resetUI();
    updateUIForCrawling(true);
    
    // Emit start crawl event
    socket.emit('startCrawl', {
      domains: selectedWebsites,
      options: options
    });
    
    addLogEntry(`Starting crawl for: ${selectedWebsites.join(', ')}`, 'info');
  });
  
  // Stop crawling
  stopButton.addEventListener('click', function() {
    socket.emit('stopCrawl');
    addLogEntry('Stopping all active crawls...', 'warning');
    statusText.textContent = 'Stopping...';
  });
  
  // Download results
  downloadButton.addEventListener('click', function() {
    if (resultFilePath) {
      window.open(`/download?file=${encodeURIComponent(resultFilePath)}`, '_blank');
    }
  });
  
  // Socket.io event handlers
  socket.on('connect', () => {
    addLogEntry('Connected to server', 'info');
  });
  
  socket.on('disconnect', () => {
    addLogEntry('Disconnected from server', 'error');
    updateUIForCrawling(false);
  });
  
  socket.on('crawlUpdate', (data) => {
    if (data.message) {
      addLogEntry(data.message, data.type || 'info');
    }
    
    if (data.domain && data.status) {
      addLogEntry(`${data.domain}: ${data.status}`, data.type || 'info');
      
      // Update active crawls
      if (!activeCrawls[data.domain]) {
        activeCrawls[data.domain] = {
          pagesVisited: 0,
          productsFound: 0
        };
      }
      
      // Update progress stats
      updateProgressStats();
    }
  });
  
  socket.on('crawlProgress', (data) => {
    if (data.domain) {
      activeCrawls[data.domain] = {
        pagesVisited: data.pagesVisited || activeCrawls[data.domain]?.pagesVisited || 0,
        productsFound: data.productsFound || activeCrawls[data.domain]?.productsFound || 0
      };
      
      updateProgressStats();
    }
  });
  
  // Update the productFound event handler to ensure proper display
  socket.on('productFound', (data) => {
    if (data.url) {
      // Use a Set to ensure uniqueness
      if (!productUrls.has(data.url)) {
        productUrls.add(data.url);
        
        // Add product to list and show it immediately
        addProductToList(data.url, data.domain);
        
        // Hide the "No results" message if it's showing
        if (noResults.style.display !== 'none') {
          noResults.style.display = 'none';
        }
        
        // Update product counter
        updateProductCounter();
        
        // Update progress stats if applicable
        if (data.domain && activeCrawls[data.domain]) {
          activeCrawls[data.domain].productsFound = (activeCrawls[data.domain].productsFound || 0) + 1;
          updateProgressStats();
        }
      }
    }
  });
  
  socket.on('crawlComplete', (results) => {
    addLogEntry('Crawling completed!', 'success');
    statusText.textContent = 'Crawling completed!';
    updateUIForCrawling(false);
    
    // Set result file path for download
    if (results.filePath) {
      resultFilePath = results.filePath;
      downloadButton.disabled = false;
    }
    
    // Process results
    if (results) {
      Object.entries(results).forEach(([domain, data]) => {
        const productCount = data.productUrls ? data.productUrls.length : 0;
        addLogEntry(`${domain}: Found ${productCount} product URLs`, 'success');
        
        // Add any products not already in the list
        if (data.productUrls) {
          data.productUrls.forEach(url => {
            if (!productUrls.has(url)) {
              productUrls.add(url);
              addProductToList(url, domain);
            }
          });
          updateProductCounter();
        }
      });
    }
  });
  
  socket.on('crawlError', (error) => {
    addLogEntry(`Error: ${error.message}`, 'error');
    // Don't stop the UI completely as other crawls might still be running
  });
  
  socket.on('crawlStopped', () => {
    addLogEntry('Crawling stopped', 'warning');
    statusText.textContent = 'Crawling stopped';
    updateUIForCrawling(false);
  });
  
  // Helper functions
  function resetUI() {
    activeCrawls = {};
    productUrls = new Set();
    resultFilePath = null;
    
    statusLog.innerHTML = '';
    productList.innerHTML = '';
    noResults.style.display = 'block';
    productCounter.textContent = '(0)';
    progressBar.style.width = '0%';
    progressBar.classList.remove('progress-indeterminate');
    statusText.textContent = 'Ready to crawl';
    progressStats.textContent = '';
    downloadButton.disabled = true;
  }
  
  function updateUIForCrawling(isCrawling) {
    startButton.disabled = isCrawling;
    stopButton.disabled = !isCrawling;
    indefiniteCrawl.disabled = isCrawling;
    maxPages.disabled = isCrawling || indefiniteCrawl.checked;
    maxScrolls.disabled = isCrawling;
    document.querySelectorAll('input[name="websites"]').forEach(cb => {
      cb.disabled = isCrawling;
    });
    customDomain.disabled = isCrawling || !customCheck.checked;
    
    if (isCrawling) {
      progressBar.classList.add('progress-indeterminate');
      statusText.textContent = 'Crawling in progress...';
    } else {
      progressBar.classList.remove('progress-indeterminate');
    }
  }
  
  function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    
    statusLog.appendChild(entry);
    statusLog.scrollTop = statusLog.scrollHeight;
  }
  
  // Ensure addProductToList function works correctly
  function addProductToList(url, domain) {
    // Create list item for product URL
    const li = document.createElement('li');
    
    // Add link element
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.textContent = url;
    li.appendChild(link);
    
    // Add domain badge if provided
    if (domain) {
      const domainSpan = document.createElement('span');
      domainSpan.className = 'product-domain';
      domainSpan.textContent = domain;
      li.appendChild(domainSpan);
    }
    
    // Add to product list and scroll to show latest
    productList.appendChild(li);
    productList.scrollTop = productList.scrollHeight;
  }
  
  // Update the product counter display
  function updateProductCounter() {
    productCounter.textContent = `(${productUrls.size})`;
  }
  
  function updateProgressStats() {
    let totalPages = 0;
    let totalProducts = 0;
    
    Object.values(activeCrawls).forEach(crawl => {
      totalPages += crawl.pagesVisited || 0;
      totalProducts += crawl.productsFound || 0;
    });
    
    progressStats.textContent = `${totalPages} pages crawled, ${totalProducts} products found`;
    
    // Update progress bar - if we're using max pages
    if (!indefiniteCrawl.checked) {
      const maxPagesValue = parseInt(maxPages.value) || 500;
      const totalSites = Object.keys(activeCrawls).length || 1;
      const maxPagesTotal = maxPagesValue * totalSites;
      
      const progressPercentage = Math.min(Math.round((totalPages / maxPagesTotal) * 100), 100);
      progressBar.style.width = `${progressPercentage}%`;
    }
  }
});
