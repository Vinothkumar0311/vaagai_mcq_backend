const sequelize = require('../config/db');

// Import models
const User = require('./User')(sequelize);
const Test = require('./Test')(sequelize);
const Question = require('./Question')(sequelize);
const TestAssignment = require('./TestAssignment')(sequelize);
const Result = require('./Result')(sequelize);
const Answer = require('./Answer')(sequelize);
const ExaminerRegistration = require('./ExaminerRegistration')(sequelize);

// Set up Associations

// Test <-> Question (One-to-Many, Cascade Delete)
Test.hasMany(Question, { foreignKey: 'testId', onDelete: 'CASCADE', hooks: true });
Question.belongsTo(Test, { foreignKey: 'testId', onDelete: 'CASCADE' });

// Test <-> TestAssignment (One-to-Many, Cascade Delete)
Test.hasMany(TestAssignment, { foreignKey: 'testId', onDelete: 'CASCADE', hooks: true });
TestAssignment.belongsTo(Test, { foreignKey: 'testId', onDelete: 'CASCADE' });

// User <-> TestAssignment (One-to-Many, based on email, Cascade Delete)
User.hasMany(TestAssignment, { foreignKey: 'examineeEmail', sourceKey: 'email', onDelete: 'CASCADE', hooks: true });
TestAssignment.belongsTo(User, { foreignKey: 'examineeEmail', targetKey: 'email', onDelete: 'CASCADE' });

// Test <-> Result (One-to-Many, Cascade Delete)
Test.hasMany(Result, { foreignKey: 'testId', onDelete: 'CASCADE', hooks: true });
Result.belongsTo(Test, { foreignKey: 'testId', onDelete: 'CASCADE' });

// User <-> Result (One-to-Many, Cascade Delete)
User.hasMany(Result, { foreignKey: 'userId', onDelete: 'CASCADE', hooks: true });
Result.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

// Result <-> Answer (One-to-Many, Cascade Delete)
Result.hasMany(Answer, { foreignKey: 'resultId', onDelete: 'CASCADE', hooks: true });
Answer.belongsTo(Result, { foreignKey: 'resultId', onDelete: 'CASCADE' });

// Question <-> Answer (One-to-Many, Cascade Delete)
Question.hasMany(Answer, { foreignKey: 'questionId', onDelete: 'CASCADE', hooks: true });
Answer.belongsTo(Question, { foreignKey: 'questionId', onDelete: 'CASCADE' });

module.exports = {
  sequelize,
  User,
  Test,
  Question,
  TestAssignment,
  Result,
  Answer,
  ExaminerRegistration
};
