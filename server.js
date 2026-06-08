// ==========================================
// server.js — Express + PostgreSQL + WebSocket Production Server
// v9.1-fix — Fixed: double CORS, JWT via WS auth message, integer validation,
//            search_messages auth, errorHandler position, circular require
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
// FIX #12: Import từ lib/broadcast thay vì circular require
const broadcast = require('./lib/broadcast');

const app = express();
const server = http.createServer(app);

// ==========================================
// MIDDLEWARE
// ==========================================
// FIX #1: Xóa app.use(cors()) thừa ở dưới, chỉ giữ cái có config origin
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

// REMOVED: app.use(cors()); // FIX #1: đã xóa duplicate cors
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

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/profile', profileRouter);
app.use('/api/friends', friendsRouter);
app.use('/api', blocksRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/upload', uploadRouter);

// Legacy API aliases
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

// FIX #5: errorHandler phải đặt SAU SPA fallback
app.use(errorHandler);

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const wss = new ws.Server({ server });

const onlineUsers = new Map();

// FIX #12: Init broadcast module với onlineUsers map
broadcast.init(onlineUsers);

// Re-export để routes cũ vẫn hoạt động (compatibility)
const broadcastToUser = broadcast.broadcastToUser;
const broadcastStatusChange = broadcast.broadcastStatusChange;
const broadcastStatusChangeToPair = broadcast.broadcastStatusChangeToPair;
const broadcastSystemMessage = broadcast.broadcastSystemMessage;

async function trackOnlineUser(username, isOnline) {
  try {
    if (isOnline) {
      const userCheck = await query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (userCheck.rows.length === 0) return;
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

async function migrateMessagesTable() {
  try {
    const readAtCheck = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'read_at'
    `);
    if (readAtCheck.rows.length === 0) {
      await query(`ALTER TABLE messages ADD COLUMN read_at TIMESTAMPTZ`);
      console.log('[DB] Added read_at to messages');
    }

    const replyToCheck = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'reply_to'
    `);
    if (replyToCheck.rows.length === 0) {
      await query(`ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL`);
      console.log('[DB] Added reply_to to messages');
    }

    const deletedAtCheck = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'deleted_at'
    `);
    if (deletedAtCheck.rows.length === 0) {
      await query(`ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMPTZ`);
      console.log('[DB] Added deleted_at to messages');
    }

    const pinnedCheck = await query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'pinned_messages'
    `);
    if (pinnedCheck.rows.length === 0) {
      await query(`
        CREATE TABLE pinned_messages (
          id          SERIAL PRIMARY KEY,
          user1       VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          user2       VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          pinned_by   VARCHAR(30) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          pinned_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user1, user2)
        )
      `);
      await query(`CREATE INDEX idx_pinned_messages_lookup ON pinned_messages(user1, user2)`);
      console.log('[DB] Created pinned_messages table');
    }
  } catch (err) {
    console.error('[DB] Migration error:', err);
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

async function getUnreadCounts(username) {
  try {
    const result = await query(`
      SELECT sender, COUNT(*) as count
      FROM messages
      WHERE receiver = $1 AND read_at IS NULL AND deleted_at IS NULL
      GROUP BY sender
      ORDER BY count DESC
    `, [username]);
    const counts = {};
    result.rows.forEach(row => {
      counts[row.sender] = parseInt(row.count);
    });
    return counts;
  } catch (err) {
    console.error('Get unread counts error:', err);
    return {};
  }
}

async function broadcastUnreadCounts(username) {
  const counts = await getUnreadCounts(username);
  broadcastToUser(username, { type: 'unread_counts', counts });
}

async function getReplyInfo(replyToId) {
  if (!replyToId) return null;
  try {
    const result = await query(`
      SELECT id, sender, 
        CASE WHEN deleted_at IS NOT NULL THEN '[Đã xóa]' ELSE text END as text
      FROM messages WHERE id = $1
    `, [replyToId]);
    if (result.rows.length === 0) return null;
    return {
      id: result.rows[0].id,
      sender: result.rows[0].sender,
      text: result.rows[0].text.substring(0, 100)
    };
  } catch (err) {
    console.error('Get reply info error:', err);
    return null;
  }
}

// FIX #3: Helper validate messageId là integer
function validateMessageId(messageId) {
  const id = parseInt(messageId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ==========================================
// WEBSOCKET CONNECTION HANDLER
// ==========================================
wss.on('connection', async (wsConn, req) => {
  let username = null;

  // FIX #2: Không nhận token từ URL query string nữa
  // Yêu cầu client gửi { type: 'auth', token } làm message đầu tiên
  // Đóng kết nối nếu không nhận được auth trong 5 giây
  const authTimeout = setTimeout(() => {
    if (!username) {
      console.log('[WS] Auth timeout — closing unauthenticated connection');
      wsConn.close(1008, 'Authentication timeout');
    }
  }, 5000); // FIX #2: 5s timeout

  wsConn.once('message', async (firstMsg) => {
    try {
      const data = JSON.parse(firstMsg);

      // FIX #2: Message đầu phải là { type: 'auth', token }
      if (data.type !== 'auth' || !data.token) {
        clearTimeout(authTimeout);
        wsConn.close(1008, 'First message must be auth');
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
      } catch {
        clearTimeout(authTimeout);
        wsConn.close(1008, 'Invalid token');
        return;
      }

      username = decoded.username;

      const userCheck = await query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (userCheck.rows.length === 0) {
        clearTimeout(authTimeout);
        console.log(`[WS] Rejecting: User ${username} not found`);
        wsConn.close(1008, 'User not found');
        return;
      }

      clearTimeout(authTimeout);
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

      setTimeout(async () => {
        await broadcastUnreadCounts(username);
      }, 500);

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
            await broadcastUnreadCounts(username);

            const history = await query(`
              SELECT 
                m.id, m.sender, m.receiver, m.text, m.media_url,
                m.timestamp, m.delivered, m.read_at, m.reply_to, m.deleted_at,
                CASE WHEN m.deleted_at IS NOT NULL THEN '[TIN NHẮN ĐÃ BỊ XÓA]' ELSE m.text END as display_text,
                COALESCE(
                  (SELECT json_object_agg(r.emoji, r.count) 
                   FROM (SELECT emoji, COUNT(*) as count 
                         FROM reactions 
                         WHERE message_id = m.id 
                         GROUP BY emoji) r),
                  '{}'
                ) as reactions,
                (SELECT json_build_object(
                  'id', rm.id,
                  'sender', rm.sender,
                  'text', CASE WHEN rm.deleted_at IS NOT NULL THEN '[Đã xóa]' ELSE LEFT(rm.text, 100) END
                ) FROM messages rm WHERE rm.id = m.reply_to) as reply_info
              FROM messages m
              WHERE ((m.sender = $1 AND m.receiver = $2) 
                 OR (m.sender = $2 AND m.receiver = $1))
              ORDER BY m.timestamp ASC
            `, [username, withUser]);

            wsConn.send(JSON.stringify({ type: 'history', with: withUser, messages: history.rows }));
            return;
          }

          if (data.type === 'send_message') {
            const { to, text, media_url, reply_to } = data;
            if (!to || (!text?.trim() && !media_url)) return;

            const cleanText = text?.trim() || '';

            const blockCheck = await query(`
              SELECT 1 FROM blocks 
              WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)
            `, [username, to]);

            if (blockCheck.rows.length > 0) {
              wsConn.send(JSON.stringify({ type: 'system', text: `[ SYSTEM // ACCESS_DENIED: Communication blocked ]` }));
              return;
            }

            const isReceiverOnline = onlineUsers.has(to);

            const result = await query(`
              INSERT INTO messages (sender, receiver, text, media_url, delivered, reply_to)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id, timestamp
            `, [username, to, cleanText, media_url || '', isReceiverOnline, reply_to || null]);

            const msgId = result.rows[0].id;
            const timestamp = result.rows[0].timestamp;

            const replyInfo = await getReplyInfo(reply_to);

            const chatMsg = {
              type: 'message',
              id: msgId,
              sender: username,
              receiver: to,
              text: cleanText,
              media_url: media_url || '',
              timestamp,
              delivered: isReceiverOnline,
              read_at: null,
              reply_to: reply_to || null,
              reply_info: replyInfo
            };

            if (isReceiverOnline) {
              broadcastToUser(to, chatMsg);
              await broadcastUnreadCounts(to);
            }

            wsConn.send(JSON.stringify({ ...chatMsg, self: true }));
            return;
          }

          if (data.type === 'delete_message') {
            const { messageId } = data;
            // FIX #3: Validate messageId là integer
            const validId = validateMessageId(messageId);
            if (!validId) return;

            const msgCheck = await query(`SELECT sender, receiver FROM messages WHERE id = $1`, [validId]);
            if (msgCheck.rows.length === 0) {
              wsConn.send(JSON.stringify({ type: 'system', text: 'Message not found' }));
              return;
            }

            const { sender, receiver } = msgCheck.rows[0];
            if (sender !== username) {
              wsConn.send(JSON.stringify({ type: 'system', text: 'Cannot delete other user message' }));
              return;
            }

            await query(`UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [validId]);

            const update = { type: 'message_deleted', messageId: validId };
            broadcastToUser(sender, update);
            broadcastToUser(receiver, update);
            return;
          }

          if (data.type === 'add_reaction') {
            const { messageId, emoji } = data;
            // FIX #3: Validate messageId là integer
            const validId = validateMessageId(messageId);
            if (!validId || !emoji) return;

            await query(`
              INSERT INTO reactions (message_id, username, emoji)
              VALUES ($1, $2, $3)
              ON CONFLICT (message_id, username) 
              DO UPDATE SET emoji = $3, created_at = CURRENT_TIMESTAMP
            `, [validId, username, emoji]);

            const reactions = await query(`
              SELECT json_object_agg(username, emoji) as reaction_map
              FROM reactions WHERE message_id = $1
            `, [validId]);

            const msgInfo = await query(`SELECT sender, receiver FROM messages WHERE id = $1`, [validId]);

            if (msgInfo.rows.length > 0) {
              const { sender, receiver } = msgInfo.rows[0];
              const update = {
                type: 'reaction_update',
                messageId: validId,
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
              wsConn.send(JSON.stringify({ type: 'system', text: '[ SYSTEM // ACCESS_DENIED: Not a group member ]' }));
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

            const members = await query(`SELECT username FROM group_members WHERE group_id = $1`, [groupId]);

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
                gm.id, gm.group_id, gm.sender, gm.text, gm.media_url, gm.timestamp,
                COALESCE(
                  (SELECT json_object_agg(username, emoji)
                   FROM group_reactions WHERE message_id = gm.id),
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
              broadcastToUser(m.username, { type: 'group_typing', groupId, sender: username, isTyping });
            });
            return;
          }

          if (data.type === 'group_reaction') {
            const { messageId, emoji } = data;
            if (!messageId || !emoji) return;

            const msg = await query(`SELECT group_id FROM group_messages WHERE id = $1`, [messageId]);
            if (msg.rows.length === 0) return;

            const groupId = msg.rows[0].group_id;

            await query(`
              INSERT INTO group_reactions (message_id, username, emoji)
              VALUES ($1, $2, $3)
              ON CONFLICT (message_id, username) DO UPDATE SET emoji = $3, created_at = CURRENT_TIMESTAMP
            `, [messageId, username, emoji]);

            const reactions = await query(`
              SELECT json_object_agg(username, emoji) as reaction_map
              FROM group_reactions WHERE message_id = $1
            `, [messageId]);

            const members = await query(`SELECT username FROM group_members WHERE group_id = $1`, [groupId]);

            members.rows.forEach(m => {
              broadcastToUser(m.username, {
                type: 'group_reaction_update',
                messageId, groupId,
                reactions: reactions.rows[0]?.reaction_map || {}
              });
            });
            return;
          }

          if (data.type === 'pin_message') {
            const { messageId } = data;
            // FIX #3: Validate messageId là integer
            const validId = validateMessageId(messageId);
            if (!validId) return;

            const msgCheck = await query(`
              SELECT sender, receiver FROM messages WHERE id = $1 AND deleted_at IS NULL
            `, [validId]);

            if (msgCheck.rows.length === 0) {
              wsConn.send(JSON.stringify({ type: 'system', text: 'Message not found or deleted' }));
              return;
            }

            const { sender, receiver } = msgCheck.rows[0];
            if (sender !== username && receiver !== username) {
              wsConn.send(JSON.stringify({ type: 'system', text: 'Cannot pin message from other conversation' }));
              return;
            }

            const u1 = sender < receiver ? sender : receiver;
            const u2 = sender < receiver ? receiver : sender;

            await query(`
              INSERT INTO pinned_messages (user1, user2, message_id, pinned_by)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (user1, user2) 
              DO UPDATE SET message_id = $3, pinned_by = $4, pinned_at = CURRENT_TIMESTAMP
            `, [u1, u2, validId, username]);

            const pinnedMsg = await query(`
              SELECT m.id, m.sender, m.text, m.media_url, m.timestamp, m.reply_to,
                (SELECT json_build_object(
                  'id', rm.id, 'sender', rm.sender,
                  'text', CASE WHEN rm.deleted_at IS NOT NULL THEN '[Đã xóa]' ELSE LEFT(rm.text, 100) END
                ) FROM messages rm WHERE rm.id = m.reply_to) as reply_info
              FROM messages m WHERE m.id = $1
            `, [validId]);

            const pinUpdate = {
              type: 'pin_update',
              conversation: { user1: u1, user2: u2 },
              pinned_message: pinnedMsg.rows[0] || null,
              pinned_by: username,
              pinned_at: new Date().toISOString()
            };

            broadcastToUser(sender, pinUpdate);
            broadcastToUser(receiver, pinUpdate);
            return;
          }

          if (data.type === 'unpin_message') {
            const { withUser } = data;
            if (!withUser) return;

            const u1 = username < withUser ? username : withUser;
            const u2 = username < withUser ? withUser : username;

            await query(`DELETE FROM pinned_messages WHERE user1 = $1 AND user2 = $2`, [u1, u2]);

            const unpinUpdate = {
              type: 'pin_update',
              conversation: { user1: u1, user2: u2 },
              pinned_message: null
            };
            broadcastToUser(username, unpinUpdate);
            broadcastToUser(withUser, unpinUpdate);
            return;
          }

          if (data.type === 'get_pinned') {
            const { with: withUser } = data;
            if (!withUser) return;

            const u1 = username < withUser ? username : withUser;
            const u2 = username < withUser ? withUser : username;

            const result = await query(`
              SELECT m.id, m.sender, m.text, m.media_url, m.timestamp, m.reply_to,
                (SELECT json_build_object(
                  'id', rm.id, 'sender', rm.sender,
                  'text', CASE WHEN rm.deleted_at IS NOT NULL THEN '[Đã xóa]' ELSE LEFT(rm.text, 100) END
                ) FROM messages rm WHERE rm.id = m.reply_to) as reply_info
              FROM pinned_messages pm
              JOIN messages m ON pm.message_id = m.id
              WHERE pm.user1 = $1 AND pm.user2 = $2
            `, [u1, u2]);

            wsConn.send(JSON.stringify({
              type: 'pin_update',
              conversation: { user1: u1, user2: u2 },
              pinned_message: result.rows[0] || null
            }));
            return;
          }

          if (data.type === 'search_messages') {
            const { with: withUser, q: keyword } = data;
            if (!withUser || !keyword?.trim()) {
              wsConn.send(JSON.stringify({ type: 'search_results', results: [] }));
              return;
            }

            // FIX #4: Verify username là một trong hai bên của conversation với withUser
            // Query messages table (KHÔNG dùng friends table)
            const authCheck = await query(`
              SELECT 1 FROM messages
              WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)
              LIMIT 1
            `, [username, withUser]);

            if (authCheck.rows.length === 0) {
              wsConn.send(JSON.stringify({ type: 'search_results', results: [] }));
              return;
            }

            const searchTerm = `%${keyword.trim().toLowerCase()}%`;

            const results = await query(`
              SELECT m.id, m.sender, m.text, m.media_url, m.timestamp, m.reply_to
              FROM messages m
              WHERE ((m.sender = $1 AND m.receiver = $2) OR (m.sender = $2 AND m.receiver = $1))
                AND m.deleted_at IS NULL
                AND LOWER(m.text) LIKE $3
              ORDER BY m.timestamp DESC
              LIMIT 50
            `, [username, withUser, searchTerm]);

            wsConn.send(JSON.stringify({
              type: 'search_results',
              with: withUser,
              query: keyword.trim(),
              results: results.rows
            }));
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

    } catch (err) {
      clearTimeout(authTimeout);
      console.error('[WS] Auth parse error:', err);
      wsConn.close(1008, 'Invalid auth message');
    }
  });

  // Nếu connection bị đóng trước khi auth
  wsConn.on('close', () => {
    clearTimeout(authTimeout);
  });
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  server.close(() => console.log('HTTP server closed'));
  await pool.end();
  console.log('Database pool closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  server.close(() => console.log('HTTP server closed'));
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
  await migrateMessagesTable();

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 CYBERPUNK CHAT v9.1-fix — SECURITY + BROADCAST`);
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
