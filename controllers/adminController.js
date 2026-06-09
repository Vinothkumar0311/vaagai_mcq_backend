const { User, Test, Question, TestAssignment, Result, Answer, sequelize } = require('../models');
const { Op } = require('sequelize');
const path = require('path');
const { generateTestId } = require('../utils/generateTestId');
const { processUpload } = require('../utils/uploadQuestions');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'question-images');
const PUBLIC_IMAGE_PATH = '/uploads/question-images';

// Create a new test
const createTest = async (req, res) => {
  const { name, date, duration, examineeEmails, allowedClasses } = req.body;

  if (!name || !date || !duration) {
    return res.status(400).json({ error: 'Test name, date, and duration are required.' });
  }

  try {
    const testId = await generateTestId();

    const test = await Test.create({
      id: testId,
      name,
      date: new Date(date),
      duration: parseInt(duration, 10),
      status: 'DRAFT',
      allowedClasses: Array.isArray(allowedClasses) ? allowedClasses : null
    });

    // If examinees are provided, assign them
    if (Array.isArray(examineeEmails) && examineeEmails.length > 0) {
      const assignments = examineeEmails.map(email => ({
        testId: test.id,
        examineeEmail: email.trim().toLowerCase()
      }));

      await TestAssignment.bulkCreate(assignments, {
        ignoreDuplicates: true
      });
    }

    res.status(201).json(test);
  } catch (error) {
    console.error('Create test error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Upload Questions via Excel (supports text-only, ZIP with images, or Excel + separate image files)
// Accepted upload modes:
//   1. Single Excel file (.xlsx / .xls)  – text-based questions only
//   2. Single ZIP file (.zip)            – must contain one .xlsx and any number of image files
//   3. Excel file + multiple image files – field 'file' = Excel, field 'images' = image files
const uploadQuestions = async (req, res) => {
  const { testId } = req.body;

  if (!testId) {
    return res.status(400).json({ error: 'Test ID is required.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx) or a ZIP archive containing the Excel + images.' });
  }

  try {
    const test = await Test.findByPk(testId);
    if (!test) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    // Separately uploaded image files (multipart field: images)
    const imageFiles = req.files && req.files.images ? req.files.images : [];

    const { questionsData, warnings } = processUpload(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      testId,
      UPLOADS_DIR,
      PUBLIC_IMAGE_PATH,
      imageFiles
    );

    // Delete existing questions for this test and re-insert
    await Question.destroy({ where: { testId } });
    const createdQuestions = await Question.bulkCreate(questionsData);

    res.json({
      message: `Successfully uploaded ${createdQuestions.length} question(s).`,
      count: createdQuestions.length,
      imageCount: createdQuestions.filter(q => q.imageUrl).length,
      warnings: warnings.length > 0 ? warnings : undefined
    });

  } catch (error) {
    console.error('Upload questions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get Examiner Results with Search, Filter & Pagination
const getResults = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';
    const testId = req.query.testId || '';
    const skip = (page - 1) * limit;

    const where = {};
    const userWhere = {};

    if (testId) {
      where.testId = testId;
    }

    if (search) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }

    const { rows: results, count: total } = await Result.findAndCountAll({
      where,
      include: [
        {
          model: User,
          where: search ? userWhere : undefined,
          required: search ? true : false
        },
        {
          model: Test
        }
      ],
      order: [
        ['submittedAt', 'DESC']
      ],
      offset: skip,
      limit: limit
    });

    const mappedResults = results.map(r => {
      const plain = r.get({ plain: true });
      return {
        ...plain,
        userName: plain.examinerName || (plain.User ? plain.User.name : 'N/A'),
        userEmail: plain.examinerEmail || (plain.User ? plain.User.email : 'N/A'),
        testName: plain.Test ? plain.Test.name : 'N/A'
      };
    });

    res.json({
      results: mappedResults,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Export Results to Excel
const exportResults = async (req, res) => {
  try {
    const { testId } = req.query;

    const where = {};
    if (testId) {
      where.testId = testId;
    }

    const results = await Result.findAll({
      where,
      include: [User, Test],
      order: [
        ['submittedAt', 'DESC']
      ]
    });

    // Map data for excel sheet
    const data = results.map(r => ({
      'Result ID': r.id,
      'Test ID': r.testId,
      'Test Name': r.Test.name,
      'Examiner Name': r.examinerName || (r.User ? r.User.name : 'N/A'),
      'Examiner Email': r.examinerEmail || (r.User ? r.User.email : 'N/A'),
      'Score': r.score,
      'Total Questions': r.total,
      'Percentage (%)': ((r.score / r.total) * 100).toFixed(2),
      'Time Taken (seconds)': r.timeTaken,
      'Submitted At': r.submittedAt.toISOString()
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=results.xlsx');
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get List of All Tests
const getTests = async (req, res) => {
  try {
    const tests = await Test.findAll({
      attributes: {
        include: [
          [
            sequelize.literal('(SELECT COUNT(*) FROM questions WHERE questions.testId = Test.id)'),
            'questionCount'
          ],
          [
            sequelize.literal('(SELECT COUNT(*) FROM test_assignments WHERE test_assignments.testId = Test.id)'),
            'assignmentCount'
          ],
          [
            sequelize.literal('(SELECT COUNT(*) FROM results WHERE results.testId = Test.id)'),
            'resultCount'
          ]
        ]
      },
      order: [
        ['createdAt', 'DESC']
      ]
    });

    const formattedTests = tests.map(t => {
      const plain = t.get({ plain: true });
      return {
        id: plain.id,
        name: plain.name,
        date: plain.date,
        duration: plain.duration,
        status: plain.status,
        publishResults: plain.publishResults,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
        _count: {
          questions: plain.questionCount,
          assignments: plain.assignmentCount,
          results: plain.resultCount
        }
      };
    });

    res.json(formattedTests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get details of a single test for Admin (including questions & assigned examiners)
const getTestDetails = async (req, res) => {
  const { id } = req.params;
  try {
    const test = await Test.findByPk(id, {
      include: [
        {
          model: Question
        },
        {
          model: TestAssignment,
          include: [User]
        }
      ]
    });

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a Test
const updateTest = async (req, res) => {
  const { id } = req.params;
  const { name, date, duration, status, publishResults, allowedClasses } = req.body;

  try {
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (date !== undefined) updateData.date = new Date(date);
    if (duration !== undefined) updateData.duration = parseInt(duration, 10);
    if (status !== undefined) updateData.status = status;
    if (publishResults !== undefined) updateData.publishResults = publishResults;
    if (allowedClasses !== undefined) updateData.allowedClasses = Array.isArray(allowedClasses) ? allowedClasses : null;

    await Test.update(updateData, {
      where: { id }
    });

    const updated = await Test.findByPk(id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a Test
const deleteTest = async (req, res) => {
  const { id } = req.params;
  try {
    await Test.destroy({
      where: { id }
    });
    res.json({ message: 'Test deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Assign Examiners
const assignExaminers = async (req, res) => {
  const { testId, examineeEmails } = req.body;

  if (!testId || !Array.isArray(examineeEmails)) {
    return res.status(400).json({ error: 'Test ID and list of examinee emails are required.' });
  }

  try {
    const assignments = examineeEmails.map(email => ({
      testId,
      examineeEmail: email.trim().toLowerCase()
    }));

    await TestAssignment.bulkCreate(assignments, {
      ignoreDuplicates: true
    });

    res.json({ message: 'Examiners assigned successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Remove Assigned Examiner
const removeExaminerAssignment = async (req, res) => {
  const { id } = req.params; // assignment ID

  try {
    await TestAssignment.destroy({
      where: { id }
    });
    res.json({ message: 'Examiner assignment removed.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Dashboard Stats for Admin
const getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.count({ where: { role: 'EXAMINER' } });
    const totalTests = await Test.count();
    const totalResults = await Result.count();

    const recentResults = await Result.findAll({
      limit: 5,
      include: [User, Test],
      order: [
        ['submittedAt', 'DESC']
      ]
    });

    const mappedRecentResults = recentResults.map(r => {
      const plain = r.get({ plain: true });
      return {
        ...plain,
        userName: plain.examinerName || (plain.User ? plain.User.name : 'N/A'),
        userEmail: plain.examinerEmail || (plain.User ? plain.User.email : 'N/A'),
        testName: plain.Test ? plain.Test.name : 'N/A'
      };
    });

    res.json({
      totalUsers,
      totalTests,
      totalResults,
      recentResults: mappedRecentResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// Add a Single Question manually (with optional image upload)
const addQuestion = async (req, res) => {
  const { testId, question, optionA, optionB, optionC, optionD, correctAnswer, explanation } = req.body;

  if (!testId || !optionA || !optionB || !optionC || !optionD || !correctAnswer) {
    return res.status(400).json({ error: 'All fields (testId, optionA–D, correctAnswer) are required.' });
  }

  // If no question text is provided, we must have an image
  if (!question && !req.file) {
    return res.status(400).json({ error: 'Question text is required when no image is uploaded.' });
  }

  if (!['A', 'B', 'C', 'D'].includes(correctAnswer.toUpperCase())) {
    return res.status(400).json({ error: 'Correct Answer must be A, B, C, or D.' });
  }

  try {
    const test = await Test.findByPk(testId);
    if (!test) return res.status(404).json({ error: 'Test not found.' });

    let imageUrl = null;
    if (req.file) {
      const fs = require('fs');
      const ext = path.extname(req.file.originalname).toLowerCase();
      const savedName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      const destPath = path.join(UPLOADS_DIR, savedName);
      fs.writeFileSync(destPath, req.file.buffer);
      imageUrl = `${PUBLIC_IMAGE_PATH}/${savedName}`;
    }

    const q = await Question.create({
      testId,
      question: question || null,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer: correctAnswer.toUpperCase(),
      imageUrl,
      explanation: explanation || null
    });

    res.status(201).json(q);
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update a single question
const updateQuestion = async (req, res) => {
  const { id } = req.params;
  const { question, optionA, optionB, optionC, optionD, correctAnswer, explanation } = req.body;

  try {
    const q = await Question.findByPk(id);
    if (!q) return res.status(404).json({ error: 'Question not found.' });

    let imageUrl = q.imageUrl;
    if (req.file) {
      const fs = require('fs');
      const ext = path.extname(req.file.originalname).toLowerCase();
      const savedName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      const destPath = path.join(UPLOADS_DIR, savedName);
      fs.writeFileSync(destPath, req.file.buffer);
      imageUrl = `${PUBLIC_IMAGE_PATH}/${savedName}`;
    }

    // Ensure we have either question text or an image
    if (!question && !imageUrl && !q.question && !q.imageUrl) {
      return res.status(400).json({ error: 'Question text or image is required.' });
    }

    await q.update({
      question: question !== undefined ? (question || null) : q.question,
      optionA: optionA ?? q.optionA,
      optionB: optionB ?? q.optionB,
      optionC: optionC ?? q.optionC,
      optionD: optionD ?? q.optionD,
      correctAnswer: correctAnswer ? correctAnswer.toUpperCase() : q.correctAnswer,
      imageUrl,
      explanation: explanation !== undefined ? (explanation || null) : q.explanation
    });

    res.json(q);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a single question
const deleteQuestion = async (req, res) => {
  const { id } = req.params;
  try {
    await Question.destroy({ where: { id } });
    res.json({ message: 'Question deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createTest,
  uploadQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  getResults,
  exportResults,
  getTests,
  getTestDetails,
  updateTest,
  deleteTest,
  assignExaminers,
  removeExaminerAssignment,
  getAdminStats
};
