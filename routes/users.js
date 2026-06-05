// ==========================================
// routes/users.js — User Management & Friends
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/users — List all users with relation status
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
      LEFT JOIN LATERAL (
        SELECT status, sender
        FROM friends
        WHERE (user1 = $1 AND user2 = u.username)
           OR (user1 = u.username AND user2 = $1)
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

// POST /api/users/friend-action — Handle friend requests
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
      await query(`
        INSERT INTO friends (user1, user2, status, sender)
        VALUES ($1, $2, 'pending', $3)
        ON CONFLICT (user1, user2) 
        DO UPDATE SET status = 'pending', sender = $3
      `, [u1, u2, me]);

      const { broadcastToUser } = require('../server');
      broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'add' });

      return res.json({ success: true, data: { relation: 'pending_sent' } });
    }

    if (action === 'accept') {
      // ✅ KIỂM TRA QUYỀN: Chỉ người NHẬN lời mời mới được accept
      const checkResult = await query(`
        SELECT sender FROM friends WHERE user1 = $1 AND user2 = $2 AND status = 'pending'
      `, [u1, u2]);
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'No pending request found' });
      }
      
      const requestSender = checkResult.rows[0].sender;
      if (requestSender === me) {
        return res.status(403).json({ error: 'Cannot accept your own request' });
      }
      
      await query(`
        UPDATE friends SET status = 'accepted' 
        WHERE user1 = $1 AND user2 = $2
      `, [u1, u2]);

      const { broadcastToUser } = require('../server');
      broadcastToUser(targetUser, { type: 'network_update', sender: me, action: 'accept' });

      return res.json({ success: true, data: { relation: 'friend' } });
    }

    if (action === 'cancel') {
      await query(`
        DELETE FROM friends WHERE user1 = $1 AND user2 = $2
      `, [u1, u2]);

      const { broadcastToUser } = require('../server');
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