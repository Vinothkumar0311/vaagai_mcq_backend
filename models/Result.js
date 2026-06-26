const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Result = sequelize.define('Result', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    testId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true  // null for public (unauthenticated) submissions
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    total: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    timeTaken: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    examinerEmail: {
      type: DataTypes.STRING,
      allowNull: true
    },
    examinerName: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'results',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['testId', 'userId']
      }
    ]
  });

  return Result;
};
