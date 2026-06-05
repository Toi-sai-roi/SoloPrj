// ==========================================
// server.js — Express + PostgreSQL + WebSocket Production Server
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const ws = require('ws');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { query, pool } = require('./config/db');
const { JWT_SECRET } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
  origin: true,  
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  }
}));

app.use(cors());
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================
// ROUTES
// ==========================================
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const profileRouter = require('./routes/profile');
const friendsRouter = require('./routes/friends');
const blocksRouter = require('./routes/blocks');
const groupsRouter = require('./routes/groups');
const uploadRouter = require('./routes/upload');

// New API paths (v2.0+)
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/profile', profileRouter);
app.use('/api/friends', friendsRouter);
app.use('/api', blocksRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/upload', uploadRouter);

// Legacy API aliases (v1.0 frontend compatibility)
app.post('/api/login', (req, res, next) => {
  req.url = '/login';
  authRouter(req, res, next);
});
app.post('/api/register', (req, res, next) => {
  req.url = '/register';
  authRouter(req, res, next);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use(errorHandler);

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const wss = new ws.Server({ server });

const onlineUsers = new Map();

async function trackOnlineUser(username, isOnline) {
  try {
    if (isOnline) {
      // Kiểm tra user tồn tại trong DB trước khi insert
      const userCheck = await query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (userCheck.rows.length === 0) {
        console.log(`[WS] User ${username} not found in DB, skipping online tracking`);
        return;
      }
      
      await query(`
        INSERT INTO online_users (username, connected_at)
        VALUES ($1, CURRENT_TIMESTAMP)
        ON CONFLICT (username) 
        DO UPDATE SET connected_at = CURRENT_TIMESTAMP
      `, [username]);
    } else {
      await query(`DELETE FROM online_users WHERE username = $1`, [username]);
    }
  } catch (err) {
    console.error('Track online user error:', err);
  }
}

async function initOnlineUsersTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS online_users (
        username VARCHAR(30) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
        connected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await query('DELETE FROM online_users');
  } catch (err) {
    console.error('Init online_users error:', err);
  }
}

function broadcastToUser(targetUsername, payload) {
  if (onlineUsers.has(targetUsername)) {
    const stringData = JSON.stringify(payload);
    onlineUsers.get(targetUsername).forEach(client => {
      if (client.readyState === ws.OPEN) {
        client.send(stringData);
      }
    });
  }
}

function broadcastStatusChange(username, online) {
  const payload = JSON.stringify({ type: 'status_change', username, online });
  for (const [targetUser, connections] of onlineUsers.entries()) {
    connections.forEach(c => {
      if (c.readyState === ws.OPEN) c.send(payload);
    });
  }
}

function broadcastStatusChangeToPair(userA, userB) {
  const isAOnline = onlineUsers.has(userA);
  const isBOnline = onlineUsers.has(userB);

  if (isAOnline) {
    const msgToA = JSON.stringify({ type: 'status_change', username: userB, online: isBOnline });
    onlineUsers.get(userA).forEach(c => {
      if (c.readyState === ws.OPEN) c.send(msgToA);
    });
  }

  if (isBOnline) {
    const msgToB = JSON.stringify({ type: 'status_change', username: userA, online: isAOnline });
    onlineUsers.get(userB).forEach(c => {
      if (c.readyState === ws.OPEN) c.send(msgToB);
    });
  }
}

function broadcastSystemMessage(text) {
  const payload = JSON.stringify({ type: 'system', text, timestamp: new Date().toISOString() });
  for (const connections of onlineUsers.values()) {
    connections.forEach(c => {
      if (c.readyState === ws.OPEN) c.send(payload);
    });
  }
}

async function markMessagesRead(sender, receiver) {
  try {
    await query(`
      UPDATE messages 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE sender = $1 AND receiver = $2 AND read_at IS NULL
    `, [sender, receiver]);
  } catch (err) {
    console.error('Mark messages read error:', err);
  }
}

async function updateLastSeen(username) {
  try {
    await query(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = $1`, [username]);
  } catch (err) {
    console.error('Update last seen error:', err);
  }
}

// WebSocket connection handler
wss.on('connection', async (wsConn, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    wsConn.close(1008, 'Authentication required');
    return;
  }

  let username;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    username = decoded.username;
    
    // KIỂM TRA USER TỒN TẠI TRONG DB
    const userCheck = await query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length === 0) {
      console.log(`[WS] Rejecting connection: User ${username} not found in DB`);
      wsConn.close(1008, 'User not found');
      return;
    }
  } catch {
    wsConn.close(1008, 'Invalid token');
    return;
  }

  console.log(`[WS] ${username} connected`);
  await updateLastSeen(username);

  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }
  onlineUsers.get(username).add(wsConn);
  await trackOnlineUser(username, true);

  if (onlineUsers.get(username).size === 1) {
    broadcastStatusChange(username, true);
    broadcastSystemMessage(`${username} đã đăng nhập vào mạng lưới.`);
  }

  let isAlive = true;
  wsConn.on('pong', () => {
    isAlive = true;
    updateLastSeen(username);
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      wsConn.terminate();
      return;
    }
    isAlive = false;
    wsConn.ping();
  }, 30000);

  wsConn.on('message', async (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      await updateLastSeen(username);

      if (data.type === 'typing') {
        const { to, isTyping } = data;
        if (!to) return;
        broadcastToUser(to, { type: 'typing', sender: username, isTyping });
        return;
      }

      if (data.type === 'get_history') {
        const { with: withUser } = data;
        if (!withUser) return;

        await markMessagesRead(withUser, username);
        broadcastToUser(withUser, { type: 'read_receipt', reader: username, with: withUser });

        const history = await query(`
          SELECT 
            m.id,
            m.sender,
            m.receiver,
            m.text,
            m.media_url,
            m.timestamp,
            m.delivered,
            m.read_at,
            COALESCE(
              (SELECT json_object_agg(r.emoji, r.count) 
               FROM (SELECT emoji, COUNT(*) as count 
                     FROM reactions 
                     WHERE message_id = m.id 
                     GROUP BY emoji) r),
              '{}'
            ) as reactions
          FROM messages m
          WHERE (m.sender = $1 AND m.receiver = $2) 
             OR (m.sender = $2 AND m.receiver = $1)
          ORDER BY m.timestamp ASC
        `, [username, withUser]);

        wsConn.send(JSON.stringify({ type: 'history', with: withUser, messages: history.rows }));
        return;
      }

      if (data.type === 'send_message') {
        const { to, text, media_url } = data;
        if (!to || (!text?.trim() && !media_url)) return;

        const cleanText = text?.trim() || '';

        const blockCheck = await query(`
          SELECT 1 FROM blocks 
          WHERE (blocker = $1 AND blocked = $2) 
             OR (blocker = $2 AND blocked = $1)
        `, [username, to]);

        if (blockCheck.rows.length > 0) {
          wsConn.send(JSON.stringify({
            type: 'system',
            text: `[ SYSTEM // ACCESS_DENIED: Communication blocked ]`
          }));
          return;
        }

        const isReceiverOnline = onlineUsers.has(to);

        const result = await query(`
          INSERT INTO messages (sender, receiver, text, media_url, delivered)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, timestamp
        `, [username, to, cleanText, media_url || '', isReceiverOnline]);

        const msgId = result.rows[0].id;
        const timestamp = result.rows[0].timestamp;

        const chatMsg = {
          type: 'message',
          id: msgId,
          sender: username,
          receiver: to,
          text: cleanText,
          media_url: media_url || '',
          timestamp,
          delivered: isReceiverOnline,
          read_at: null
        };

        if (isReceiverOnline) {
          broadcastToUser(to, chatMsg);
        }

        wsConn.send(JSON.stringify({ ...chatMsg, self: true }));
        return;
      }

      if (data.type === 'add_reaction') {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;

        await query(`
          INSERT INTO reactions (message_id, username, emoji)
          VALUES ($1, $2, $3)
          ON CONFLICT (message_id, username) 
          DO UPDATE SET emoji = $3, created_at = CURRENT_TIMESTAMP
        `, [messageId, username, emoji]);

        const reactions = await query(`
          SELECT json_object_agg(username, emoji) as reaction_map
          FROM reactions
          WHERE message_id = $1
        `, [messageId]);

        const msgInfo = await query(`
          SELECT sender, receiver FROM messages WHERE id = $1
        `, [messageId]);

        if (msgInfo.rows.length > 0) {
          const { sender, receiver } = msgInfo.rows[0];
          const update = {
            type: 'reaction_update',
            messageId,
            reactions: reactions.rows[0]?.reaction_map || {}
          };
          broadcastToUser(sender, update);
          broadcastToUser(receiver, update);
        }
        return;
      }

      if (data.type === 'send_group_message') {
        const { groupId, text, media_url } = data;
        if (!groupId || (!text?.trim() && !media_url)) return;

        const memberCheck = await query(`
          SELECT 1 FROM group_members WHERE group_id = $1 AND username = $2
        `, [groupId, username]);

        if (memberCheck.rows.length === 0) {
          wsConn.send(JSON.stringify({
            type: 'system',
            text: '[ SYSTEM // ACCESS_DENIED: Not a group member ]'
          }));
          return;
        }

        const cleanText = text?.trim() || '';

        const result = await query(`
          INSERT INTO group_messages (group_id, sender, text, media_url)
          VALUES ($1, $2, $3, $4)
          RETURNING id, timestamp
        `, [groupId, username, cleanText, media_url || '']);

        const msg = {
          type: 'group_message',
          id: result.rows[0].id,
          groupId,
          sender: username,
          text: cleanText,
          media_url: media_url || '',
          timestamp: result.rows[0].timestamp
        };

        const members = await query(`
          SELECT username FROM group_members WHERE group_id = $1
        `, [groupId]);

        members.rows.forEach(m => {
          if (m.username === username) {
            wsConn.send(JSON.stringify({ ...msg, self: true }));
          } else {
            broadcastToUser(m.username, msg);
          }
        });
        return;
      }

      if (data.type === 'get_group_history') {
        const { groupId } = data;
        if (!groupId) return;

        const memberCheck = await query(`
          SELECT 1 FROM group_members WHERE group_id = $1 AND username = $2
        `, [groupId, username]);

        if (memberCheck.rows.length === 0) return;

        const messages = await query(`
          SELECT 
            gm.id,
            gm.group_id,
            gm.sender,
            gm.text,
            gm.media_url,
            gm.timestamp,
            COALESCE(
              (SELECT json_object_agg(username, emoji)
               FROM group_reactions
               WHERE message_id = gm.id),
              '{}'
            ) as reactions
          FROM group_messages gm
          WHERE gm.group_id = $1
          ORDER BY gm.timestamp ASC
        `, [groupId]);

        wsConn.send(JSON.stringify({ type: 'group_history', groupId, messages: messages.rows }));
        return;
      }

      if (data.type === 'group_typing') {
        const { groupId, isTyping } = data;
        if (!groupId) return;

        const members = await query(`
          SELECT username FROM group_members WHERE group_id = $1 AND username != $2
        `, [groupId, username]);

        members.rows.forEach(m => {
          broadcastToUser(m.username, {
            type: 'group_typing',
            groupId,
            sender: username,
            isTyping
          });
        });
        return;
      }

      if (data.type === 'group_reaction') {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;

        const msg = await query(`
          SELECT group_id FROM group_messages WHERE id = $1
        `, [messageId]);

        if (msg.rows.length === 0) return;

        const groupId = msg.rows[0].group_id;

        await query(`
          INSERT INTO group_reactions (message_id, username, emoji)
          VALUES ($1, $2, $3)
          ON CONFLICT (message_id, username)
          DO UPDATE SET emoji = $3, created_at = CURRENT_TIMESTAMP
        `, [messageId, username, emoji]);

        const reactions = await query(`
          SELECT json_object_agg(username, emoji) as reaction_map
          FROM group_reactions
          WHERE message_id = $1
        `, [messageId]);

        const members = await query(`
          SELECT username FROM group_members WHERE group_id = $1
        `, [groupId]);

        members.rows.forEach(m => {
          broadcastToUser(m.username, {
            type: 'group_reaction_update',
            messageId,
            groupId,
            reactions: reactions.rows[0]?.reaction_map || {}
          });
        });
        return;
      }

    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  wsConn.on('close', async () => {
    clearInterval(pingInterval);

    const conns = onlineUsers.get(username);
    if (conns) {
      conns.delete(wsConn);
      if (conns.size === 0) {
        onlineUsers.delete(username);
        await trackOnlineUser(username, false);
        broadcastStatusChange(username, false);
        broadcastSystemMessage(`${username} đã ngắt kết nối.`);
      }
    }
  });
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('HTTP server closed');
  });
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('HTTP server closed');
  });
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;

async function start() {
  await initOnlineUsersTable();

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 CYBERPUNK CHAT v2.0 — PRODUCTION READY`);
    console.log(`🔧 Express + PostgreSQL + WebSocket`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = {
  broadcastToUser,
  broadcastStatusChange,
  broadcastStatusChangeToPair,
  broadcastSystemMessage
};