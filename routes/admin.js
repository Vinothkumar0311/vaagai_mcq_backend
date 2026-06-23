const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
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
} = require("../controllers/adminController");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

// All admin routes are protected by auth token and require ADMIN role
router.use(authenticateToken, requireAdmin);

// ---------------------------------------------------------------------------
// Multer setup for question uploads
// Accepts:
//   Mode 1: Single Excel file                 → field "file"
//   Mode 2: Single ZIP file (Excel + images)  → field "file"
//   Mode 3: Excel + multiple image files      → fields "file" + "images"
// ---------------------------------------------------------------------------
const ALLOWED_EXCEL_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const ALLOWED_ZIP_MIMES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "application/octet-stream",
];
const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

const uploadStorage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max per file
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "file") {
      // Accept Excel or ZIP
      if (
        [...ALLOWED_EXCEL_MIMES, ...ALLOWED_ZIP_MIMES].includes(file.mimetype)
      ) {
        cb(null, true);
      } else {
        cb(
          new Error(
            'The "file" field must be an Excel (.xlsx, .xls) or ZIP (.zip) file.',
          ),
        );
      }
    } else if (file.fieldname === "images") {
      // Accept image files
      if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `Unsupported image type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WebP, BMP, SVG.`,
          ),
        );
      }
    } else {
      cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
  },
});

// Test CRUD
router.post("/test", createTest);
router.get("/tests", getTests);
router.get("/test/:id", getTestDetails);
router.put("/test/:id", updateTest);
router.delete("/test/:id", deleteTest);

// Question Bank (global, class-tagged)
router.get("/questions", getQuestions);

// Question Upload
// Supports: Excel only | ZIP (Excel + images) | Excel + separate image files
router.post(
  "/upload-questions",
  uploadStorage.fields([
    { name: "file", maxCount: 1 },
    { name: "images", maxCount: 200 },
  ]),
  (req, res, next) => {
    // Normalise: multer.fields puts files in req.files; move the primary file to req.file
    if (req.files && req.files.file && req.files.file.length > 0) {
      req.file = req.files.file[0];
    }
    next();
  },
  uploadQuestions,
);

// Single Question CRUD (manual add/edit/delete)
// Image upload (field: image) is optional for add/update
const singleImageUpload = uploadStorage.fields([
  { name: "image", maxCount: 1 },
]);
const singleImageMiddleware = (req, res, next) => {
  singleImageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (req.files && req.files.image && req.files.image.length > 0) {
      req.file = req.files.image[0];
    }
    next();
  });
};
router.post("/question", singleImageMiddleware, addQuestion);
router.put("/question/:id", singleImageMiddleware, updateQuestion);
router.delete("/question/:id", deleteQuestion);
router.delete("/questions/duplicates", deleteDuplicateQuestions);

// Examiner Assignments
router.post("/assign", assignExaminers);
router.delete("/assign/:id", removeExaminerAssignment);

// Dashboard & Reports
router.get("/stats", getAdminStats);
router.get("/results", getResults);
router.get("/export-results", exportResults);

// Examiner Registrations (CRUD & Bulk Import)
const registrationController = require("../controllers/registrationController");
router.get("/registrations", registrationController.getRegistrations);
router.get("/registrations/classes", registrationController.getDistinctClasses);
router.post("/registrations", registrationController.addRegistration);
router.put("/registrations/:refNo", registrationController.updateRegistration);
router.delete(
  "/registrations/:refNo",
  registrationController.deleteRegistration,
);
router.post(
  "/registrations/import",
  uploadStorage.single("file"),
  registrationController.importRegistrations,
);

module.exports = router;
