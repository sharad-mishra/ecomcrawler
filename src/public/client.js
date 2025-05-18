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
  
  // Track state
  let activeCrawls = {};
  let productUrls = new Set();
  let resultFilePath = null;
  
  // Toggle max pages input based on indefinite crawl checkbox
  indefiniteCrawl.addEventListener('change', function() {
    maxPages.disabled = this.checked;
  });
  
  // Start crawling
  startButton.addEventListener('click', function() {
    // Get selected websites
    const selectedWebsites = [];
    document.querySelectorAll('input[name="websites"]:checked').forEach(checkbox => {
      selectedWebsites.push(checkbox.value);
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
    
    // Add a fallback in case the server doesn't respond
    const stopTimeout = setTimeout(() => {
      // If we haven't received crawlStopped after 10 seconds, assume server issue
      if (stopButton.disabled === false) {
        addLogEntry('Server not responding to stop request. Resetting UI...', 'error');
        updateUIForCrawling(false);
        
        // Try to reconnect
        if (!socket.connected) {
          socket.connect();
        }
      }
    }, 10000);
    
    // Clear the timeout if we get a proper response
    socket.once('crawlStopped', () => {
      clearTimeout(stopTimeout);
    });
  });
  
  // Download results
  downloadButton.addEventListener('click', function() {
    // Get selected domain if you have a domain selector
    const selectedDomain = 'all'; // Default to all if no selector exists
    
    // Use the socket to request download
    socket.emit('requestDownload', { domain: selectedDomain });
    
    addLogEntry('Downloading results...', 'info');
  });
  
  // Add connection status indicator
  const connectionStatus = document.createElement('div');
  connectionStatus.id = 'connection-status';
  connectionStatus.className = 'connection-indicator';
  connectionStatus.innerHTML = 'Disconnected';
  connectionStatus.style.color = 'red';
  document.querySelector('.control-panel').appendChild(connectionStatus);
  
  // Add a reconnect button
  const reconnectButton = document.createElement('button');
  reconnectButton.id = 'reconnect-button';
  reconnectButton.className = 'btn btn-warning';
  reconnectButton.innerHTML = 'Reconnect';
  reconnectButton.style.display = 'none';
  reconnectButton.addEventListener('click', function() {
    socket.connect();
  });
  document.querySelector('.control-panel').appendChild(reconnectButton);
  
  // Socket.io event handlers
  socket.on('connect', () => {
    connectionStatus.innerHTML = 'Connected';
    connectionStatus.style.color = 'green';
    reconnectButton.style.display = 'none';
    addLogEntry('Connected to server', 'info');
  });
  
  socket.on('disconnect', () => {
    connectionStatus.innerHTML = 'Disconnected';
    connectionStatus.style.color = 'red';
    reconnectButton.style.display = 'inline-block';
    addLogEntry('Disconnected from server', 'error');
    updateUIForCrawling(false);
    
    // Automatically attempt to reconnect
    setTimeout(() => {
      if (!socket.connected) {
        socket.connect();
      }
    }, 5000);
  });
  
  socket.on('connect_error', (error) => {
    connectionStatus.innerHTML = 'Connection Error';
    connectionStatus.style.color = 'red';
    reconnectButton.style.display = 'inline-block';
    addLogEntry(`Connection error: ${error.message}`, 'error');
  });
  
  // Listen for crawler-specific events
  socket.on('crawl_stopping', (data) => {
    addLogEntry(`${data.domain}: ${data.message}`, 'warning');
  });
  
  socket.on('crawl_forcibly_stopped', (data) => {
    addLogEntry(`${data.domain}: ${data.message}. Found ${data.productCount} products.`, 'warning');
  });
  
  // Handle ping/pong for keeping connection alive during long crawls
  setInterval(() => {
    if (socket.connected && activeCrawls && Object.keys(activeCrawls).length > 0) {
      socket.emit('ping');
    }
  }, 30000);
  
  socket.on('pong', () => {
    console.log('Received pong from server');
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
  
  // Update the crawlComplete handler to enable download button
  socket.on('crawlComplete', (results) => {
    addLogEntry('Crawling completed!', 'success');
    statusText.textContent = 'Crawling completed!';
    
    // Set progress to 100% on completion
    progressBar.style.width = '100%';
    
    updateUIForCrawling(false);
    
    // Enable download button
    downloadButton.disabled = false;
    
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
  
  // Add a handler for download ready events
  socket.on('downloadReady', (data) => {
    if (data.ready) {
      downloadButton.disabled = false;
      addLogEntry(data.message || 'Results are ready for download', 'success');
    }
  });
  
  // Add handler for download URL
  socket.on('downloadUrl', (data) => {
    if (data.url) {
      window.open(data.url, '_blank');
    }
  });
  
  socket.on('crawlError', (error) => {
    addLogEntry(`Error: ${error.message}`, 'error');
    // Don't stop the UI completely as other crawls might still be running
  });
  
  // Handle crawl stopped event
  socket.on('crawlStopped', () => {
    addLogEntry('Crawling stopped', 'warning');
    statusText.textContent = 'Crawling stopped';
    updateUIForCrawling(false);
    
    // Enable download button when crawling stops
    downloadButton.disabled = false;
  });
  
  /**
   * Update progress stats and progress bar
   */
  function updateProgressStats() {
    // Calculate total stats across all domains
    const totalStats = Object.values(activeCrawls).reduce((acc, curr) => {
      return {
        pagesVisited: acc.pagesVisited + (curr.pagesVisited || 0),
        productsFound: acc.productsFound + (curr.productsFound || 0)
      };
    }, { pagesVisited: 0, productsFound: 0 });
    
    // Update the progress stats text - MODIFIED to show only product count
    progressStats.textContent = `${totalStats.productsFound} products found`;
    
    // Calculate progress percentage if we have a maximum pages value
    if (!indefiniteCrawl.checked) {
      const maxPagesValue = parseInt(maxPages.value) || 500;
      const domains = Object.keys(activeCrawls).length || 1;
      const totalMaxPages = maxPagesValue * domains;
      
      // Calculate percentage (cap at 99% until complete)
      let percentage = Math.min(99, Math.round((totalStats.pagesVisited / totalMaxPages) * 100));
      
      // Only update if we're not in indeterminate mode
      if (!progressBar.parentElement.classList.contains('progress-indeterminate')) {
        progressBar.style.width = `${percentage}%`;
      }
    }
    
    // Update product counter
    productCounter.textContent = `(${totalStats.productsFound})`;
  }
  
  /**
   * Start the progress bar animation
   */
  function startProgressAnimation() {
    const progressContainer = progressBar.parentElement;
    progressContainer.classList.add('progress-animated');
    
    if (indefiniteCrawl.checked) {
      progressContainer.classList.add('progress-indeterminate');
    } else {
      progressContainer.classList.remove('progress-indeterminate');
      progressBar.style.width = '0%';
    }
    
    // Add crawling active class to parent for additional effects
    const statusContainer = document.querySelector('.status-container');
    if (statusContainer) {
      statusContainer.classList.add('crawling-active');
    }
  }
  
  /**
   * Stop the progress bar animation
   * @param {boolean} completed - Whether crawling completed successfully
   */
  function stopProgressAnimation(completed = false) {
    const progressContainer = progressBar.parentElement;
    progressContainer.classList.remove('progress-animated');
    progressContainer.classList.remove('progress-indeterminate');
    
    // Set to 100% if completed successfully
    if (completed) {
      progressBar.style.width = '100%';
    }
    
    // Remove active class from container
    const statusContainer = document.querySelector('.status-container');
    if (statusContainer) {
      statusContainer.classList.remove('crawling-active');
    }
  }
  
  // Helper functions
  function resetUI() {
    activeCrawls = {};
    productUrls = new Set();
    resultFilePath = null;
    
    statusLog.innerHTML = '';
    productList.innerHTML = '';
    noResults.style.display = 'block';
    productCounter.textContent = '(0)';
    
    // Reset progress bar
    const statusContainer = document.querySelector('.status-container');
    statusContainer.classList.remove('crawling-active');
    progressBar.parentElement.classList.remove('progress-indeterminate');
    progressBar.style.width = '0%';
    
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
    
    // Handle progress bar animation
    if (isCrawling) {
      startProgressAnimation();
      statusText.textContent = 'Crawling in progress...';
    } else {
      stopProgressAnimation();
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
});
