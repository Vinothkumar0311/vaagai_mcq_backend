const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Question = sequelize.define('Question', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    testId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    question: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    optionA: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    optionB: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    optionC: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    optionD: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    correctAnswer: {
      type: DataTypes.STRING,
      allowNull: false
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    explanation: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    class: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'questions',
    timestamps: true
  });

  return Question;
};
