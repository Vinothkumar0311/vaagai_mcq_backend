const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExaminerRegistration = sequelize.define('ExaminerRegistration', {
    refNo: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    class: {
      type: DataTypes.STRING,
      allowNull: true
    },
    schoolName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    place: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mobileNumber: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'examiner_registrations',
    timestamps: true
  });

  return ExaminerRegistration;
};
