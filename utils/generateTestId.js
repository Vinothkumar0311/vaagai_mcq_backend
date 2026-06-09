const { Test } = require('../models');

async function generateTestId() {
  try {
    // Find the latest test by date created or by sorting descending
    const latestTest = await Test.findOne({
      order: [['createdAt', 'DESC']]
    });

    if (!latestTest) {
      return 'TST-1001';
    }

    // Try to parse the numeric part of the ID
    const match = latestTest.id.match(/^TST-(\d+)$/);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      return `TST-${nextNum}`;
    }

    // If ID format is different, return a new random one
    return `TST-${Math.floor(1000 + Math.random() * 9000)}`;
  } catch (error) {
    console.error('Error generating Test ID:', error);
    return `TST-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

module.exports = { generateTestId };

