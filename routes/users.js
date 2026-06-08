// ==========================================
// routes/users.js — User Management & Friends
// v9.1-fix: #7 friend-action "add" tự động accept nếu bên kia đã pending
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
// FIX #12: Import từ lib/broadcast
const { broadcastToUser } = require('../lib/broadcast');

// GET /api/users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;

    const result = await query(`
      SELECT 
        u.username,
        u.avatar,
        CASE 
          WHEN b.blocker IS NOT NULL THEN FALSE
          ELSE COALESCE(o.is_online, FALSE)
        END as online,
        CASE 
          WHEN f.status = 'accepted' THEN 'friend'
          WHEN f.status = 'pending' AND f.sender = $1 THEN 'pending_sent'
          WHEN f.status = 'pending' AND f.sender != $1 THEN 'pending_received'
          ELSE 'none'
        END as relation
      FROM users u
      LEFT JOIN LATERAL (
        SELECT TRUE as is_online FROM online_users ou WHERE ou.username = u.username
      ) o ON TRUE
      LEFT JOIN LATERAL (
        SELECT 1 as blocker FROM blocks
        WHERE (blocker = $1 AND blocked = u.username) OR (blocker = u.username AND blocked = $1)
        LIMIT 1
      ) b ON TRUE
      LEFT JOIN LATERAL (
        SELECT status, sender FROM friends
        WHERE (user1 = $1 AND user2 = u.username) OR (user1 = u.username AND user2 = $1)
        LIMIT 1
      ) f ON TRUE
      WHERE u.username != $1
      ORDER BY u.username ASC
    `, [me]);

    res.json(result.rows);

  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// POST /api/users/friend-action
router.post('/friend-action', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const { targetUser, action } = req.body;

    if (!targetUser || me === targetUser) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const u1 = me < targetUser ? me : targetUser;
    const u2 = me < targetUser ? targetUser : me;

    if (action === 'add') {
      // FIX #7: Kiểm tra xem bên kia đã có pending request gửi cho mình chưa
      const existing = await query(`
        SELECT status, sender FROM friends WHERE user1 = $1 AND user2 = $2
      `, [u1, u2]);

      if (existing.rows.length > 0 && existing.rows[0].status === 'pending' && existing.rows[0].sender === targetUser) {
        // Bên kia đã gửi lời mời → tự động accept thay vì overwrite
        await query(`UPDATE friends SET status = 'accepted' WHERE user1 = $1 AND user2 = $2`, [u1, u2]);
        broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'accept' });
        return res.json({ success: true, data: { relation: 'friend' } });
      }

      // Bình thường: insert hoặc update pending
      await query(`
        INSERT INTO friends (user1, user2, status, sender)
        VALUES ($1, $2, 'pending', $3)
        ON CONFLICT (user1, user2) 
        DO UPDATE SET status = 'pending', sender = $3
      `, [u1, u2, me]);

      broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'add' });

      return res.json({ success: true, data: { relation: 'pending_sent' } });
    }

    if (action === 'accept') {
      const checkResult = await query(`
        SELECT sender FROM friends WHERE user1 = $1 AND user2 = $2 AND status = 'pending'
      `, [u1, u2]);

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'No pending request found' });
      }

      if (checkResult.rows[0].sender === me) {
        return res.status(403).json({ error: 'Cannot accept your own request' });
      }

      await query(`UPDATE friends SET status = 'accepted' WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

      broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'accept' });

      return res.json({ success: true, data: { relation: 'friend' } });
    }

    if (action === 'cancel') {
      await query(`DELETE FROM friends WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

      broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'cancel' });

      return res.json({ success: true, data: { relation: 'none' } });
    }

    res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    console.error('Friend action error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
