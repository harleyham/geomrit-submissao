const fs = require('fs');
const path = require('path');

const PHOTO_DIR_REL = path.join('uploads', 'profile-photos');
const PHOTO_DIR_ABS = path.join(__dirname, '..', PHOTO_DIR_REL);

if (!fs.existsSync(PHOTO_DIR_ABS)) fs.mkdirSync(PHOTO_DIR_ABS, { recursive: true });

function getUserPhotoAbsPath(photoPath) {
  if (!photoPath) return null;
  const normalized = String(photoPath);
  if (!normalized.startsWith(PHOTO_DIR_REL.split(path.sep).join('/'))) return null;
  const abs = path.join(__dirname, '..', normalized);
  if (path.dirname(abs) !== PHOTO_DIR_ABS) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

function removeUserPhotoFile(photoPath) {
  const abs = getUserPhotoAbsPath(photoPath);
  if (!abs) return;
  try { fs.unlinkSync(abs); } catch (e) { /* ignora */ }
}

module.exports = {
  PHOTO_DIR_REL: PHOTO_DIR_REL.split(path.sep).join('/'),
  PHOTO_DIR_ABS,
  getUserPhotoAbsPath,
  removeUserPhotoFile
};
