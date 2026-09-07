// ==========================================
// routes/auth.js — Authentication Routes
// ==========================================
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../config/db');
const { generateToken } = require('../middleware/auth');

function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const genBlock = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${genBlock()}-${genBlock()}-${genBlock()}`;
}

// POST /api/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const clean = username.trim().toLowerCase();
    if (clean.length < 2 || clean.length > 30) {
      return res.status(400).json({ error: 'Username must be 2-30 characters' });
    }

    const existing = await query('SELECT 1 FROM users WHERE username = $1', [clean]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);

    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, await bcrypt.genSalt(10));

    await query(
      'INSERT INTO users (username, password_hash, salt, recovery_code) VALUES ($1, $2, $3, $4)',
      [clean, hash, salt, recoveryCode]
    );

    const token = generateToken(clean);
    res.status(201).json({
      success: true,
      token,
      username: clean,
      recoveryCode
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

const crypto = require('crypto');

// Helper: PBKDF2 verify (legacy)
function verifyLegacyPassword(password, hash, salt) {
  const computed = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return computed === hash;
}

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const clean = username.trim().toLowerCase();
    const result = await query('SELECT * FROM users WHERE username = $1', [clean]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({
        error: 'NODE_NOT_FOUND',
        message: 'Tài khoản không tồn tại trong mạng lưới'
      });
    }

    let valid = false;
    let isLegacy = false;

    // Try bcrypt first
    valid = await bcrypt.compare(password, user.password_hash);

    // If bcrypt fails, try legacy PBKDF2
    if (!valid && user.salt) {
      valid = verifyLegacyPassword(password, user.password_hash, user.salt);
      isLegacy = valid;
    }

    if (!valid) {
      return res.status(400).json({
        error: 'ACCESS_DENIED',
        message: 'Mã xác thực không chính xác'
      });
    }

    // If legacy hash, re-hash with bcrypt for next time
    if (isLegacy) {
      const newSalt = await bcrypt.genSalt(12);
      const newHash = await bcrypt.hash(password, newSalt);
      await query(
        'UPDATE users SET password_hash = $1, salt = $2 WHERE username = $3',
        [newHash, newSalt, clean]
      );
      console.log(`[MIGRATE] Re-hashed password for ${clean}`);
    }

    await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = $1', [clean]);

    const token = generateToken(clean);
    res.json({ success: true, token, username: clean });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /api/forgot-password — verify recovery code, cho phép đổi pass
router.post('/forgot-password', async (req, res) => {
  try {
    const { username, recoveryCode, newPassword } = req.body;

    if (!username || !recoveryCode || !newPassword) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }

    const clean = username.trim().toLowerCase();
    const result = await query('SELECT * FROM users WHERE username = $1', [clean]);
    const user = result.rows[0];

    if (!user || !user.recovery_code_hash) {
      return res.status(400).json({ error: 'RECOVERY_FAILED', message: 'Mã khôi phục không hợp lệ' });
    }

    const validCode = await bcrypt.compare(recoveryCode.trim().toUpperCase(), user.recovery_code_hash);
    if (!validCode) {
      return res.status(400).json({ error: 'RECOVERY_FAILED', message: 'Mã khôi phục không hợp lệ' });
    }

    // Đổi password mới + sinh recovery code mới (code cũ không dùng lại được)
    const newSalt = await bcrypt.genSalt(12);
    const newHash = await bcrypt.hash(newPassword, newSalt);
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryCodeHash = await bcrypt.hash(newRecoveryCode, await bcrypt.genSalt(10));

    await query(
      'UPDATE users SET password_hash = $1, salt = $2, recovery_code_hash = $3 WHERE username = $4',
      [newHash, newSalt, newRecoveryCodeHash, clean]
    );

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công',
      recoveryCode: newRecoveryCode // mã mới, user phải lưu lại
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error during password reset' });
  }
});

module.exports = router;