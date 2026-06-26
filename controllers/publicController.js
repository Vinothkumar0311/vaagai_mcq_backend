const { Op } = require('sequelize');
const {
  Test,
  Question,
  Result,
  Answer,
  sequelize,
} = require('../models');
const { getClassGroup } = require('../utils/classMapper');

// Helper function to shuffle an array (Fisher-Yates)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// GET /api/public/test/:id  — Fetch public test info (name, duration, question count)
const getPublicTestInfo = async (req, res) => {
  const { id } = req.params;
  try {
    const test = await Test.findByPk(id);
    if (!test || test.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Test not found or not available.' });
    }

    // Count questions
    let questionCount = 0;
    const allowed = Array.isArray(test.allowedClasses) ? test.allowedClasses : [];
    if (allowed.length > 0) {
      const allClasses = new Set();
      allowed.forEach(c => {
        getClassGroup(c).forEach(gc => allClasses.add(gc));
      });
      questionCount = await Question.count({
        where: { class: { [Op.in]: Array.from(allClasses) } }
      });
    } else {
      questionCount = await Question.count();
    }

    res.json({
      id: test.id,
      name: test.name,
      duration: test.duration,
      questionCount,
    });
  } catch (error) {
    console.error('getPublicTestInfo error:', error);
    res.status(500).json({ error: error.message });
  }
};

// GET /api/public/test/:id/questions — Fetch shuffled questions for public test
// Requires ?sessionId=<uuid>&name=<name> as query params (set during name entry)
const getPublicTestQuestions = async (req, res) => {
  const { id } = req.params;
  const { sessionId, name } = req.query;

  if (!sessionId || !name) {
    return res.status(400).json({ error: 'sessionId and name are required.' });
  }

  try {
    const test = await Test.findByPk(id);
    if (!test || test.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Test not found or not available.' });
    }

    // Check if this session already submitted
    const existingResult = await Result.findOne({
      where: {
        testId: id,
        // Use examinerEmail to store sessionId for public attempts
        examinerEmail: `public:${sessionId}`,
      }
    });

    if (existingResult) {
      return res.status(400).json({
        error: 'You have already completed this test.',
        result: existingResult
      });
    }

    // Fetch all questions for this test
    const allowed = Array.isArray(test.allowedClasses) ? test.allowedClasses : [];
    let questions = [];

    if (allowed.length > 0) {
      const allClasses = new Set();
      allowed.forEach(c => {
        getClassGroup(c).forEach(gc => allClasses.add(gc));
      });
      questions = await Question.findAll({
        where: { class: { [Op.in]: Array.from(allClasses) } },
        attributes: ['id', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'imageUrl', 'class']
      });
    } else {
      questions = await Question.findAll({
        attributes: ['id', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'imageUrl', 'class']
      });
    }

    const randomizedQuestions = shuffleArray(questions);

    res.json({
      id: test.id,
      name: test.name,
      duration: test.duration,
      questions: randomizedQuestions,
    });
  } catch (error) {
    console.error('getPublicTestQuestions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/public/submit — Submit answers for a public (no-login) test
const submitPublicTest = async (req, res) => {
  const { testId, sessionId, name, answers, timeTaken, forceZeroScore } = req.body;

  if (!testId || !sessionId || !name) {
    return res.status(400).json({ error: 'testId, sessionId, and name are required.' });
  }

  const publicEmail = `public:${sessionId}`;

  try {
    // Check single attempt enforcement
    const existingResult = await Result.findOne({
      where: {
        testId,
        examinerEmail: publicEmail,
      }
    });

    if (existingResult) {
      if (forceZeroScore) {
        return res.status(200).json({
          message: 'Test already submitted.',
          score: null,
          total: null,
          resultId: existingResult.id,
          resultsPublished: false
        });
      }
      return res.status(400).json({ error: 'You have already submitted this test.' });
    }

    const test = await Test.findByPk(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    // Fetch all questions to compute score
    const allowed = Array.isArray(test.allowedClasses) ? test.allowedClasses : [];
    let questions = [];
    if (allowed.length > 0) {
      const allClasses = new Set();
      allowed.forEach(c => {
        getClassGroup(c).forEach(gc => allClasses.add(gc));
      });
      questions = await Question.findAll({
        where: { class: { [Op.in]: Array.from(allClasses) } }
      });
    } else {
      questions = await Question.findAll();
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: 'No questions found for this test.' });
    }

    const answerKey = {};
    questions.forEach(q => { answerKey[q.id] = q.correctAnswer; });

    let score = 0;
    const submissionAnswers = [];

    if (forceZeroScore) {
      const seenIds = new Set();
      questions.forEach(q => {
        if (!seenIds.has(q.id)) {
          seenIds.add(q.id);
          submissionAnswers.push({ questionId: q.id, selectedOption: '' });
        }
      });
    } else {
      const seenIds = new Set();
      (Array.isArray(answers) ? answers : []).forEach(ans => {
        if (!seenIds.has(ans.questionId)) {
          seenIds.add(ans.questionId);
          const correctAnswer = answerKey[ans.questionId];
          if (correctAnswer && ans.selectedOption === correctAnswer) score++;
          submissionAnswers.push({
            questionId: ans.questionId,
            selectedOption: ans.selectedOption || ''
          });
        }
      });
    }

    // Public submissions have no real userId — null is allowed by the Result model
    const result = await sequelize.transaction(async (t) => {
      const newResult = await Result.create({
        testId,
        userId: null,  // no real user for public submissions
        score,
        total: questions.length,
        timeTaken: timeTaken || 0,
        examinerEmail: publicEmail,
        examinerName: name.trim(),
      }, { transaction: t });

      const answersData = submissionAnswers.map(ans => ({
        resultId: newResult.id,
        questionId: ans.questionId,
        selectedOption: ans.selectedOption
      }));

      await Answer.bulkCreate(answersData, { transaction: t });
      return newResult;
    });

    const resultsPublished = !!test.publishResults;

    res.status(201).json({
      message: 'Test submitted successfully.',
      score: resultsPublished ? result.score : null,
      total: resultsPublished ? result.total : null,
      resultId: result.id,
      resultsPublished,
      testName: test.name,
      name: name.trim(),
    });
  } catch (error) {
    console.error('submitPublicTest error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getPublicTestInfo,
  getPublicTestQuestions,
  submitPublicTest,
};
