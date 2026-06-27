/**
 * Resolves a class name (e.g. "1", "2", "3", "1-3") to its corresponding range group array.
 * This is used to query questions that match the student's class standard.
 */
function getClassGroup(className) {
  if (!className) return [];
  const clean = String(className).trim().toLowerCase();
  
  if (['1', '2', '3', '1-3'].includes(clean)) {
    return ['1', '2', '3', '1-3'];
  }
  if (['4', '5', '4-5'].includes(clean)) {
    return ['4', '5', '4-5'];
  }
  if (['6', '7', '6-7'].includes(clean)) {
    return ['6', '7', '6-7'];
  }
  if (['8', '9', '8-9'].includes(clean)) {
    return ['8', '9', '8-9'];
  }
  if (['10', '11', '12', '10-12'].includes(clean)) {
    return ['10', '11', '12', '10-12'];
  }
  return [clean];
}

/**
 * Resolves a class name (e.g. "1", "2", "3") to its canonical range representation.
 */
function resolveCanonicalClassRange(className) {
  if (!className) return null;
  const clean = String(className).trim().toLowerCase();
  if (['1', '2', '3', '1-3'].includes(clean)) return '1-3';
  if (['4', '5', '4-5'].includes(clean)) return '4-5';
  if (['6', '7', '6-7'].includes(clean)) return '6-7';
  if (['8', '9', '8-9'].includes(clean)) return '8-9';
  if (['10', '11', '12', '10-12'].includes(clean)) return '10-12';
  return clean;
}

function excelSerialToDate(serial) {
  const days = serial - (serial >= 60 ? 1 : 0);
  const ms = (days - 1) * 24 * 60 * 60 * 1000;
  return new Date(new Date('1900-01-01T00:00:00Z').getTime() + ms);
}

function getRangeFromMonthDay(month, day) {
  if ((month === 1 && day === 3) || (month === 3 && day === 1)) {
    return '1-3';
  }
  if ((month === 4 && day === 5) || (month === 5 && day === 4)) {
    return '4-5';
  }
  if ((month === 6 && day === 7) || (month === 7 && day === 6)) {
    return '6-7';
  }
  if ((month === 8 && day === 9) || (month === 9 && day === 8)) {
    return '8-9';
  }
  if ((month === 10 && day === 12) || (month === 12 && day === 10)) {
    return '10-12';
  }
  return null;
}

function mapDateToRange(date) {
  const mLocal = date.getMonth() + 1;
  const dLocal = date.getDate();
  const mUTC = date.getUTCMonth() + 1;
  const dUTC = date.getUTCDate();

  const rangeLocal = getRangeFromMonthDay(mLocal, dLocal);
  if (rangeLocal) return rangeLocal;

  const rangeUTC = getRangeFromMonthDay(mUTC, dUTC);
  if (rangeUTC) return rangeUTC;

  return null;
}

/**
 * Handles Excel auto-formatting dates (like converting 1-3 to date serial 46025, or 4-5 to 46117)
 * and safely maps them back to the canonical class range string.
 */
function convertExcelDateToClassRange(val) {
  if (val === undefined || val === null) return null;

  // If it's already a number that looks like an Excel date serial
  if (typeof val === 'number' && val >= 35000 && val <= 60000) {
    val = excelSerialToDate(val);
  }

  // If it is a Date object
  if (val instanceof Date && !isNaN(val.getTime())) {
    const mapped = mapDateToRange(val);
    if (mapped) return mapped;
  }

  // If it's a string, see if it is a date representation
  if (typeof val === 'string') {
    const cleanStr = val.trim().toLowerCase();
    
    // Check if it's already a canonical range
    if (/^\d+-\d+$/.test(cleanStr)) {
      return cleanStr;
    }

    // Check if it's a number string that looks like a serial
    const num = Number(cleanStr);
    if (!isNaN(num) && num >= 35000 && num <= 60000) {
      const d = excelSerialToDate(num);
      if (d) {
        const mapped = mapDateToRange(d);
        if (mapped) return mapped;
      }
    }

    // Try parsing as JS date
    const parsedDate = new Date(cleanStr);
    if (!isNaN(parsedDate.getTime())) {
      const mapped = mapDateToRange(parsedDate);
      if (mapped) return mapped;
    }

    // Fallback parsing for common Excel formats like "03-Jan" or "Jan-03"
    const monthMap = {
      jan: 1, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, dec: 12
    };
    
    for (const [monName, monNum] of Object.entries(monthMap)) {
      if (cleanStr.includes(monName)) {
        const match = cleanStr.match(/\d+/);
        if (match) {
          const dayNum = parseInt(match[0], 10);
          const mapped = getRangeFromMonthDay(monNum, dayNum);
          if (mapped) return mapped;
        }
      }
    }
  }

  return String(val).trim();
}

function parseAllowedClasses(allowedClasses) {
  if (!allowedClasses) return [];
  if (Array.isArray(allowedClasses)) return allowedClasses;
  if (typeof allowedClasses === 'string') {
    try {
      const parsed = JSON.parse(allowedClasses);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      if (allowedClasses.trim().startsWith('[')) {
        return [];
      }
      return allowedClasses.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

module.exports = {
  getClassGroup,
  resolveCanonicalClassRange,
  convertExcelDateToClassRange,
  parseAllowedClasses
};
