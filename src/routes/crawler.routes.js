const express = require('express');
const router = express.Router();
const crawlerController = require('../controllers/crawler.controller');

// Define routes
router.post('/crawl', crawlerController.crawl);
router.get('/status', crawlerController.getStatus);
router.post('/start', crawlerController.startCrawl);
router.post('/start-all', crawlerController.startCrawlAll); // Add new route
router.get('/results', crawlerController.getResults);
router.get('/download', crawlerController.downloadResults);
router.post('/stop', crawlerController.stopCrawlers);
router.post('/stop-domain', crawlerController.stopCrawler);

// Export the router
module.exports = router;