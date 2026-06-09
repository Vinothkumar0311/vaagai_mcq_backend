const express = require('express');
const router = express.Router();
const {
  getAssignedTests,
  getTestQuestions,
  submitTest,
  getResultDetails
} = require('../controllers/examinerController');
const { authenticateToken, requireExaminer } = require('../middleware/auth');

// All examiner routes are protected by auth token and require EXAMINER or ADMIN role
router.use(authenticateToken, requireExaminer);

// Examiner endpoints
router.get('/tests', getAssignedTests);
router.get('/test/:id', getTestQuestions);
router.post('/submit', submitTest);
router.get('/result/:id', getResultDetails);

module.exports = router;
