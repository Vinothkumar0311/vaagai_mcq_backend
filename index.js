require("dotenv").config();
require("express-async-errors");
// Trigger rebuild for public routes deployment
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const examinerRoutes = require("./routes/examiner");
const publicRoutes = require("./routes/public");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS with support for GitHub Pages subpaths and custom origins
const allowedOrigins = [
  "http://localhost:5173",
  "https://vinothkumar0311.github.io",
  "https://vaagaimcq.vinothvk.in",
];

if (process.env.FRONTEND_URL) {
  try {
    const originUrl = new URL(process.env.FRONTEND_URL).origin;
    if (!allowedOrigins.includes(originUrl)) {
      allowedOrigins.push(originUrl);
    }
  } catch (err) {
    // Ignore invalid URLs
  }
  const cleanUrl = process.env.FRONTEND_URL.replace(/\/$/, "");
  if (!allowedOrigins.includes(cleanUrl)) {
    allowedOrigins.push(cleanUrl);
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some((allowed) => {
        try {
          return origin === allowed || new URL(allowed).origin === origin;
        } catch (e) {
          return origin === allowed;
        }
      });
      if (isAllowed) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded question images statically
app.use(
  "/uploads/question-images",
  express.static(path.join(__dirname, "uploads", "question-images")),
);

// Health Check Route
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
});

// Mounting API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/examiner", examinerRoutes);
app.use("/api/public", publicRoutes);

// 404 Route handler
app.use((req, res, next) => {
  res.status(404).json({ error: "Route not found" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Error Details:", err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error",
  });
});

const { sequelize } = require("./models");

async function seedRegistrationsIfEmpty() {
  try {
    const { ExaminerRegistration } = require("./models");
    const count = await ExaminerRegistration.count();
    if (count > 0) {
      return;
    }
    const xlsx = require("xlsx");
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "..", "emails_test.xlsx");

    if (!fs.existsSync(filePath)) {
      console.log("Seed registry sheet not found at:", filePath);
      return;
    }

    console.log(
      "Registry table is empty. Auto-seeding from emails_test.xlsx...",
    );
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const records = [];
    rows.forEach((row) => {
      let refNo = "";
      let email = "";
      let name = "";
      let className = "";
      let schoolName = "";
      let place = "";
      let mobileNumber = "";

      Object.keys(row).forEach((key) => {
        const cleanKey = key.trim().toLowerCase();
        const val =
          row[key] !== undefined && row[key] !== null
            ? String(row[key]).trim()
            : "";

        if (
          [
            "ref no",
            "ref_no",
            "refno",
            "registration number",
            "reg no",
            "reg_no",
            "id",
          ].includes(cleanKey)
        ) {
          refNo = val;
        } else if (
          ["email", "email address", "email_address"].includes(cleanKey)
        ) {
          email = val;
        } else if (
          ["name", "full name", "fullname", "examiner name"].includes(cleanKey)
        ) {
          name = val;
        } else if (["class", "grade", "standard"].includes(cleanKey)) {
          className = val;
        } else if (
          ["schoool name", "school name", "school_name", "school"].includes(
            cleanKey,
          )
        ) {
          schoolName = val;
        } else if (
          ["place", "city", "location", "address"].includes(cleanKey)
        ) {
          place = val;
        } else if (
          [
            "mobile number",
            "mobile_number",
            "mobilenumber",
            "mobile",
            "phone",
            "phone number",
            "contact",
          ].includes(cleanKey)
        ) {
          mobileNumber = val;
        }
      });

      if (refNo && email) {
        records.push({
          refNo,
          email: email.toLowerCase(),
          name: name || null,
          class: className || null,
          schoolName: schoolName || null,
          place: place || null,
          mobileNumber: mobileNumber || null,
        });
      }
    });

    if (records.length > 0) {
      await ExaminerRegistration.bulkCreate(records, {
        ignoreDuplicates: true,
      });
      console.log(
        `Successfully seeded ${records.length} registrations from emails_test.xlsx!`,
      );
    }
  } catch (err) {
    console.error("Error auto-seeding registrations:", err);
  }
}

// Function to alter database and tables to utf8mb4 to support unicode/Tamil characters
async function ensureUtf8mb4() {
  try {
    const dbName = process.env.DB_NAME;
    console.log(`Ensuring database and tables use utf8mb4 character set...`);

    await sequelize.query(`SET FOREIGN_KEY_CHECKS = 0;`);
    await sequelize.query(
      `ALTER DATABASE \`${dbName}\` CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;`,
    );

    const tables = [
      "users",
      "tests",
      "questions",
      "test_assignments",
      "results",
      "answers",
      "examiner_registrations",
    ];
    for (const table of tables) {
      await sequelize.query(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
      );
    }
    await sequelize.query(`SET FOREIGN_KEY_CHECKS = 1;`);
    console.log(`Database and tables successfully converted to utf8mb4!`);
  } catch (err) {
    await sequelize.query(`SET FOREIGN_KEY_CHECKS = 1;`).catch(() => {});
    console.error(`Error converting database/tables to utf8mb4:`, err.message);
  }
}

// Sync Database and Start Server
sequelize
  .authenticate()
  .then(() => {
    console.log("Database connected successfully via Sequelize.");
    return sequelize.sync();
  })
  .then(async () => {
    await ensureUtf8mb4();
    // Allow userId to be NULL in results table (needed for public/unauthenticated submissions)
    try {
      await sequelize.query(
        "ALTER TABLE `results` MODIFY `userId` CHAR(36) NULL;"
      );
      console.log("results.userId column updated to allow NULL.");
    } catch (err) {
      // Column may already allow NULL \u2014 safe to ignore
      if (!err.message.includes("Duplicate column") && !err.message.includes("doesn't exist")) {
        console.warn("Could not alter results.userId column:", err.message);
      }
    }
    await seedRegistrationsIfEmpty();
    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(` MCQ Examination Server is Running!`);
      console.log(` Port: ${PORT}`);
      console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`=========================================`);
    });
  })
  .catch((err) => {
    console.error("Database connection / synchronization failed:", err);
  });
