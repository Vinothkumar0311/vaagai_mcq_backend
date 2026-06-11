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

module.exports = {
  getClassGroup,
  resolveCanonicalClassRange
};
