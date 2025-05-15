const crawlerController = require('../controllers/crawler.controller');

async function routes(fastify, options) {
  // API routes
  fastify.post('/api/crawler/crawl', crawlerController.crawl);
  fastify.get('/api/crawler/status', crawlerController.getStatus);
  fastify.post('/api/crawler/start', crawlerController.startCrawl);
  fastify.post('/api/crawler/start-all', crawlerController.startCrawlAll);
  fastify.get('/api/crawler/results', crawlerController.getResults);
  fastify.get('/api/crawler/download', crawlerController.downloadResults);
  fastify.post('/api/crawler/stop', crawlerController.stopCrawlers);
  fastify.post('/api/crawler/stop-domain', crawlerController.stopCrawler);
}

module.exports = routes;
