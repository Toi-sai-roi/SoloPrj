// ==========================================
// routes/blocks.js — Block Management
// ==========================================
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// POST /api/block
router.post('/block', authenticateToken, async (req, res) => {
  try {
    const { target } = req.body;
    const blocker = req.user.username;

    if (!target || blocker === target) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const client = await getClient();

    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO blocks (blocker, blocked) VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [blocker, target]);

      const u1 = blocker < target ? blocker : target;
      const u2 = blocker < target ? target : blocker;

      await client.query(`
        DELETE FROM friends WHERE user1 = $1 AND user2 = $2
      `, [u1, u2]);

      await client.query('COMMIT');

      const { broadcastStatusChangeToPair } = require('../server');
      if (broadcastStatusChangeToPair) {
        broadcastStatusChangeToPair(blocker, target);
      }

      res.json({
        success: true,
        message: `Network node ${target.toUpperCase()} isolated`
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Block error:', err);
    res.status(500).json({ error: 'Block operation failed' });
  }
});

// POST /api/unblock
router.post('/unblock', authenticateToken, async (req, res) => {
  try {
    const { target } = req.body;
    const blocker = req.user.username;

    if (!target) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    await query(`
      DELETE FROM blocks WHERE blocker = $1 AND blocked = $2
    `, [blocker, target]);

    const { broadcastStatusChangeToPair } = require('../server');
    if (broadcastStatusChangeToPair) {
      broadcastStatusChangeToPair(blocker, target);
    }

    res.json({ success: true, message: 'Connection unlocked' });

  } catch (err) {
    console.error('Unblock error:', err);
    res.status(500).json({ error: 'Unblock operation failed' });
  }
});

module.exports = router;