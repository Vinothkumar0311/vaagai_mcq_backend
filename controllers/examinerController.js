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

    // Find tests assigned to this email
    const assignments = await TestAssignment.findAll({
      where: {
        examineeEmail: email
      },
      include: [
        {
          model: Test,
          include: [
            {
              model: Question,
              attributes: ['id']
            },
            {
              model: Result,
              where: { userId: req.user.id },
              required: false
            }
          ]
        }
      ]
    });

    const tests = assignments.map(a => {
      const test = a.Test;
      const result = test.Results[0] || null;
      const resultsPublished = !!test.publishResults;
      
      return {
        id: test.id,
        name: test.name,
        date: test.date,
        duration: test.duration,
        status: test.status,
        questionCount: test.Questions.length,
        hasAttempted: !!result,
        score: (result && resultsPublished) ? result.score : null,
        total: (result && resultsPublished) ? result.total : null,
        submittedAt: result ? result.submittedAt : null,
        resultsPublished: resultsPublished
      };
    });

    // Only return published tests
    const publishedTests = tests.filter(t => t.status === 'PUBLISHED');

    res.json(publishedTests);
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
    // 1. Check if test assignment exists
    const assignment = await TestAssignment.findOne({
      where: {
        testId: id,
        examineeEmail: email
      }
    });

    if (!assignment) {
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

    // 3. Fetch test and questions
    const test = await Test.findByPk(id, {
      include: [
        {
          model: Question,
          attributes: ['id', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'imageUrl', 'class']
        }
      ]
    });

    if (!test || test.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Test not found or not published.' });
    }

    // 4. Filter questions by examiner class
    let examinerClass = req.user.class;
    if (examinerClass === undefined) {
      const dbUser = await User.findByPk(userId);
      examinerClass = dbUser ? dbUser.class : null;
    }

    const cleanExaminerClass = examinerClass ? examinerClass.trim().toLowerCase() : null;
    let filteredQuestions = test.Questions || [];
    
    if (cleanExaminerClass) {
      filteredQuestions = filteredQuestions.filter(q => {
        return q.class && q.class.trim().toLowerCase() === cleanExaminerClass;
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

  if (!testId || (!forceZeroScore && !Array.isArray(answers))) {
    return res.status(400).json({ error: 'Test ID and answers list are required.' });
  }

  try {
    // 1. Ensure only one attempt
    const existingResult = await Result.findOne({
      where: {
        testId,
        userId
      }
    });

    if (existingResult) {
      return res.status(400).json({ error: 'Single attempt only. You have already submitted answers for this test.' });
    }

    // 2. Fetch test and correct answers for comparison
    const test = await Test.findByPk(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    const questions = await Question.findAll({
      where: { testId }
    });

    if (questions.length === 0) {
      return res.status(400).json({ error: 'No questions found for this test.' });
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
      questions.forEach(q => {
        submissionAnswers.push({
          questionId: q.id,
          selectedOption: ''
        });
      });
    } else {
      // Calculate score normally
      answers.forEach(ans => {
        const correctAnswer = answerKey[ans.questionId];
        if (correctAnswer && ans.selectedOption === correctAnswer) {
          score++;
        }
        submissionAnswers.push({
          questionId: ans.questionId,
          selectedOption: ans.selectedOption || ''
        });
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
        {
          model: Test,
          include: [Question]
        },
        {
          model: Answer
        },
        {
          model: User
        }
      ]
    });

    // Fallback: If not found by primary key, try finding by testId and userId
    if (!result) {
      result = await Result.findOne({
        where: { testId: id, userId },
        include: [
          {
            model: Test,
            include: [Question]
          },
          {
            model: Answer
          },
          {
            model: User
          }
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

    const plain = result.get({ plain: true });
    const formattedResult = {
      ...plain,
      testName: plain.Test ? plain.Test.name : 'N/A',
      userName: plain.User ? plain.User.name : 'N/A',
      userEmail: plain.User ? plain.User.email : 'N/A'
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
