const { ExaminerRegistration, Question } = require('../models');
const { Op } = require('sequelize');
const xlsx = require('xlsx');

// Get all registrations with search, filter, and pagination
const getRegistrations = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';
    const className = req.query.class || '';
    const skip = (page - 1) * limit;

    const whereClause = {};

    if (className) {
      whereClause.class = className;
    }

    if (search) {
      whereClause[Op.or] = [
        { refNo: { [Op.like]: `%${search}%` } },
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { schoolName: { [Op.like]: `%${search}%` } },
        { mobileNumber: { [Op.like]: `%${search}%` } }
      ];
    }

    const { rows: registrations, count: total } = await ExaminerRegistration.findAndCountAll({
      where: whereClause,
      order: [['refNo', 'ASC']],
      offset: skip,
      limit: limit
    });

    res.json({
      registrations,
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

// Get distinct classes list for filtering/selecting
const getDistinctClasses = async (req, res) => {
  try {
    const regClasses = await ExaminerRegistration.findAll({
      attributes: ['class'],
      group: ['class'],
      raw: true
    });
    
    const questionClasses = await Question.findAll({
      attributes: ['class'],
      group: ['class'],
      raw: true
    });

    const set = new Set();
    regClasses.forEach(c => {
      if (c.class) set.add(c.class.trim());
    });
    questionClasses.forEach(c => {
      if (c.class) set.add(c.class.trim());
    });

    const classList = Array.from(set).filter(c => c !== '').sort();
    res.json(classList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add a single registration
const addRegistration = async (req, res) => {
  const { refNo, email, name, class: className, schoolName, place, mobileNumber } = req.body;

  if (!refNo || !email) {
    return res.status(400).json({ error: 'Registration Number (Ref No) and Email are required.' });
  }

  try {
    // Check if refNo already exists
    const existing = await ExaminerRegistration.findByPk(refNo);
    if (existing) {
      return res.status(400).json({ error: `Registration number "${refNo}" already exists.` });
    }

    const registration = await ExaminerRegistration.create({
      refNo: refNo.trim(),
      email: email.trim().toLowerCase(),
      name: name ? name.trim() : null,
      class: className ? className.trim() : null,
      schoolName: schoolName ? schoolName.trim() : null,
      place: place ? place.trim() : null,
      mobileNumber: mobileNumber ? mobileNumber.trim() : null
    });

    res.status(201).json(registration);
  } catch (error) {
    res.status(550).json({ error: error.message });
  }
};

// Update an existing registration
const updateRegistration = async (req, res) => {
  const { refNo } = req.params;
  const { email, name, class: className, schoolName, place, mobileNumber } = req.body;

  try {
    const registration = await ExaminerRegistration.findByPk(refNo);
    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found.' });
    }

    await registration.update({
      email: email ? email.trim().toLowerCase() : registration.email,
      name: name !== undefined ? name.trim() : registration.name,
      class: className !== undefined ? className.trim() : registration.class,
      schoolName: schoolName !== undefined ? schoolName.trim() : registration.schoolName,
      place: place !== undefined ? place.trim() : registration.place,
      mobileNumber: mobileNumber !== undefined ? mobileNumber.trim() : registration.mobileNumber
    });

    res.json(registration);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a registration
const deleteRegistration = async (req, res) => {
  const { refNo } = req.params;

  try {
    const registration = await ExaminerRegistration.findByPk(refNo);
    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found.' });
    }

    await registration.destroy();
    res.json({ message: 'Registration deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Bulk Import from Excel
const importRegistrations = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx or .xls).' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel sheet has no data.' });
    }

    const records = [];
    const errors = [];

    rows.forEach((row, index) => {
      let refNo = '';
      let email = '';
      let name = '';
      let className = '';
      let schoolName = '';
      let place = '';
      let mobileNumber = '';

      Object.keys(row).forEach(key => {
        const cleanKey = key.trim().toLowerCase();
        const val = row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : '';

        if (['ref no', 'ref_no', 'refno', 'registration number', 'reg no', 'reg_no', 'id'].includes(cleanKey)) {
          refNo = val;
        } else if (['email', 'email address', 'email_address'].includes(cleanKey)) {
          email = val;
        } else if (['name', 'full name', 'fullname', 'examiner name'].includes(cleanKey)) {
          name = val;
        } else if (['class', 'grade', 'standard'].includes(cleanKey)) {
          className = val;
        } else if (['schoool name', 'school name', 'school_name', 'school'].includes(cleanKey)) {
          schoolName = val;
        } else if (['place', 'city', 'location', 'address'].includes(cleanKey)) {
          place = val;
        } else if (['mobile number', 'mobile_number', 'mobilenumber', 'mobile', 'phone', 'phone number', 'contact'].includes(cleanKey)) {
          mobileNumber = val;
        }
      });

      if (!refNo || !email) {
        errors.push(`Row ${index + 2}: Missing Registration Number (Ref No) or Email.`);
        return;
      }

      records.push({
        refNo,
        email: email.toLowerCase(),
        name: name || null,
        class: className || null,
        schoolName: schoolName || null,
        place: place || null,
        mobileNumber: mobileNumber || null
      });
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Import failed with validation errors.', details: errors });
    }

    // Insert or update one by one to handle existing records
    let createdCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const [existing, created] = await ExaminerRegistration.findOrCreate({
        where: { refNo: record.refNo },
        defaults: record
      });

      if (!created) {
        await existing.update(record);
        updatedCount++;
      } else {
        createdCount++;
      }
    }

    res.json({
      message: `Successfully processed ${records.length} registration(s).`,
      inserted: createdCount,
      updated: updatedCount
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getRegistrations,
  getDistinctClasses,
  addRegistration,
  updateRegistration,
  deleteRegistration,
  importRegistrations
};
