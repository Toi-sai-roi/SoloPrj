const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const ws      = require('ws');
const jwt     = require('jsonwebtoken');
const Database = require('better-sqlite3'); // FIX #1: đã đổi từ node:sqlite sang better-sqlite3

// ==========================================
// CONFIG
// ==========================================
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cyberpunk-neon-glow-secret-2026';
const DB_PATH    = path.join(__dirname, 'chat.db');

// ==========================================
// DATABASE
// ==========================================
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE(message_id, username)
  );
`);

console.log('✅ SQLite database:', DB_PATH);

// ==========================================
// DATABASE HELPER FUNCTIONS (thêm vào đây)
// ==========================================
// FIX #2: Xóa bỏ markMessagesDelivered - không cần dùng nữa
function markMessagesRead(sender, receiver) {
  db.prepare(`UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender = ? AND receiver = ? AND read_at IS NULL`).run(sender, receiver);
}

// ==========================================
// ONLINE USERS MAP
// key: username, value: Set<WebSocket>
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
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function serveStatic(req, res) {
  // Default sang index.html cho mọi route không phải file
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback về index.html nếu file không tồn tại (SPA routing)
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

  // CORS headers (optional, hữu ích khi dev local)
  res.setHeader('Access-Control-Allow-Origin', '*');

  // --- API ROUTES ---

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
      const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '7d' });
      return sendJSON(res, 200, { success: true, token, username: clean });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // GET /api/users
  if (pathname === '/api/users' && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const allUsers = db.prepare('SELECT username FROM users ORDER BY username ASC').all();
      const usersList = allUsers.map(u => ({ username: u.username, online: onlineUsers.has(u.username) }));
      return sendJSON(res, 200, usersList);
    } catch (err) {
      return sendJSON(res, 500, { error: 'Không thể lấy danh sách user' });
    }
  }

  // Serve static files (HTML, CSS, JS, assets)
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

// Broadcast helpers
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

// Connection handler
wss.on('connection', (wsConn, request, username) => {
  console.log(`[WS] ${username} connected`);

  // === FIX #4: HEARTBEAT (PING/PONG) ===
  let isAlive = true;
  wsConn.on('pong', () => { isAlive = true; });
  
  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.log(`[WS] ${username} heartbeat timeout, terminating`);
      clearInterval(pingInterval);
      return wsConn.terminate();
    }
    isAlive = false;
    wsConn.ping();
  }, 30000);

  if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
  onlineUsers.get(username).add(wsConn);

  // Gửi pending read receipts khi user online
  if (onlineUsers.get(username).size === 1) {
    broadcastStatusChange(username, true);
    broadcastSystemMessage(`${username} đã đăng nhập vào mạng lưới.`);

    // Gửi read receipts cho tất cả tin nhắn chưa đọc
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

      // === TYPING INDICATOR ===
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

      // === GET HISTORY ===
      if (data.type === 'get_history') {
        const { with: withUser } = data;
        if (!withUser) return;
        markMessagesRead(withUser, username);
        if (onlineUsers.has(withUser)) {
          const readReceipt = { type: 'read_receipt', reader: username, with: withUser };
          onlineUsers.get(withUser).forEach(c => {
            if (c.readyState === ws.OPEN) c.send(JSON.stringify(readReceipt));
          });
        }
        // FIX #3: Dùng COALESCE để tránh lỗi JSON null
        const history = db.prepare(`
          SELECT 
            m.id, m.sender, m.receiver, m.text, m.timestamp, m.delivered, m.read_at,
            COALESCE((SELECT json_group_object(username, emoji) FROM reactions WHERE message_id = m.id), '{}') as reactions,
            COALESCE((SELECT json_group_object(username, strftime('%s', created_at)) FROM reactions WHERE message_id = m.id), '{}') as reaction_timestamps
          FROM messages m
          WHERE (m.sender = ? AND m.receiver = ?) OR (m.sender = ? AND m.receiver = ?)
          ORDER BY m.timestamp ASC
        `).all(username, withUser, withUser, username);
        wsConn.send(JSON.stringify({ type: 'history', with: withUser, messages: history }));
        return;
      }

      // === ADD REACTION ===
      if (data.type === 'add_reaction') {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;
        try {
          db.prepare(`
            INSERT INTO reactions (message_id, username, emoji) 
            VALUES (?, ?, ?)
            ON CONFLICT(message_id, username) DO UPDATE SET emoji = excluded.emoji, created_at = CURRENT_TIMESTAMP
          `).run(messageId, username, emoji);
          
          const message = db.prepare('SELECT sender, receiver FROM messages WHERE id = ?').get(messageId);
          if (message) {
            const allReactions = db.prepare(`
              SELECT username, emoji, strftime('%s', created_at) as ts FROM reactions WHERE message_id = ?
            `).all(messageId);
            const reactionMap = {};
            const reactionTimestamps = {};
            for (const r of allReactions) {
              reactionMap[r.username] = r.emoji;
              reactionTimestamps[r.username] = parseInt(r.ts);
            }
            const reactionMsg = {
              type: 'reaction_update',
              messageId: messageId,
              reactions: reactionMap,
              reactionTimestamps: reactionTimestamps
            };
            const payload = JSON.stringify(reactionMsg);
            if (onlineUsers.has(message.sender)) {
              onlineUsers.get(message.sender).forEach(c => {
                if (c.readyState === ws.OPEN) c.send(payload);
              });
            }
            if (onlineUsers.has(message.receiver)) {
              onlineUsers.get(message.receiver).forEach(c => {
                if (c.readyState === ws.OPEN) c.send(payload);
              });
            }
          }
        } catch (err) {
          console.error('Reaction error:', err.message);
        }
        return;
      }

      // === SEND MESSAGE ===
      if (data.type === 'send_message') {
        const { to, text } = data;
        if (!to || !text?.trim()) return;
        const cleanText = text.trim();
        
        // FIX #2: Kiểm tra online TRƯỚC khi INSERT, gán delivered đúng ngay từ đầu
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
        
        // Gửi đến người nhận (nếu online)
        if (isReceiverOnline) {
          onlineUsers.get(to).forEach(c => {
            if (c.readyState === ws.OPEN) c.send(payload);
          });
        }
        
        // Đồng bộ tab khác của người gửi
        if (onlineUsers.has(username)) {
          onlineUsers.get(username).forEach(c => {
            if (c !== wsConn && c.readyState === ws.OPEN) {
              c.send(JSON.stringify({ ...chatMsg, self: true }));
            }
          });
        }
        
        // Phản hồi tab hiện tại
        wsConn.send(JSON.stringify({ ...chatMsg, self: true }));
        
        // Gửi delivered receipt nếu receiver online (chỉ để báo UI)
        if (isReceiverOnline && onlineUsers.has(username)) {
          const deliveredReceipt = { type: 'delivered_receipt', messageId: chatMsg.id, to: username, from: to };
          onlineUsers.get(username).forEach(c => {
            if (c.readyState === ws.OPEN) c.send(JSON.stringify(deliveredReceipt));
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
    clearInterval(pingInterval); // Dọn dẹp interval heartbeat
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

// ==========================================
// START
// ==========================================
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🤖 CYBERPUNK CHAT SERVER RUNNING`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`====================================================`);
});