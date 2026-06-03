// ==========================================
// middleware/errorHandler.js — Global Error Handling
// ==========================================
const multer = require('multer');

function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 8MB.' });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
}

module.exports = errorHandler;