const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TestAssignment = sequelize.define('TestAssignment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    testId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    examineeEmail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    assignedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'test_assignments',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['testId', 'examineeEmail']
      }
    ]
  });

  return TestAssignment;
};
