const {
  User,
  Test,
  Question,
  TestAssignment,
  Result,
  Answer,
  sequelize,
} = require("../models");
const { Op } = require("sequelize");
const path = require("path");
const { generateTestId } = require("../utils/generateTestId");
const { processUpload } = require("../utils/uploadQuestions");
const {
  getClassGroup,
  resolveCanonicalClassRange,
  parseAllowedClasses,
} = require("../utils/classMapper");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "question-images");
const PUBLIC_IMAGE_PATH = "/uploads/question-images";

// Create a new test
const createTest = async (req, res) => {
  const { name, date, duration, examineeEmails, allowedClasses } = req.body;

  if (!name || !date || !duration) {
    return res
      .status(400)
      .json({ error: "Test name, date, and duration are required." });
  }

  try {
    const testId = await generateTestId();

    const test = await Test.create({
      id: testId,
      name,
      date: new Date(date),
      duration: parseInt(duration, 10),
      status: "DRAFT",
      allowedClasses: Array.isArray(allowedClasses) ? allowedClasses : null,
    });

    // If examinees are provided, assign them
    if (Array.isArray(examineeEmails) && examineeEmails.length > 0) {
      const assignments = examineeEmails.map((email) => ({
        testId: test.id,
        examineeEmail: email.trim().toLowerCase(),
      }));

      await TestAssignment.bulkCreate(assignments, {
        ignoreDuplicates: true,
      });
    }

    res.status(201).json(test);
  } catch (error) {
    console.error("Create test error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Upload Questions via Excel to the Global Question Bank (class-tagged, no testId required)
// Accepted upload modes:
//   1. Single Excel file (.xlsx / .xls)  – questions must have a "Class" column
//   2. Single ZIP file (.zip)            – must contain one .xlsx and any number of image files
//   3. Excel file + multiple image files – field 'file' = Excel, field 'images' = image files
const uploadQuestions = async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({
        error:
          "Please upload an Excel file (.xlsx) or a ZIP archive containing the Excel + images.",
      });
  }

  try {
    // Separately uploaded image files (multipart field: images)
    const imageFiles = req.files && req.files.images ? req.files.images : [];

    const { questionsData, warnings } = processUpload(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      null, // no testId — global question bank
      UPLOADS_DIR,
      PUBLIC_IMAGE_PATH,
      imageFiles,
    );

    // Collect all classes/ranges present in the uploaded sheet
    const classesToDelete = new Set();
    questionsData.forEach((q) => {
      if (q.class) {
        const group = getClassGroup(q.class);
        group.forEach((gc) => classesToDelete.add(gc.trim().toLowerCase()));
      }
    });

    // Delete older questions belonging to these class groups
    if (classesToDelete.size > 0) {
      await Question.destroy({
        where: {
          class: {
            [Op.in]: Array.from(classesToDelete),
          },
        },
      });
    }

    // Fetch all remaining existing questions to check for duplicates in DB
    const existing = await Question.findAll();
    const seen = new Set();

    // Populate seen with DB questions
    existing.forEach((q) => {
      const normQuestion = (q.question || "").trim().toLowerCase();
      const normClass = (q.class || "").trim().toLowerCase();
      const normA = (q.optionA || "").trim().toLowerCase();
      const normB = (q.optionB || "").trim().toLowerCase();
      const normC = (q.optionC || "").trim().toLowerCase();
      const normD = (q.optionD || "").trim().toLowerCase();
      const normAns = (q.correctAnswer || "").trim().toUpperCase();

      const key = `${normQuestion}|${normClass}|${normA}|${normB}|${normC}|${normD}|${normAns}`;
      seen.add(key);
    });

    const uniqueQuestionsToInsert = [];
    let duplicateFileCount = 0;
    let duplicateDbCount = 0;
    const batchSeen = new Set();

    questionsData.forEach((q) => {
      const normQuestion = (q.question || "").trim().toLowerCase();
      const normClass = (q.class || "").trim().toLowerCase();
      const normA = (q.optionA || "").trim().toLowerCase();
      const normB = (q.optionB || "").trim().toLowerCase();
      const normC = (q.optionC || "").trim().toLowerCase();
      const normD = (q.optionD || "").trim().toLowerCase();
      const normAns = (q.correctAnswer || "").trim().toUpperCase();

      const key = `${normQuestion}|${normClass}|${normA}|${normB}|${normC}|${normD}|${normAns}`;

      if (batchSeen.has(key)) {
        duplicateFileCount++;
      } else if (seen.has(key)) {
        duplicateDbCount++;
      } else {
        batchSeen.add(key);
        uniqueQuestionsToInsert.push(q);
      }
    });

    let createdCount = 0;
    let createdQuestions = [];
    if (uniqueQuestionsToInsert.length > 0) {
      createdQuestions = await Question.bulkCreate(uniqueQuestionsToInsert);
      createdCount = createdQuestions.length;
    }

    let message = "";
    if (createdCount > 0) {
      message = `Successfully uploaded ${createdCount} new question(s).`;
      if (duplicateDbCount > 0 || duplicateFileCount > 0) {
        message += ` Skipped ${duplicateDbCount} duplicate question(s) already in bank, and ${duplicateFileCount} repeated question(s) inside the file.`;
      }
    } else {
      message = `No new questions were added. All ${duplicateDbCount + duplicateFileCount} uploaded question(s) already exist.`;
    }

    res.json({
      message,
      count: createdCount,
      imageCount: createdQuestions.filter((q) => q.imageUrl).length,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    console.error("Upload questions error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get All Questions from the Global Question Bank (with class filter & pagination)
const getQuestions = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const search = req.query.search || "";
    const className = req.query.class || "";
    const skip = (page - 1) * limit;

    const where = {};
    if (className) {
      if (className === "Unassigned") {
        where.class = { [Op.or]: [null, ""] };
      } else {
        const classGroup = getClassGroup(className);
        where.class = { [Op.in]: classGroup };
      }
    }
    if (search) {
      where.question = { [Op.like]: `%${search}%` };
    }

    const { rows: questions, count: total } = await Question.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset: skip,
      limit,
    });

    // Class wise distribution of questions
    const distribution = await Question.findAll({
      attributes: [
        [sequelize.col("class"), "className"],
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      ],
      group: ["class"],
    });

    const classDistribution = distribution.map((d) => {
      const plain = d.get({ plain: true });
      return {
        className: plain.className || "Unassigned",
        count: parseInt(plain.count, 10) || 0,
      };
    });

    res.json({
      questions,
      classDistribution,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Examiner Results with Search, Filter & Pagination
const getResults = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || "";
    const testId = req.query.testId || "";
    const skip = (page - 1) * limit;

    const where = {};
    const userWhere = {};

    if (testId) {
      where.testId = testId;
    }

    if (search) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows: results, count: total } = await Result.findAndCountAll({
      where,
      include: [
        {
          model: User,
          where: search ? userWhere : undefined,
          required: search ? true : false,
        },
        {
          model: Test,
        },
      ],
      order: [["submittedAt", "DESC"]],
      offset: skip,
      limit: limit,
    });

    const mappedResults = results.map((r) => {
      const plain = r.get({ plain: true });
      return {
        ...plain,
        userName: plain.examinerName || (plain.User ? plain.User.name : "N/A"),
        userEmail:
          plain.examinerEmail || (plain.User ? plain.User.email : "N/A"),
        testName: plain.Test ? plain.Test.name : "N/A",
      };
    });

    res.json({
      results: mappedResults,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
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
      order: [["submittedAt", "DESC"]],
    });

    // Map data for excel sheet
    const data = results.map((r) => ({
      "Result ID": r.id,
      "Test ID": r.testId,
      "Test Name": r.Test.name,
      "Examiner Name": r.examinerName || (r.User ? r.User.name : "N/A"),
      "Examiner Email": r.examinerEmail || (r.User ? r.User.email : "N/A"),
      Score: r.score,
      "Total Questions": r.total,
      "Percentage (%)": ((r.score / r.total) * 100).toFixed(2),
      "Time Taken (seconds)": r.timeTaken,
      "Submitted At": r.submittedAt.toISOString(),
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Results");

    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=results.xlsx");
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
            sequelize.literal(
              "(SELECT COUNT(*) FROM test_assignments WHERE test_assignments.testId = Test.id)",
            ),
            "assignmentCount",
          ],
          [
            sequelize.literal(
              "(SELECT COUNT(*) FROM results WHERE results.testId = Test.id)",
            ),
            "resultCount",
          ],
        ],
      },
      order: [["createdAt", "DESC"]],
    });

    // Fetch counts grouped by class
    const questionCountsByClass = await Question.findAll({
      attributes: [
        [sequelize.fn("lower", sequelize.col("class")), "classGroup"],
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      ],
      group: [sequelize.fn("lower", sequelize.col("class"))],
    });

    const classCountMap = {};
    let totalQuestionsCount = 0;
    questionCountsByClass.forEach((q) => {
      const cls = q.getDataValue("classGroup")
        ? q.getDataValue("classGroup").trim().toLowerCase()
        : "noclass";
      const cnt = parseInt(q.getDataValue("count"), 10) || 0;
      classCountMap[cls] = cnt;
      totalQuestionsCount += cnt;
    });

    const formattedTests = tests.map((t) => {
      const plain = t.get({ plain: true });

      let qCount = 0;
      const allowed = parseAllowedClasses(plain.allowedClasses);
      if (allowed.length > 0) {
        const uniqueResolvedClasses = new Set();
        allowed.forEach((c) => {
          getClassGroup(c).forEach((gc) =>
            uniqueResolvedClasses.add(gc.toLowerCase()),
          );
        });
        uniqueResolvedClasses.forEach((c) => {
          qCount += classCountMap[c] || 0;
        });
      } else {
        qCount = totalQuestionsCount;
      }

      return {
        id: plain.id,
        name: plain.name,
        date: plain.date,
        duration: plain.duration,
        status: plain.status,
        publishResults: plain.publishResults,
        allowedClasses: allowed,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
        _count: {
          questions: qCount,
          assignments: plain.assignmentCount,
          results: plain.resultCount,
        },
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
          model: TestAssignment,
          include: [User],
        },
      ],
    });

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const allowed = parseAllowedClasses(test.allowedClasses);
    let questions = [];
    if (allowed.length > 0) {
      const allAllowedClasses = new Set();
      allowed.forEach((c) => {
        getClassGroup(c).forEach((gc) => allAllowedClasses.add(gc));
      });
      questions = await Question.findAll({
        where: {
          class: {
            [Op.in]: Array.from(allAllowedClasses),
          },
        },
      });
    } else {
      questions = await Question.findAll();
    }

    const plainTest = test.get({ plain: true });
    plainTest.allowedClasses = allowed;
    plainTest.Questions = questions;

    res.json(plainTest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a Test
const updateTest = async (req, res) => {
  const { id } = req.params;
  const { name, date, duration, status, publishResults, allowedClasses } =
    req.body;

  try {
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (date !== undefined) updateData.date = new Date(date);
    if (duration !== undefined) updateData.duration = parseInt(duration, 10);
    if (status !== undefined) updateData.status = status;
    if (publishResults !== undefined)
      updateData.publishResults = publishResults;
    if (allowedClasses !== undefined)
      updateData.allowedClasses = Array.isArray(allowedClasses)
        ? allowedClasses
        : null;

    await Test.update(updateData, {
      where: { id },
    });

    const updated = await Test.findByPk(id);
    const plainUpdated = updated.get({ plain: true });
    plainUpdated.allowedClasses = parseAllowedClasses(plainUpdated.allowedClasses);
    res.json(plainUpdated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a Test
const deleteTest = async (req, res) => {
  const { id } = req.params;
  try {
    await Test.destroy({
      where: { id },
    });
    res.json({ message: "Test deleted successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Assign Examiners
const assignExaminers = async (req, res) => {
  const { testId, examineeEmails } = req.body;

  if (!testId || !Array.isArray(examineeEmails)) {
    return res
      .status(400)
      .json({ error: "Test ID and list of examinee emails are required." });
  }

  try {
    const assignments = examineeEmails.map((email) => ({
      testId,
      examineeEmail: email.trim().toLowerCase(),
    }));

    await TestAssignment.bulkCreate(assignments, {
      ignoreDuplicates: true,
    });

    res.json({ message: "Examiners assigned successfully." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Remove Assigned Examiner
const removeExaminerAssignment = async (req, res) => {
  const { id } = req.params; // assignment ID

  try {
    await TestAssignment.destroy({
      where: { id },
    });
    res.json({ message: "Examiner assignment removed." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Dashboard Stats for Admin
const getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.count({ where: { role: "EXAMINER" } });
    const totalTests = await Test.count();
    const totalResults = await Result.count();

    const recentResults = await Result.findAll({
      limit: 5,
      include: [User, Test],
      order: [["submittedAt", "DESC"]],
    });

    const mappedRecentResults = recentResults.map((r) => {
      const plain = r.get({ plain: true });
      return {
        ...plain,
        userName: plain.examinerName || (plain.User ? plain.User.name : "N/A"),
        userEmail:
          plain.examinerEmail || (plain.User ? plain.User.email : "N/A"),
        testName: plain.Test ? plain.Test.name : "N/A",
      };
    });

    res.json({
      totalUsers,
      totalTests,
      totalResults,
      recentResults: mappedRecentResults,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add a Single Question manually to the Global Question Bank (no testId required)
const addQuestion = async (req, res) => {
  const {
    question,
    optionA,
    optionB,
    optionC,
    optionD,
    correctAnswer,
    explanation,
    class: questionClass,
  } = req.body;

  if (!optionA || !optionB || !optionC || !optionD || !correctAnswer) {
    return res
      .status(400)
      .json({ error: "All fields (optionA–D, correctAnswer) are required." });
  }

  // If no question text is provided, we must have an image
  if (!question && !req.file) {
    return res
      .status(400)
      .json({ error: "Question text is required when no image is uploaded." });
  }

  if (!["A", "B", "C", "D"].includes(correctAnswer.toUpperCase())) {
    return res
      .status(400)
      .json({ error: "Correct Answer must be A, B, C, or D." });
  }

  try {
    // Check if duplicate question already exists in DB
    const duplicateCheck = await Question.findOne({
      where: {
        question: question || null,
        class: resolveCanonicalClassRange(questionClass) || null,
        optionA: optionA,
        optionB: optionB,
        optionC: optionC,
        optionD: optionD,
        correctAnswer: correctAnswer.toUpperCase(),
      },
    });

    if (duplicateCheck) {
      return res
        .status(400)
        .json({ error: "This question already exists in the question bank." });
    }

    let imageUrl = null;
    if (req.file) {
      const fs = require("fs");
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const ext = path.extname(req.file.originalname).toLowerCase();
      const savedName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      const destPath = path.join(UPLOADS_DIR, savedName);
      fs.writeFileSync(destPath, req.file.buffer);
      imageUrl = `${PUBLIC_IMAGE_PATH}/${savedName}`;
    }

    const q = await Question.create({
      testId: null,
      question: question || null,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer: correctAnswer.toUpperCase(),
      imageUrl,
      explanation: explanation || null,
      class: resolveCanonicalClassRange(questionClass) || null,
    });

    res.status(201).json(q);
  } catch (error) {
    console.error("Add question error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update a single question
const updateQuestion = async (req, res) => {
  const { id } = req.params;
  const {
    question,
    optionA,
    optionB,
    optionC,
    optionD,
    correctAnswer,
    explanation,
    class: questionClass,
  } = req.body;

  try {
    const q = await Question.findByPk(id);
    if (!q) return res.status(404).json({ error: "Question not found." });

    let imageUrl = q.imageUrl;
    if (req.file) {
      const fs = require("fs");
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const ext = path.extname(req.file.originalname).toLowerCase();
      const savedName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      const destPath = path.join(UPLOADS_DIR, savedName);
      fs.writeFileSync(destPath, req.file.buffer);
      imageUrl = `${PUBLIC_IMAGE_PATH}/${savedName}`;
    }

    // Ensure we have either question text or an image
    if (!question && !imageUrl && !q.question && !q.imageUrl) {
      return res
        .status(400)
        .json({ error: "Question text or image is required." });
    }

    await q.update({
      question: question !== undefined ? question || null : q.question,
      optionA: optionA ?? q.optionA,
      optionB: optionB ?? q.optionB,
      optionC: optionC ?? q.optionC,
      optionD: optionD ?? q.optionD,
      correctAnswer: correctAnswer
        ? correctAnswer.toUpperCase()
        : q.correctAnswer,
      imageUrl,
      explanation:
        explanation !== undefined ? explanation || null : q.explanation,
      class:
        questionClass !== undefined
          ? resolveCanonicalClassRange(questionClass) || null
          : q.class,
    });

    res.json(q);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete all duplicate questions
const deleteDuplicateQuestions = async (req, res) => {
  try {
    const questions = await Question.findAll({
      order: [["createdAt", "ASC"]],
    });

    const seen = new Set();
    const deleteIds = [];

    questions.forEach((q) => {
      // Create a unique hash key for comparison
      const normQuestion = (q.question || "").trim().toLowerCase();
      const normClass = (q.class || "").trim().toLowerCase();
      const normA = (q.optionA || "").trim().toLowerCase();
      const normB = (q.optionB || "").trim().toLowerCase();
      const normC = (q.optionC || "").trim().toLowerCase();
      const normD = (q.optionD || "").trim().toLowerCase();
      const normAns = (q.correctAnswer || "").trim().toUpperCase();
      const normImg = (q.imageUrl || "").trim().toLowerCase();

      const key = `${normQuestion}|${normClass}|${normA}|${normB}|${normC}|${normD}|${normAns}|${normImg}`;

      if (seen.has(key)) {
        deleteIds.push(q.id);
      } else {
        seen.add(key);
      }
    });

    let deletedCount = 0;
    if (deleteIds.length > 0) {
      deletedCount = await Question.destroy({
        where: {
          id: deleteIds,
        },
      });
    }

    res.json({
      message: `Successfully removed ${deletedCount} duplicate question(s).`,
      count: deletedCount,
    });
  } catch (error) {
    console.error("Delete duplicates error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Delete a single question
const deleteQuestion = async (req, res) => {
  const { id } = req.params;
  try {
    await Question.destroy({ where: { id } });
    res.json({ message: "Question deleted." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createTest,
  uploadQuestions,
  getQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  deleteDuplicateQuestions,
  getResults,
  exportResults,
  getTests,
  getTestDetails,
  updateTest,
  deleteTest,
  assignExaminers,
  removeExaminerAssignment,
  getAdminStats,
};
