// ==========================================
// routes/groups.js — Group Chat Management
// ==========================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// POST /api/groups/create
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const { name, description, avatar, members } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = $1', [me]);

    const result = await query(`
      INSERT INTO groups (name, avatar, description, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [name.trim(), avatar || '', description || '', me]);

    const groupId = result.rows[0].id;

    await query(`
      INSERT INTO group_members (group_id, username, role)
      VALUES ($1, $2, 'admin')
    `, [groupId, me]);

    const invitedMembers = Array.isArray(members) ? members.filter(u => u !== me) : [];

    for (const username of invitedMembers) {
      const userExists = await query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (userExists.rows.length > 0) {
        await query(`
          INSERT INTO group_members (group_id, username, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT DO NOTHING
        `, [groupId, username]);

        const { broadcastToUser } = require('../server');
        if (broadcastToUser) {
          broadcastToUser(username, {
            type: 'group_invite',
            groupId,
            groupName: name.trim(),
            invitedBy: me
          });
        }
      }
    }

    res.status(201).json({ success: true, groupId, name: name.trim() });

  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/groups/my
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;

    const result = await query(`
      SELECT 
        g.id,
        g.name,
        g.avatar,
        g.description,
        g.created_by,
        g.created_at,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT text FROM group_messages WHERE group_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT timestamp FROM group_messages WHERE group_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
        gm.role
      FROM groups g
      INNER JOIN group_members gm ON g.id = gm.group_id AND gm.username = $1
      ORDER BY last_message_time DESC NULLS LAST, g.created_at DESC
    `, [me]);

    res.json(result.rows);

  } catch (err) {
    console.error('Get groups error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/groups/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);

    const memberCheck = await query(`
      SELECT role FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const groupResult = await query(`SELECT * FROM groups WHERE id = $1`, [groupId]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const membersResult = await query(`
      SELECT gm.username, gm.role, gm.joined_at, u.avatar
      FROM group_members gm
      LEFT JOIN users u ON gm.username = u.username
      WHERE gm.group_id = $1
      ORDER BY gm.role DESC, gm.joined_at ASC
    `, [groupId]);

    res.json({
      ...groupResult.rows[0],
      members: membersResult.rows,
      myRole: memberCheck.rows[0].role
    });

  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/groups/:id
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);
    const { name, description, avatar } = req.body;

    const memberCheck = await query(`
      SELECT role FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    if (name) {
      await query('UPDATE groups SET name = $1 WHERE id = $2', [name.trim(), groupId]);
    }
    if (description !== undefined) {
      await query('UPDATE groups SET description = $1 WHERE id = $2', [description, groupId]);
    }
    if (avatar !== undefined) {
      await query('UPDATE groups SET avatar = $1 WHERE id = $2', [avatar, groupId]);
    }

    const members = await query(`
      SELECT username FROM group_members WHERE group_id = $1
    `, [groupId]);

    const { broadcastToUser } = require('../server');
    const updatedGroup = await query('SELECT * FROM groups WHERE id = $1', [groupId]);

    members.rows.forEach(m => {
      if (broadcastToUser) {
        broadcastToUser(m.username, {
          type: 'group_updated',
          group: updatedGroup.rows[0]
        });
      }
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Update group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/groups/:id/invite
router.post('/:id/invite', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);
    const { username } = req.body;

    const memberCheck = await query(`
      SELECT 1 FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    const userExists = await query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const alreadyMember = await query(`
      SELECT 1 FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, username]);

    if (alreadyMember.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member' });
    }

    await query(`
      INSERT INTO group_members (group_id, username, role)
      VALUES ($1, $2, 'member')
    `, [groupId, username]);

    const group = await query('SELECT name FROM groups WHERE id = $1', [groupId]);

    const { broadcastToUser } = require('../server');
    if (broadcastToUser) {
      broadcastToUser(username, {
        type: 'group_invite',
        groupId,
        groupName: group.rows[0].name,
        invitedBy: me
      });
    }

    const members = await query(`
      SELECT username FROM group_members WHERE group_id = $1
    `, [groupId]);

    members.rows.forEach(m => {
      if (m.username !== username && broadcastToUser) {
        broadcastToUser(m.username, {
          type: 'group_member_joined',
          groupId,
          username
        });
      }
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/groups/:id/members/:username
router.delete('/:id/members/:username', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);
    const targetUsername = req.params.username;

    const myRole = await query(`
      SELECT role FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    if (myRole.rows.length === 0 || myRole.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    if (targetUsername === me) {
      return res.status(400).json({ error: 'Cannot kick yourself' });
    }

    await query(`
      DELETE FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, targetUsername]);

    const { broadcastToUser } = require('../server');
    if (broadcastToUser) {
      broadcastToUser(targetUsername, { type: 'group_kicked', groupId });

      const members = await query(`
        SELECT username FROM group_members WHERE group_id = $1
      `, [groupId]);

      members.rows.forEach(m => {
        broadcastToUser(m.username, {
          type: 'group_member_left',
          groupId,
          username: targetUsername
        });
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Kick error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/groups/:id/leave
router.delete('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);

    const myRole = await query(`
      SELECT role FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    if (myRole.rows.length === 0) {
      return res.status(400).json({ error: 'Not in this group' });
    }

    if (myRole.rows[0].role === 'admin') {
      const nextMember = await query(`
        SELECT username FROM group_members 
        WHERE group_id = $1 AND username != $2 
        LIMIT 1
      `, [groupId, me]);

      if (nextMember.rows.length > 0) {
        await query(`
          UPDATE group_members SET role = 'admin' 
          WHERE group_id = $1 AND username = $2
        `, [groupId, nextMember.rows[0].username]);

        const { broadcastToUser } = require('../server');
        if (broadcastToUser) {
          broadcastToUser(nextMember.rows[0].username, {
            type: 'group_promoted',
            groupId
          });
        }
      } else {
        await query('DELETE FROM groups WHERE id = $1', [groupId]);
        return res.json({ success: true, groupDeleted: true });
      }
    }

    await query(`
      DELETE FROM group_members WHERE group_id = $1 AND username = $2
    `, [groupId, me]);

    const { broadcastToUser } = require('../server');
    if (broadcastToUser) {
      const members = await query(`
        SELECT username FROM group_members WHERE group_id = $1
      `, [groupId]);

      members.rows.forEach(m => {
        broadcastToUser(m.username, {
          type: 'group_member_left',
          groupId,
          username: me
        });
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Leave group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const me = req.user.username;
    const groupId = parseInt(req.params.id);

    const group = await query(`
      SELECT created_by FROM groups WHERE id = $1
    `, [groupId]);

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (group.rows[0].created_by !== me) {
      return res.status(403).json({ error: 'Creator only' });
    }

    const members = await query(`
      SELECT username FROM group_members WHERE group_id = $1
    `, [groupId]);

    await query('DELETE FROM groups WHERE id = $1', [groupId]);

    const { broadcastToUser } = require('../server');
    if (broadcastToUser) {
      members.rows.forEach(m => {
        if (m.username !== me) {
          broadcastToUser(m.username, { type: 'group_deleted', groupId });
        }
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;