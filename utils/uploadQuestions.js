const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { resolveCanonicalClassRange, convertExcelDateToClassRange } = require('./classMapper');

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

/**
 * Parse an Excel buffer and return an array of raw row objects.
 */
function parseExcelBuffer(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet);
}

/**
 * Extract images embedded inside an Excel (.xlsx) file ZIP structure.
 * Returns a map of sheetRowIndex -> { filename, buffer }
 */
function extractEmbeddedImagesFromXlsx(fileBuffer) {
  const imageMap = {};
  try {
    const zip = new AdmZip(fileBuffer);
    const entries = zip.getEntries();

    // 1. Find drawing relation path from sheet1 rels
    const sheetRelEntry = entries.find(e => e.entryName === 'xl/worksheets/_rels/sheet1.xml.rels');
    if (!sheetRelEntry) return imageMap;

    const sheetRelXml = sheetRelEntry.getData().toString('utf8');
    const drawingMatch = sheetRelXml.match(/Type="[^"]*relationships\/drawing"\s+Target="([^"]*)"/i) ||
                         sheetRelXml.match(/Target="([^"]*)"\s+Type="[^"]*relationships\/drawing"/i);

    let drawingPath = 'xl/drawings/drawing1.xml'; // fallback
    if (drawingMatch) {
      const target = drawingMatch[1];
      drawingPath = path.posix.join('xl', 'worksheets', target).replace(/\\/g, '/');
      // Normalize path (handle '..')
      drawingPath = drawingPath.split('/').reduce((acc, part) => {
        if (part === '..') acc.pop();
        else acc.push(part);
        return acc;
      }, []).join('/');
    }

    const drawingEntry = entries.find(e => e.entryName === drawingPath);
    if (!drawingEntry) return imageMap;

    // 2. Read drawing relationships (mapping rId -> media path)
    const drawingRelPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
    const drawingRelEntry = entries.find(e => e.entryName === drawingRelPath);
    if (!drawingRelEntry) return imageMap;

    const drawingRelXml = drawingRelEntry.getData().toString('utf8');
    const rels = {};
    const relRegex = /<Relationship\s+Id="([^"]*)"\s+Type="[^"]*"\s+Target="([^"]*)"/gi;
    let match;
    while ((match = relRegex.exec(drawingRelXml)) !== null) {
      rels[match[1]] = match[2];
    }
    const relRegexAlt = /<Relationship\s+Target="([^"]*)"\s+Type="[^"]*"\s+Id="([^"]*)"/gi;
    while ((match = relRegexAlt.exec(drawingRelXml)) !== null) {
      rels[match[2]] = match[1];
    }

    // 3. Parse anchors from drawing XML
    const drawingXml = drawingEntry.getData().toString('utf8');
    const anchorRegex = /<(xdr:twoCellAnchor|xdr:oneCellAnchor)[^>]*>([\s\S]*?)<\/(xdr:twoCellAnchor|xdr:oneCellAnchor)>/g;
    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(drawingXml)) !== null) {
      const anchorContent = anchorMatch[2];
      const rowMatch = anchorContent.match(/<xdr:row>(\d+)<\/xdr:row>/);
      const blipMatch = anchorContent.match(/<a:blip[^>]*r:embed="([^"]*)"/);

      if (rowMatch && blipMatch) {
        const rowIndex = parseInt(rowMatch[1], 10);
        const rId = blipMatch[1];
        const targetPath = rels[rId];
        if (targetPath) {
          let mediaPath = path.posix.join('xl', 'drawings', targetPath).replace(/\\/g, '/');
          mediaPath = mediaPath.split('/').reduce((acc, part) => {
            if (part === '..') acc.pop();
            else acc.push(part);
            return acc;
          }, []).join('/');

          const mediaEntry = entries.find(e => e.entryName === mediaPath);
          if (mediaEntry) {
            imageMap[rowIndex] = {
              filename: path.basename(mediaPath),
              buffer: mediaEntry.getData()
            };
          }
        }
      }
    }
  } catch (error) {
    console.error('Error extracting embedded images:', error);
  }
  return imageMap;
}

/**
 * Normalise a raw Excel row into a question object.
 */
function normaliseRow(row, rowIndex) {
  let questionText = '';
  let optionA = '';
  let optionB = '';
  let optionC = '';
  let optionD = '';
  let correctAnswer = '';
  let imageFilename = null;
  let explanation = '';
  let questionClass = null;

  Object.keys(row).forEach(key => {
    const cleanKey = key.trim().toLowerCase();
    const rawVal = row[key];
    const val = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : '';

    if (cleanKey === 'question' || cleanKey === 'question text') {
      questionText = val;
    } else if (['option a', 'optiona', 'a', 'option_a'].includes(cleanKey)) {
      optionA = val;
    } else if (['option b', 'optionb', 'b', 'option_b'].includes(cleanKey)) {
      optionB = val;
    } else if (['option c', 'optionc', 'c', 'option_c'].includes(cleanKey)) {
      optionC = val;
    } else if (['option d', 'optiond', 'd', 'option_d'].includes(cleanKey)) {
      optionD = val;
    } else if (['correct answer', 'correctanswer', 'correct', 'answer'].includes(cleanKey)) {
      correctAnswer = val.toUpperCase();
    } else if (['image', 'image url', 'imageurl', 'image_url', 'image file', 'imagefile', 'image_file'].includes(cleanKey)) {
      imageFilename = val || null;
    } else if (['explanation', 'explain', 'ans_desc'].includes(cleanKey)) {
      explanation = val;
    } else if (['class', 'grade', 'class_name', 'questionclass'].includes(cleanKey)) {
      questionClass = rawVal !== undefined && rawVal !== null ? convertExcelDateToClassRange(rawVal) : null;
    }
  });

  return { questionText, optionA, optionB, optionC, optionD, correctAnswer, imageFilename, explanation, class: questionClass };
}

/**
 * Validate a normalised row.
 */
function validateRow(row, rowIndex, hasImage) {
  const { questionText, optionA, optionB, optionC, optionD, correctAnswer } = row;

  // Question is required unless there is an image associated with this row
  if (!questionText && !hasImage) {
    return `Row ${rowIndex + 2}: Question text is required when no image is supplied.`;
  }

  if (!optionA || !optionB || !optionC || !optionD || !correctAnswer) {
    return `Row ${rowIndex + 2}: Missing options (A-D) or Correct Answer.`;
  }

  if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
    return `Row ${rowIndex + 2}: Invalid Correct Answer "${correctAnswer}". Must be A, B, C, or D.`;
  }

  return null;
}

/**
 * Save an image buffer to the uploads/question-images directory.
 */
function saveImageFile(buffer, originalName, uploadsDir) {
  const ext = path.extname(originalName).toLowerCase() || '.png';
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const destPath = path.join(uploadsDir, safeName);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  fs.writeFileSync(destPath, buffer);
  return safeName;
}

/**
 * Main processor: handles ZIP (excel + images), Excel + separate images,
 * and direct embedded image extraction from Excel files.
 */
function processUpload(fileBuffer, mimetype, originalName, testId, uploadsDir, publicPath, imageFiles = []) {
  const ext = path.extname(originalName || '').toLowerCase();
  const isZip = ext === '.zip';

  const imageMap = {};
  let excelBuffer = null;
  let embeddedImagesMap = {};

  if (isZip) {
    const zip = new AdmZip(fileBuffer);
    const entries = zip.getEntries();
    let excelEntry = null;

    entries.forEach(entry => {
      const name = entry.entryName;
      const basename = path.basename(name);
      const ext = path.extname(basename).toLowerCase();

      if (!entry.isDirectory) {
        if (ext === '.xlsx' || ext === '.xls') {
          if (!excelEntry) excelEntry = entry;
        } else if (IMAGE_EXTENSIONS.includes(ext)) {
          const savedName = saveImageFile(entry.getData(), basename, uploadsDir);
          imageMap[basename.toLowerCase()] = `${publicPath}/${savedName}`;
          imageMap[name.toLowerCase()] = `${publicPath}/${savedName}`;
        }
      }
    });

    if (!excelEntry) {
      throw new Error('No Excel file (.xlsx or .xls) found inside the ZIP archive.');
    }

    excelBuffer = excelEntry.getData();
    // Also parse embedded drawings inside the zip Excel entry if any
    embeddedImagesMap = extractEmbeddedImagesFromXlsx(excelBuffer);
  } else {
    // Plain Excel file - extract drawings/images embedded in the sheet
    excelBuffer = fileBuffer;
    embeddedImagesMap = extractEmbeddedImagesFromXlsx(excelBuffer);
  }

  // Handle separately uploaded image files (multipart images[])
  imageFiles.forEach(imgFile => {
    const savedName = saveImageFile(imgFile.buffer, imgFile.originalname, uploadsDir);
    imageMap[imgFile.originalname.toLowerCase()] = `${publicPath}/${savedName}`;
  });

  // Parse Excel rows
  const rows = parseExcelBuffer(excelBuffer);
  if (rows.length === 0) {
    throw new Error('The Excel file is empty or has no data rows.');
  }

  const questionsData = [];
  const warnings = [];

  rows.forEach((row, idx) => {
    const normalised = normaliseRow(row, idx);

    // Check if there is an embedded image on this row
    // sheetRowIndex = idx + 1
    const embeddedImg = embeddedImagesMap[idx + 1];
    const hasImage = !!normalised.imageFilename || !!embeddedImg;

    const error = validateRow(normalised, idx, hasImage);
    if (error) {
      throw new Error(error);
    }

    let imageUrl = null;

    // Use embedded image if present
    if (embeddedImg) {
      const savedName = saveImageFile(embeddedImg.buffer, embeddedImg.filename, uploadsDir);
      imageUrl = `${publicPath}/${savedName}`;
    } else if (normalised.imageFilename) {
      const key = normalised.imageFilename.toLowerCase();
      if (imageMap[key]) {
        imageUrl = imageMap[key];
      } else if (normalised.imageFilename.startsWith('http://') || normalised.imageFilename.startsWith('https://')) {
        imageUrl = normalised.imageFilename;
      } else {
        warnings.push(`Row ${idx + 2}: Image file "${normalised.imageFilename}" was not found in the upload. Question saved without image.`);
      }
    }

    questionsData.push({
      testId,
      question: normalised.questionText || null,
      optionA: normalised.optionA,
      optionB: normalised.optionB,
      optionC: normalised.optionC,
      optionD: normalised.optionD,
      correctAnswer: normalised.correctAnswer,
      imageUrl,
      explanation: normalised.explanation || null,
      class: resolveCanonicalClassRange(normalised.class) || normalised.class
    });
  });

  return { questionsData, warnings };
}

module.exports = { processUpload };
