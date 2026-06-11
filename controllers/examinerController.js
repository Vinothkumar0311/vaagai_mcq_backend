const { User, Test, Question, TestAssignment, Result, Answer, sequelize } = require('../models');

// Helper function to shuffle an array (Fisher-Yates)
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Get assigned upcoming tests for logged-in examiner
const getAssignedTests = async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();

    // Fetch all assignments for this email
    const assignments = await TestAssignment.findAll({
      where: { examineeEmail: email }
    });
    const assignedTestIds = new Set(assignments.map(a => a.testId));

    // Get examiner's class
    let examinerClass = req.user.class;
    if (examinerClass === undefined) {
      const dbUser = await User.findByPk(req.user.id);
      examinerClass = dbUser ? dbUser.class : null;
    }
    const cleanExaminerClass = examinerClass ? examinerClass.trim().toLowerCase() : null;

    // Fetch all published tests
    const allPublishedTests = await Test.findAll({
      where: { status: 'PUBLISHED' },
      include: [
        {
          model: Result,
          where: { userId: req.user.id },
          required: false
        }
      ]
    });

    const filteredTests = [];

    for (const test of allPublishedTests) {
      const allowed = Array.isArray(test.allowedClasses) ? test.allowedClasses : [];
      const isClassAllowed = allowed.length === 0 || (cleanExaminerClass && allowed.some(c => c.trim().toLowerCase() === cleanExaminerClass));

      if (assignedTestIds.has(test.id) || isClassAllowed) {
        filteredTests.push(test);
      }
    }

    let questionCount = 0;
    if (cleanExaminerClass) {
      questionCount = await Question.count({
        where: sequelize.where(
          sequelize.fn('lower', sequelize.col('class')),
          cleanExaminerClass
        )
      });
    } else {
      questionCount = await Question.count();
    }

    const tests = filteredTests.map(test => {
      const result = test.Results[0] || null;
      const resultsPublished = !!test.publishResults;
      
      return {
        id: test.id,
        name: test.name,
        date: test.date,
        duration: test.duration,
        status: test.status,
        questionCount: questionCount,
        hasAttempted: !!result,
        score: (result && resultsPublished) ? result.score : null,
        total: (result && resultsPublished) ? result.total : null,
        submittedAt: result ? result.submittedAt : null,
        resultsPublished: resultsPublished
      };
    });

    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get test details & questions for taking the test
const getTestQuestions = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const email = req.user.email.toLowerCase();

  try {
    const test = await Test.findByPk(id);

    if (!test || test.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Test not found or not published.' });
    }

    // 1. Check if test assignment exists
    const assignment = await TestAssignment.findOne({
      where: {
        testId: id,
        examineeEmail: email
      }
    });

    let examinerClass = req.user.class;
    if (examinerClass === undefined) {
      const dbUser = await User.findByPk(userId);
      examinerClass = dbUser ? dbUser.class : null;
    }
    const cleanExaminerClass = examinerClass ? examinerClass.trim().toLowerCase() : null;

    const allowedClasses = Array.isArray(test.allowedClasses) ? test.allowedClasses : [];
    const isClassAllowed = allowedClasses.length === 0 || (cleanExaminerClass && allowedClasses.some(c => c.trim().toLowerCase() === cleanExaminerClass));

    if (!assignment && !isClassAllowed) {
      return res.status(403).json({ error: 'You are not assigned to this test.' });
    }

    // 2. Check if already attempted (Single attempt enforcement)
    const existingResult = await Result.findOne({
      where: {
        testId: id,
        userId
      }
    });

    if (existingResult) {
      return res.status(400).json({
        error: 'Single attempt only. You have already completed this test.',
        result: existingResult
      });
    }

    // Fetch questions matching the examiner's class
    let filteredQuestions = [];
    if (cleanExaminerClass) {
      filteredQuestions = await Question.findAll({
        where: sequelize.where(
          sequelize.fn('lower', sequelize.col('class')),
          cleanExaminerClass
        ),
        attributes: ['id', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'imageUrl', 'class']
      });
    } else {
      filteredQuestions = await Question.findAll({
        attributes: ['id', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'imageUrl', 'class']
      });
    }

    // 5. Randomize question order (Fisher-Yates)
    const randomizedQuestions = shuffleArray(filteredQuestions);

    res.json({
      id: test.id,
      name: test.name,
      duration: test.duration,
      questions: randomizedQuestions
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Submit Test Answers
const submitTest = async (req, res) => {
  const { testId, answers, timeTaken, forceZeroScore } = req.body; // answers: [{ questionId, selectedOption }]
  const userId = req.user.id;

  if (!testId) {
    return res.status(400).json({ error: 'Test ID is required.' });
  }

  try {
    // 1. Ensure only one attempt (for security force-submit, silently return success if already submitted)
    const existingResult = await Result.findOne({
      where: {
        testId,
        userId
      }
    });

    if (existingResult) {
      if (forceZeroScore) {
        // Already submitted (possibly a duplicate security trigger) — return success silently
        return res.status(200).json({
          message: 'Test already submitted.',
          score: null,
          total: null,
          resultId: existingResult.id,
          resultsPublished: false
        });
      }
      return res.status(400).json({ error: 'Single attempt only. You have already submitted answers for this test.' });
    }

    // 2. Fetch test and correct answers for comparison
    const test = await Test.findByPk(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    let examinerClass = req.user.class;
    if (examinerClass === undefined) {
      const dbUser = await User.findByPk(userId);
      examinerClass = dbUser ? dbUser.class : null;
    }
    const cleanExaminerClass = examinerClass ? examinerClass.trim().toLowerCase() : null;

    let questions = [];
    if (cleanExaminerClass) {
      questions = await Question.findAll({
        where: sequelize.where(
          sequelize.fn('lower', sequelize.col('class')),
          cleanExaminerClass
        )
      });
    } else {
      questions = await Question.findAll();
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: 'No questions found for your class.' });
    }

    // Create a map of questionId -> correctAnswer
    const answerKey = {};
    questions.forEach(q => {
      answerKey[q.id] = q.correctAnswer;
    });

    let score = 0;
    const submissionAnswers = [];

    if (forceZeroScore) {
      // Forced zero score (due to fullscreen exit security violation)
      // Use a Set to prevent duplicate questionIds
      const seenIds = new Set();
      questions.forEach(q => {
        if (!seenIds.has(q.id)) {
          seenIds.add(q.id);
          submissionAnswers.push({
            questionId: q.id,
            selectedOption: ''
          });
        }
      });
    } else {
      // Calculate score normally
      const seenIds = new Set();
      (Array.isArray(answers) ? answers : []).forEach(ans => {
        if (!seenIds.has(ans.questionId)) {
          seenIds.add(ans.questionId);
          const correctAnswer = answerKey[ans.questionId];
          if (correctAnswer && ans.selectedOption === correctAnswer) {
            score++;
          }
          submissionAnswers.push({
            questionId: ans.questionId,
            selectedOption: ans.selectedOption || ''
          });
        }
      });
    }

    // 3. Save result and answers in a transaction
    const result = await sequelize.transaction(async (t) => {
      const newResult = await Result.create({
        testId,
        userId,
        score,
        total: questions.length,
        timeTaken: timeTaken || 0,
        examinerEmail: req.user.email,
        examinerName: req.user.name
      }, { transaction: t });

      // Save each submitted answer linked to the result
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
      resultsPublished
    });

  } catch (error) {
    console.error('Submit test error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get Single Result Details
const getResultDetails = async (req, res) => {
  const { id } = req.params; // Result ID or Test ID
  const userId = req.user.id;

  try {
    let result = await Result.findByPk(id, {
      include: [
        { model: Test },
        { model: Answer },
        { model: User }
      ]
    });

    // Fallback: If not found by primary key, try finding by testId and userId
    if (!result) {
      result = await Result.findOne({
        where: { testId: id, userId },
        include: [
          { model: Test },
          { model: Answer },
          { model: User }
        ]
      });
    }

    if (!result) {
      return res.status(404).json({ error: 'Result not found.' });
    }

    // Ensure users can only view their own result (Admins can view any)
    if (result.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Ensure results are published before showing to examiners/test-takers
    const isOwner = result.userId === userId;
    if ((isOwner || req.user.role !== 'ADMIN') && result.Test && !result.Test.publishResults) {
      return res.status(403).json({ error: 'Results for this assessment have not been published by the administrator yet.' });
    }

    // Enrich result with class-based questions for review display
    const plainResult = result.get({ plain: true });
    if (plainResult.Test) {
      let questions = [];
      const userClass = result.User ? result.User.class : null;
      if (userClass) {
        questions = await Question.findAll({
          where: sequelize.where(
            sequelize.fn('lower', sequelize.col('class')),
            userClass.trim().toLowerCase()
          )
        });
      } else {
        questions = await Question.findAll();
      }
      plainResult.Test.Questions = questions.map(q => q.get({ plain: true }));
    }

    const formattedResult = {
      ...plainResult,
      testName: plainResult.Test ? plainResult.Test.name : 'N/A',
      userName: plainResult.User ? plainResult.User.name : 'N/A',
      userEmail: plainResult.User ? plainResult.User.email : 'N/A'
    };

    res.json(formattedResult);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAssignedTests,
  getTestQuestions,
  submitTest,
  getResultDetails
};
