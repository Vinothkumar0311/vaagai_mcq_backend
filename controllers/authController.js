const { OAuth2Client } = require('google-auth-library');
const { User, TestAssignment, ExaminerRegistration, sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const { verifyFirebaseToken } = require('../utils/firebaseVerifier');

// Initialize Google client if client ID is configured
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;

let client;
if (googleClientId && googleClientId !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
  client = new OAuth2Client(googleClientId);
}

const googleLogin = async (req, res) => {
  const { token, mockUser } = req.body;

  let email, name, avatar;

  try {
    if (mockUser) {
      // Mock login for developer testing
      email = mockUser.email;
      name = mockUser.name;
      avatar = mockUser.avatar;
    } else if (firebaseProjectId && firebaseProjectId !== 'YOUR_PROJECT_ID' && token) {
      // Real Firebase verification
      try {
        const decoded = await verifyFirebaseToken(token, firebaseProjectId);
        email = decoded.email;
        name = decoded.name;
        avatar = decoded.picture;
      } catch (err) {
        console.error('Firebase Token Verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired Firebase authentication token.' });
      }
    } else if (client && token) {
      // Real Google verification
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: googleClientId,
      });
      const payload = ticket.getPayload();
      email = payload.email;
      name = payload.name;
      avatar = payload.picture;
    } else {
      // Fallback if client isn't configured but a raw credential payload is provided (for easy testing)
      if (token) {
        // Just decode token parts if it's a jwt but google verification client is not configured
        try {
          const decoded = jwt.decode(token);
          if (decoded) {
            email = decoded.email;
            name = decoded.name || decoded.given_name;
            avatar = decoded.picture;
          }
        } catch (e) {
          // ignore
        }
      }
      
      // If we still don't have email, let them use body params
      if (!email && req.body.email) {
        email = req.body.email;
        name = req.body.name || 'User';
        avatar = req.body.avatar || '';
      }

      if (!email) {
        return res.status(400).json({ error: 'Google Client ID is not configured or invalid token provided.' });
      }
    }

    email = email.trim().toLowerCase();
    if (!name) {
      name = email.split('@')[0];
      name = name.split(/[\._-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    } else {
      name = name.trim();
    }

    // Check if user exists
    let user = await User.findOne({
      where: { email }
    });

    const isPrimaryAdmin = email === 'admin@vaagai.com';

    // Determine target role
    let role = 'EXAMINER';
    if (user) {
      role = user.role;
    } else {
      const userCount = await User.count();
      if (userCount === 0 || isPrimaryAdmin) {
        role = 'ADMIN';
      }
    }

    // If role is EXAMINER, verify they are assigned to at least one test container
    if (role === 'EXAMINER') {
      const assignmentCount = await TestAssignment.count({
        where: { examineeEmail: email }
      });

      if (assignmentCount === 0) {
        return res.status(403).json({ 
          error: 'Access Denied: Your email address is not registered/authorized to take any assessments in this system. Please request the administrator to assign your email to a test container first.' 
        });
      }
    }

    if (!user) {
      user = await User.create({
        email,
        name,
        avatar: avatar || '',
        role
      });
    } else {
      // Update avatar/name if changed and present
      const updateData = {};
      if (name) updateData.name = name;
      if (avatar) updateData.avatar = avatar;

      if (Object.keys(updateData).length > 0) {
        await User.update(
          updateData,
          { where: { email } }
        );
      }
      user = await User.findOne({ where: { email } });
    }

    // Create session JWT
    const sessionToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      process.env.JWT_SECRET || 'MCQ_SECRET_KEY_SUPER_SECURE_123456',
      { expiresIn: '7d' }
    );

    res.json({
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      regNo: user.regNo,
      schoolName: user.schoolName,
      mobileNumber: user.mobileNumber,
      class: user.class,
      place: user.place
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const examinerRegNoLogin = async (req, res) => {
  const { regNo, name, class: className, schoolName, mobileNumber, place } = req.body;

  if (!regNo) {
    return res.status(400).json({ error: 'Registration Number is required.' });
  }

  try {
    const cleanRegNo = regNo.trim();
    // Case-insensitive lookup for registration number
    const registration = await ExaminerRegistration.findOne({
      where: sequelize.where(
        sequelize.fn('lower', sequelize.col('refNo')),
        cleanRegNo.toLowerCase()
      )
    });

    if (!registration) {
      return res.status(404).json({ error: 'Registration Number not found. Please contact the administrator.' });
    }

    // Check if registry record is missing key profile fields
    const hasName = !!registration.name;
    const hasClass = !!registration.class;
    const hasSchoolName = !!registration.schoolName;
    const hasMobileNumber = !!registration.mobileNumber;

    const isMissingRequired = !hasName || !hasClass || !hasSchoolName || !hasMobileNumber;

    if (isMissingRequired && (!className || !schoolName || !mobileNumber)) {
      return res.json({
        needsCompleteProfile: true,
        registration: {
          refNo: registration.refNo,
          email: registration.email,
          name: registration.name,
          class: registration.class,
          schoolName: registration.schoolName,
          mobileNumber: registration.mobileNumber,
          place: registration.place
        }
      });
    }

    // Update missing details if they are provided now
    if (name || className || schoolName || mobileNumber || place) {
      await registration.update({
        name: name ? name.trim() : registration.name,
        class: className ? className.trim() : registration.class,
        schoolName: schoolName ? schoolName.trim() : registration.schoolName,
        mobileNumber: mobileNumber ? mobileNumber.trim() : registration.mobileNumber,
        place: place ? place.trim() : registration.place
      });
    }

    const email = registration.email.trim().toLowerCase();
    const resolvedName = registration.name ? registration.name.trim() : email.split('@')[0];

    // Check if user exists
    let user = await User.findOne({
      where: { email }
    });

    // If role is EXAMINER, verify they are assigned to at least one test container
    const assignmentCount = await TestAssignment.count({
      where: { examineeEmail: email }
    });

    if (assignmentCount === 0) {
      return res.status(403).json({ 
        error: 'Access Denied: Your email address is not registered/authorized to take any assessments in this system. Please request the administrator to assign your email to a test container first.' 
      });
    }

    if (!user) {
      user = await User.create({
        email,
        name: resolvedName,
        role: 'EXAMINER',
        regNo: registration.refNo,
        schoolName: registration.schoolName,
        mobileNumber: registration.mobileNumber,
        class: registration.class,
        place: registration.place,
        avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(resolvedName)}`
      });
    } else {
      // Update registration details on user if they changed
      await user.update({
        name: resolvedName,
        regNo: registration.refNo,
        schoolName: registration.schoolName,
        mobileNumber: registration.mobileNumber,
        class: registration.class,
        place: registration.place
      });
    }

    // Create session JWT
    const sessionToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        class: user.class
      },
      process.env.JWT_SECRET || 'MCQ_SECRET_KEY_SUPER_SECURE_123456',
      { expiresIn: '7d' }
    );

    res.json({
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        regNo: user.regNo,
        schoolName: user.schoolName,
        mobileNumber: user.mobileNumber,
        class: user.class,
        place: user.place
      }
    });

  } catch (error) {
    console.error('Registration Login Error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
};

module.exports = {
  googleLogin,
  getProfile,
  examinerRegNoLogin
};
