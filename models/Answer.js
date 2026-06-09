const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Answer = sequelize.define('Answer', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    resultId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    questionId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    selectedOption: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'answers',
    timestamps: false
  });

  return Answer;
};
