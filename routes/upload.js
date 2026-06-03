// ==========================================
// routes/upload.js — File Upload Handler
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// POST /api/upload
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const me = req.user.username;
    const { filename, originalname, mimetype, size } = req.file;

    const url = `/uploads/${filename}`;

    await query(`
      INSERT INTO media_uploads (filename, original_name, mime_type, size, uploaded_by, url)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [filename, originalname, mimetype, size, me, url]);

    res.json({
      success: true,
      url,
      filename: originalname,
      type: mimetype,
      size
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;