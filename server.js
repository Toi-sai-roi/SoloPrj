const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('ws');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

// ==========================================
// CONFIG
// ==========================================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cyberpunk-neon-glow-secret-2026';
const DB_PATH = path.join(__dirname, 'chat.db');

// ==========================================
// DATABASE (Đã tích hợp sẵn cột Avatar, Bio, Last_seen)
// ==========================================
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    avatar        TEXT DEFAULT '',
    bio           TEXT DEFAULT '',
    last_seen     DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sender    TEXT NOT NULL,
    receiver  TEXT NOT NULL,
    text      TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    delivered BOOLEAN DEFAULT 0,
    read_at   DATETIME,
    FOREIGN KEY (sender)   REFERENCES users(username),
    FOREIGN KEY (receiver) REFERENCES users(username)
  );
  
  CREATE TABLE IF NOT EXISTS reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    username   TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    count      INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  ); 

  CREATE TABLE IF NOT EXISTS friends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one    TEXT NOT NULL,
    user_two    TEXT NOT NULL,
    status      TEXT DEFAULT 'pending', -- 'pending' (chờ), 'accepted' (bạn bè)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_one) REFERENCES users(username),
    FOREIGN KEY (user_two) REFERENCES users(username),
    UNIQUE(user_one, user_two) -- Tránh trùng lặp quan hệ chéo
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker     TEXT NOT NULL,
    blocked     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blocker) REFERENCES users(username),
    FOREIGN KEY (blocked) REFERENCES users(username),
    UNIQUE(blocker, blocked)
  );
`);

console.log('✅ SQLite database initialized:', DB_PATH);

// ==========================================
// DATABASE HELPER FUNCTIONS
// ==========================================
function markMessagesRead(sender, receiver) {
  db.prepare(`UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender = ? AND receiver = ? AND read_at IS NULL`).run(sender, receiver);
}

// Cập nhật last_seen mỗi khi user tương tác mạng lưới
function updateLastSeen(username) {
  db.prepare(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = ?`).run(username);
}

// ==========================================
// ONLINE USERS MAP
// ==========================================
const onlineUsers = new Map();

// ==========================================
// AUTH HELPERS
// ==========================================
function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

// ==========================================
// HTTP HELPERS
// ==========================================
function getPostBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ==========================================
// STATIC FILE SERVER
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, indexContent) => {
        if (err2) { res.writeHead(500); res.end('Server error'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexContent);
      });
    } else {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    }
  });
}

// ==========================================
// HTTP SERVER
// ==========================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');

  // POST /api/register
  if (pathname === '/api/register' && req.method === 'POST') {
    try {
      const { username, password } = await getPostBody(req);
      if (!username || !password) return sendJSON(res, 400, { error: 'Username và password không được để trống' });
      const clean = username.trim().toLowerCase();
      if (clean.length < 3 || clean.length > 20) return sendJSON(res, 400, { error: 'Username phải từ 3 đến 20 ký tự' });
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(clean)) return sendJSON(res, 400, { error: 'Tên đăng nhập đã được sử dụng' });
      const salt = generateSalt();
      const hash = hashPassword(password, salt);
      db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)').run(clean, hash, salt);
      const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '7d' });
      return sendJSON(res, 201, { success: true, token, username: clean });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { username, password } = await getPostBody(req);
      if (!username || !password) return sendJSON(res, 400, { error: 'Username và password không được để trống' });
      const clean = username.trim().toLowerCase();
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);
      if (!user || hashPassword(password, user.salt) !== user.password_hash) return sendJSON(res, 400, { error: 'Tài khoản hoặc mật khẩu không chính xác' });

      updateLastSeen(clean); // Cập nhật thời gian online khi đăng nhập
      const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '7d' });
      return sendJSON(res, 200, { success: true, token, username: clean });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // Lấy danh sách users có kèm trường AVATAR để hiển thị ra danh sách chat lề trái
  if (pathname === '/api/users' && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const allUsers = db.prepare('SELECT username, avatar FROM users ORDER BY username ASC').all();

      const usersList = allUsers.map(u => {
        // Kiểm tra xem giữa mình (me) và user này (u.username) có bất kỳ quan hệ chặn nào không
        const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(me, u.username, u.username, me);

        return {
          username: u.username,
          avatar: u.avatar,
          // Nếu dính block thì ép cứng thành offline (false), nếu không dính thì check map online thực tế
          online: hasBlock ? false : onlineUsers.has(u.username)
        };
      });

      return sendJSON(res, 200, usersList);
    } catch (err) {
      return sendJSON(res, 500, { error: 'Không thể lấy danh sách user' });
    }
  }

  // Đồng bộ API Profile khớp với endpoint gọi từ Client
  if (pathname.startsWith('/api/profile/') && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    // THÊM decodeURIComponent VÀO ĐÂY:
    const rawUsername = pathname.split('/').pop();
    if (!rawUsername) return sendJSON(res, 400, { error: 'Missing username' });
    const username = decodeURIComponent(rawUsername);

    const user = db.prepare(`
    SELECT username, avatar, bio, last_seen, created_at 
    FROM users WHERE username = ?
  `).get(username);

    if (!user) return sendJSON(res, 404, { error: 'User not found' });

    // Thuật toán tính toán chuỗi hiển thị thời gian hoạt động động
    const lastSeen = new Date(user.last_seen);
    const now = new Date();
    const diffMinutes = Math.floor((now - lastSeen) / 60000);
    let lastSeenText = '';

    if (onlineUsers.has(username)) lastSeenText = 'Đang hoạt động';
    else if (diffMinutes < 1) lastSeenText = 'Vừa hoạt động';
    else if (diffMinutes < 60) lastSeenText = `${diffMinutes} phút trước`;
    else if (diffMinutes < 1440) lastSeenText = `${Math.floor(diffMinutes / 60)} giờ trước`;
    else lastSeenText = `${new Date(user.last_seen).toLocaleDateString('vi-VN')}`;

    return sendJSON(res, 200, { ...user, lastSeenText });
  }

  // PUT /api/profile - Cập nhật avatar + bio tiểu sử cá nhân
  if (pathname === '/api/profile' && req.method === 'PUT') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const { avatar, bio } = await getPostBody(req);
      updateLastSeen(payload.username);

      if (avatar !== undefined) {
        db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run(avatar, payload.username);
      }
      if (bio !== undefined) {
        const cleanBio = bio.trim().slice(0, 100);
        db.prepare('UPDATE users SET bio = ? WHERE username = ?').run(cleanBio, payload.username);
      }
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi hệ thống khi cập nhật profile' });
    }
  }

  // =========================================================================
  // API VERSION 5: FRIENDS & BLOCKS CONTROLLER (HTTP PURE NODE.JS)
  // =========================================================================

  // 1. POST /api/friends/request — Gửi lời mời kết bạn hoặc chấp nhận chéo
  if (pathname === '/api/friends/request' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const { receiver } = await getPostBody(req);
      const sender = payload.username;

      if (!receiver || sender === receiver) return sendJSON(res, 400, { error: 'Dữ liệu không hợp lệ' });

      const isBlocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(sender, receiver, receiver, sender);
      if (isBlocked) return sendJSON(res, 403, { error: 'NODE_BLOCKED: Giao tiếp bị chặn' });

      const u1 = sender < receiver ? sender : receiver;
      const u2 = sender < receiver ? receiver : sender;

      const existing = db.prepare('SELECT * FROM friends WHERE user_one = ? AND user_two = ?').get(u1, u2);

      if (!existing) {
        db.prepare('INSERT INTO friends (user_one, user_two, status) VALUES (?, ?, "pending")').run(u1, u2);
        broadcastToUser(receiver, { type: 'friend_request', from: sender });
        return sendJSON(res, 200, { status: 'pending', message: 'Đã gửi yêu cầu kết nối Node' });
      } else if (existing.status === 'pending') {
        const originalSender = (existing.user_one === u1 && !db.prepare('SELECT 1 FROM friends WHERE user_one=? AND status="pending"').get(sender)) ? u2 : u1;
        if (originalSender !== sender) {
          db.prepare('UPDATE friends SET status = "accepted" WHERE user_one = ? AND user_two = ?').run(u1, u2);
          broadcastToUser(receiver, { type: 'friend_accepted', from: sender });
          return sendJSON(res, 200, { status: 'accepted', message: 'Đã thiết lập liên kết bạn bè thành công' });
        }
        return sendJSON(res, 200, { status: 'pending', message: 'Yêu cầu đang trong trạng thái chờ xử lý' });
      } else {
        return sendJSON(res, 200, { status: 'accepted', message: 'Hai Node đã liên kết từ trước' });
      }
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // 2. GET /api/friends/status/:username — Lấy trạng thái quan hệ
  if (pathname.startsWith('/api/friends/status/') && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    const target = decodeURIComponent(pathname.split('/').pop());
    const me = payload.username;

    const isBlockedMe = db.prepare('SELECT 1 FROM blocks WHERE blocker=? AND blocked=?').get(me, target);
    if (isBlockedMe) return sendJSON(res, 200, { relation: 'blocking' });

    const isBlockedByTarget = db.prepare('SELECT 1 FROM blocks WHERE blocker=? AND blocked=?').get(target, me);
    if (isBlockedByTarget) return sendJSON(res, 200, { relation: 'blocked_by' });

    const u1 = me < target ? me : target;
    const u2 = me < target ? target : me;
    const row = db.prepare('SELECT * FROM friends WHERE user_one = ? AND user_two = ?').get(u1, u2);

    if (!row) return sendJSON(res, 200, { relation: 'none' });
    if (row.status === 'accepted') return sendJSON(res, 200, { relation: 'friends' });

    return sendJSON(res, 200, { relation: 'pending', sender: row.user_one === me ? 'me' : 'them' });
  }

  // 3. DELETE /api/friends/cancel — Từ chối hoặc hủy kết bạn
  if (pathname === '/api/friends/cancel' && req.method === 'DELETE') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const { target } = await getPostBody(req);
      const me = payload.username;
      const u1 = me < target ? me : target;
      const u2 = me < target ? target : me;

      db.prepare('DELETE FROM friends WHERE user_one = ? AND user_two = ?').run(u1, u2);
      return sendJSON(res, 200, { success: true, message: 'Đã hủy kết nối mạng lưới' });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi xử lý hệ thống' });
    }
  }

  // 4. POST /api/block — Chặn người dùng
  if (pathname === '/api/block' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const { target } = await getPostBody(req);
      const blocker = payload.username;

      if (!target || blocker === target) return sendJSON(res, 400, { error: 'Thao tác không hợp lệ' });

      db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked) VALUES (?, ?)').run(blocker, target);
      const u1 = blocker < target ? blocker : target;
      const u2 = blocker < target ? target : blocker;
      db.prepare('DELETE FROM friends WHERE user_one = ? AND user_two = ?').run(u1, u2);

      return sendJSON(res, 200, { success: true, message: 'Đã chặn liên lạc hoàn toàn với Node này' });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi hệ thống khi block' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res);
  sendJSON(res, 404, { error: 'Không tìm thấy' });
});

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const wss = new ws.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    const decoded = jwt.verify(token, JWT_SECRET);
    wss.handleUpgrade(request, socket, head, (wsConn) => {
      wss.emit('connection', wsConn, request, decoded.username);
    });
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

function broadcastStatusChange(username, online) {
  const payload = JSON.stringify({ type: 'status_change', username, online });
  for (const connections of onlineUsers.values())
    connections.forEach(c => c.readyState === ws.OPEN && c.send(payload));
}

function broadcastSystemMessage(text) {
  const payload = JSON.stringify({ type: 'system', text, timestamp: new Date().toISOString() });
  for (const connections of onlineUsers.values())
    connections.forEach(c => c.readyState === ws.OPEN && c.send(payload));
}

wss.on('connection', (wsConn, request, username) => {
  console.log(`[WS] ${username} connected`);
  updateLastSeen(username);

  let isAlive = true;
  wsConn.on('pong', () => { isAlive = true; updateLastSeen(username); });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.log(`[WS] ${username} heartbeat timeout, terminating`);
      return wsConn.terminate();
    }
    isAlive = false;
    wsConn.ping();
  }, 30000);

  if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
  onlineUsers.get(username).add(wsConn);

  if (onlineUsers.get(username).size === 1) {
    broadcastStatusChange(username, true);
    broadcastSystemMessage(`${username} đã đăng nhập vào mạng lưới.`);

    const unreadMessages = db.prepare(`
      SELECT DISTINCT sender FROM messages 
      WHERE receiver = ? AND read_at IS NULL
    `).all(username);

    unreadMessages.forEach(msg => {
      if (onlineUsers.has(msg.sender)) {
        const readReceipt = { type: 'read_receipt', reader: username, with: msg.sender };
        onlineUsers.get(msg.sender).forEach(c => {
          if (c.readyState === ws.OPEN) c.send(JSON.stringify(readReceipt));
        });
      }
    });
  }

  wsConn.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      updateLastSeen(username); // Ghi nhận hành vi tương tác liên tục

      if (data.type === 'typing') {
        const { to, isTyping } = data;
        if (!to) return;
        const typingMsg = { type: 'typing', sender: username, isTyping };
        if (onlineUsers.has(to)) {
          onlineUsers.get(to).forEach(c => {
            if (c.readyState === ws.OPEN) c.send(JSON.stringify(typingMsg));
          });
        }
        return;
      }

      if (data.type === 'get_history') {
        const { with: withUser } = data;
        if (!withUser) return;

        // KIỂM TRA BLOCK TRƯỚC KHI ĐÁNH DẤU ĐÃ ĐỌC
        const anyBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(username, withUser, withUser, username);

        if (!anyBlock) {
          // Chỉ khi KHÔNG CÓ AI CHẶN AI thì mới cho phép mark Đã đọc và bắn read_receipt đi
          markMessagesRead(withUser, username);
          if (onlineUsers.has(withUser)) {
            const readReceipt = { type: 'read_receipt', reader: username, with: withUser };
            onlineUsers.get(withUser).forEach(c => {
              if (c.readyState === 1) c.send(JSON.stringify(readReceipt));
            });
          }
        }
        const history = db.prepare(` 
          SELECT 
            m.id, m.sender, m.receiver, m.text, m.timestamp, m.delivered, m.read_at,
            COALESCE((
              SELECT json_group_object(emoji, total_count) 
              FROM (SELECT emoji, SUM(count) as total_count FROM reactions WHERE message_id = m.id GROUP BY emoji)
            ), '{}') as reactions,
            COALESCE((
              SELECT json_group_object(emoji, max_ts) 
              FROM (SELECT emoji, MAX(strftime('%s', created_at)) as max_ts FROM reactions WHERE message_id = m.id GROUP BY emoji)
            ), '{}') as reaction_timestamps
          FROM messages m
          WHERE (m.sender = ? AND m.receiver = ?) OR (m.sender = ? AND m.receiver = ?)
          ORDER BY m.timestamp ASC
        `).all(username, withUser, withUser, username);
        wsConn.send(JSON.stringify({ type: 'history', with: withUser, messages: history }));
        return;
      }

      if (data.type === 'add_reaction') {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;
        try {
          const existing = db.prepare(`
            SELECT id FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?
          `).get(messageId, username, emoji);

          if (existing) {
            db.prepare(`
              UPDATE reactions SET count = count + 1, created_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(existing.id);
          } else {
            db.prepare(`
              INSERT INTO reactions (message_id, username, emoji, count) VALUES (?, ?, ?, 1)
            `).run(messageId, username, emoji);
          }

          const message = db.prepare('SELECT sender, receiver FROM messages WHERE id = ?').get(messageId);
          if (message) {
            const allReactions = db.prepare(`
              SELECT emoji, SUM(count) as total_count, MAX(strftime('%s', created_at)) as max_ts 
              FROM reactions 
              WHERE message_id = ? 
              GROUP BY emoji
            `).all(messageId);

            const reactionMap = {};
            const reactionTimestamps = {};

            for (const r of allReactions) {
              reactionMap[r.emoji] = Number(r.total_count);
              reactionTimestamps[r.emoji] = parseInt(r.max_ts);
            }

            const reactionMsg = {
              type: 'reaction_update',
              messageId: messageId,
              reactions: reactionMap,
              reactionTimestamps: reactionTimestamps
            };
            const payload = JSON.stringify(reactionMsg);
            if (onlineUsers.has(message.sender)) {
              onlineUsers.get(message.sender).forEach(c => { if (c.readyState === ws.OPEN) c.send(payload); });
            }
            if (onlineUsers.has(message.receiver)) {
              onlineUsers.get(message.receiver).forEach(c => { if (c.readyState === ws.OPEN) c.send(payload); });
            }
          }
        } catch (err) {
          console.error('Reaction error:', err.message);
        }
        return;
      }

      // =========================================================================
      // THAY THẾ TOÀN BỘ BLOCK: if (data.type === 'send_message') TRONG server.js
      // =========================================================================
      if (data.type === 'send_message') {
        const { to, text } = data;
        if (!to || !text?.trim()) return;
        const cleanText = text.trim();

        // 1. Kiểm tra xem MÌNH (username) có đang CHẶN đối phương (to) hay không
        const amIBlocking = db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get(username, to);
        if (amIBlocking) {
          // Khóa mõm ngay lập tức tại Front-End/Back-End, không cho người chặn gửi bậy
          const sysMsg = { type: 'system', text: `THAO TÁC BỊ TỪ CHỐI: Bạn phải bỏ chặn ${to.toUpperCase()} trước khi gửi tin nhắn.` };
          return wsConn.send(JSON.stringify(sysMsg));
        }

        // 2. Kiểm tra xem ĐỐI PHƯƠNG (to) có đang CHẶN mình (username) hay không
        const amIBlockedByThem = db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get(to, username);
        if (amIBlockedByThem) {
          // Người bị chặn gửi tin: Server NUỐT TIN (không lưu DB), gửi cảnh báo hệ thống cục bộ về máy người gửi
          const localSysMsg = {
            type: 'system',
            text: `[ SYSTEM // ACCESS_DENIED: Bạn đã bị ${to.toUpperCase()} chặn kết nối ]`,
            timestamp: new Date().toISOString()
          };
          return wsConn.send(JSON.stringify(localSysMsg));
        }

        // --- NẾU KHÔNG BỊ CHẶN -> CHẠY LOGIC GỬI TIN TIÊU CHUẨN ---
        const isReceiverOnline = onlineUsers.has(to);
        const deliveredValue = isReceiverOnline ? 1 : 0;

        const info = db.prepare(`
          INSERT INTO messages (sender, receiver, text, delivered) 
          VALUES (?, ?, ?, ?)
        `).run(username, to, cleanText, deliveredValue);

        const chatMsg = {
          type: 'message',
          id: Number(info.lastInsertRowid),
          sender: username,
          receiver: to,
          text: cleanText,
          timestamp: new Date().toISOString(),
          delivered: deliveredValue,
          read_at: null
        };
        const payload = JSON.stringify(chatMsg);

        if (isReceiverOnline) {
          onlineUsers.get(to).forEach(c => {
            if (c.readyState === 1) c.send(payload);
          });
        }

        if (onlineUsers.has(username)) {
          onlineUsers.get(username).forEach(c => {
            if (c !== wsConn && c.readyState === 1) {
              c.send(JSON.stringify({ ...chatMsg, self: true }));
            }
          });
        }

        wsConn.send(JSON.stringify({ ...chatMsg, self: true }));

        if (isReceiverOnline && onlineUsers.has(username)) {
          const deliveredReceipt = { type: 'delivered_receipt', messageId: chatMsg.id, to: username, from: to };
          onlineUsers.get(username).forEach(c => {
            if (c.readyState === 1) c.send(JSON.stringify(deliveredReceipt));
          });
        }
        return;
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  wsConn.on('close', () => {
    console.log(`[WS] ${username} disconnected`);
    db.prepare(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = ?`).run(username);
    clearInterval(pingInterval);
    const conns = onlineUsers.get(username);
    if (conns) {
      conns.delete(wsConn);
      if (conns.size === 0) {
        onlineUsers.delete(username);
        broadcastStatusChange(username, false);
        broadcastSystemMessage(`${username} đã ngắt kết nối.`);
      }
    }
  });

  wsConn.on('error', (err) => console.error(`[WS Error] ${username}:`, err.message));
});


// 5. Hàm tiện ích để gửi thông điệp đến một user cụ thể (dùng trong block/friend request)
function broadcastToUser(targetUsername, payload) {
  if (onlineUsers.has(targetUsername)) {
    const stringData = JSON.stringify(payload);
    onlineUsers.get(targetUsername).forEach(client => {
      if (client.readyState === 1) { // 1 nghĩa là đang OPEN
        client.send(stringData);
      }
    });
  }
}
// ==========================================
// START
// ==========================================
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🤖 CYBERPUNK CHAT SERVER RUNNING WITH VERSION 4`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`====================================================`);
});