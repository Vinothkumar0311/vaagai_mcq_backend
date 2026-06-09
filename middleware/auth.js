const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'MCQ_SECRET_KEY_SUPER_SECURE_123456', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireExaminer = (req, res, next) => {
  if (!req.user || (req.user.role !== 'EXAMINER' && req.user.role !== 'ADMIN')) {
    return res.status(403).json({ error: 'Examiner access required' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireExaminer
};
