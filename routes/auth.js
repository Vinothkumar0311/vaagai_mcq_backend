const express = require('express');
const router = express.Router();
const { googleLogin, getProfile, examinerRegNoLogin } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// Public route for Google Authentication
router.post('/google', googleLogin);

// Public route for Registration Number Examiner Login
router.post('/examiner-login', examinerRegNoLogin);

// Protected route to get logged-in user profile
router.get('/profile', authenticateToken, getProfile);

module.exports = router;
