// ==========================================
// routes/friends.js — Friend & Block Management
// v9.1-fix: #6 DELETE /cancel kiểm tra quyền
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
// FIX #12: Import từ lib/broadcast
const { broadcastToUser } = require('../lib/broadcast');

// POST /api/friends/request
router.post('/request', authenticateToken, async (req, res) => {
  try {
    const { receiver } = req.body;
    const sender = req.user.username;

    if (!receiver || sender === receiver) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const isBlocked = await query(`
      SELECT 1 FROM blocks 
      WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)
    `, [sender, receiver]);

    if (isBlocked.rows.length > 0) {
      return res.status(403).json({ error: 'NODE_BLOCKED: Communication blocked' });
    }

    const u1 = sender < receiver ? sender : receiver;
    const u2 = sender < receiver ? receiver : sender;

    const existing = await query(`SELECT * FROM friends WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

    if (existing.rows.length === 0) {
      await query(`
        INSERT INTO friends (user1, user2, status, sender) VALUES ($1, $2, 'pending', $3)
      `, [u1, u2, sender]);

      broadcastToUser(receiver, { type: 'friend_request', from: sender });
      return res.json({ status: 'pending', message: 'Friend request sent' });
    }

    const row = existing.rows[0];
    if (row.status === 'pending') {
      return res.json({ status: 'pending', message: 'Request already pending' });
    }

    res.json({ status: 'accepted', message: 'Already friends' });

  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/friends/status/:target
router.get('/status/:target', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const target = req.params.target.toLowerCase();

    const imBlocking = await query(`SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = $2`, [me, target]);
    if (imBlocking.rows.length > 0) return res.json({ relation: 'blocking' });

    const theyBlocking = await query(`SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = $2`, [target, me]);
    if (theyBlocking.rows.length > 0) return res.json({ relation: 'blocked_by' });

    const u1 = me < target ? me : target;
    const u2 = me < target ? target : me;

    const result = await query(`SELECT status, sender FROM friends WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

    if (result.rows.length === 0) return res.json({ relation: 'none' });

    const row = result.rows[0];
    if (row.status === 'accepted') return res.json({ relation: 'friends' });

    res.json({ relation: 'pending', sender: row.sender === me ? 'me' : 'them' });

  } catch (err) {
    console.error('Friend status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/friends/cancel
router.delete('/cancel', authenticateToken, async (req, res) => {
  try {
    const { target } = req.body;
    const me = req.user.username;

    if (!target) return res.status(400).json({ error: 'Target required' });

    const u1 = me < target ? me : target;
    const u2 = me < target ? target : me;

    // FIX #6: Check quyền — me phải là u1 hoặc u2
    if (me !== u1 && me !== u2) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await query(`DELETE FROM friends WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

    res.json({ success: true, message: 'Connection cancelled' });

  } catch (err) {
    console.error('Cancel friend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/friends/accept
router.put('/accept', authenticateToken, async (req, res) => {
  try {
    const { sender: friendUser } = req.body;
    const me = req.user.username;

    const u1 = me < friendUser ? me : friendUser;
    const u2 = me < friendUser ? friendUser : me;

    await query(`
      UPDATE friends SET status = 'accepted' 
      WHERE user1 = $1 AND user2 = $2 AND status = 'pending'
    `, [u1, u2]);

    broadcastToUser(friendUser, { type: 'network_update', sender: me, action: 'accept' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
