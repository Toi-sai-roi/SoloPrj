// ==========================================
// routes/profile.js — User Profile Management
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/profile/:username
router.get('/:username', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const target = req.params.username.toLowerCase();

    const result = await query(`
      SELECT 
        u.username,
        u.avatar,
        u.bio,
        u.created_at,
        CASE 
          WHEN b.blocker IS NOT NULL THEN 'Ngoại tuyến'
          WHEN o.is_online THEN 'Đang hoạt động'
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - u.last_seen)) < 60 THEN 'Vừa hoạt động'
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - u.last_seen)) < 3600 THEN 
            CONCAT(EXTRACT(MINUTE FROM (CURRENT_TIMESTAMP - u.last_seen))::INT, ' phút trước')
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - u.last_seen)) < 86400 THEN 
            CONCAT(EXTRACT(HOUR FROM (CURRENT_TIMESTAMP - u.last_seen))::INT, ' giờ trước')
          ELSE TO_CHAR(u.last_seen, 'DD/MM/YYYY')
        END as lastSeenText,
        b.blocker IS NOT NULL as isBlockedReal
      FROM users u
      LEFT JOIN LATERAL (
        SELECT TRUE as is_online
        FROM online_users ou
        WHERE ou.username = u.username
      ) o ON TRUE
      LEFT JOIN LATERAL (
        SELECT 1 as blocker
        FROM blocks
        WHERE (blocker = $1 AND blocked = u.username)
           OR (blocker = u.username AND blocked = $1)
        LIMIT 1
      ) b ON TRUE
      WHERE u.username = $2
    `, [me, target]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// PUT /api/profile — Update own profile
router.put('/', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const { avatar, bio } = req.body;

    await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = $1', [me]);

    if (avatar !== undefined) {
      await query('UPDATE users SET avatar = $1 WHERE username = $2', [avatar, me]);
    }

    if (bio !== undefined) {
      await query('UPDATE users SET bio = $1 WHERE username = $2', [bio.trim().slice(0, 100), me]);
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;