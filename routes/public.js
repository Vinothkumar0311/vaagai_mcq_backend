const express = require('express');
const router = express.Router();
const {
  getPublicTestInfo,
  getPublicTestQuestions,
  submitPublicTest,
} = require('../controllers/publicController');

// Public routes — no authentication required
// These allow anyone with a shareable test URL to take the test

router.get('/test/:id', getPublicTestInfo);
router.get('/test/:id/questions', getPublicTestQuestions);
router.post('/submit', submitPublicTest);

module.exports = router;
