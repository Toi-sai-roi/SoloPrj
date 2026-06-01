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
// DATABASE
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
  
  CREATE TABLE IF NOT EXISTS blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker     TEXT NOT NULL,
    blocked     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blocker) REFERENCES users(username),
    FOREIGN KEY (blocked) REFERENCES users(username),
    UNIQUE(blocker, blocked)
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
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one   TEXT NOT NULL,
    user_two   TEXT NOT NULL,
    status     TEXT DEFAULT 'pending', -- 'pending' hoặc 'accepted'
    sender     TEXT NOT NULL,          -- Lưu ai là người bấm nút gửi trước
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_one) REFERENCES users(username),
    FOREIGN KEY (user_two) REFERENCES users(username),
    UNIQUE(user_one, user_two)       
  );

  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    avatar      TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_by  TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id    INTEGER NOT NULL,
    username    TEXT NOT NULL,
    role        TEXT DEFAULT 'member',
    joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    PRIMARY KEY (group_id, username)
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL,
    sender      TEXT NOT NULL,
    text        TEXT NOT NULL,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (sender) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS group_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    username   TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE(message_id, username)
  );
`);

console.log('✅ SQLite database initialized:', DB_PATH);

// ==========================================
// DATABASE HELPER FUNCTIONS
// ==========================================
function markMessagesRead(sender, receiver) {
  db.prepare(`UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender = ? AND receiver = ? AND read_at IS NULL`).run(sender, receiver);
}

function updateLastSeen(username) {
  db.prepare(`UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = ?`).run(username);
}

const onlineUsers = new Map();

function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

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
// HTTP SERVER ROUTER
// ==========================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');

  // =========================================================================
  // [V5 ĐẶT LÊN ĐẦU]: POST /api/users/friend-action - XỬ LÝ MẠNG LƯỚI KẾT BẠN
  // =========================================================================
  if (pathname === '/api/users/friend-action' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const me = payload.username;
      const { targetUser, action } = await getPostBody(req);

      if (!targetUser || me === targetUser) {
        return sendJSON(res, 400, { error: 'Yêu cầu không hợp lệ' });
      }

      const u1 = me < targetUser ? me : targetUser;
      const u2 = me < targetUser ? targetUser : me;

      updateLastSeen(me);

      if (action === 'add') {
        db.prepare(`
          INSERT INTO friends (user_one, user_two, status, sender)
          VALUES (?, ?, 'pending', ?)
          ON CONFLICT(user_one, user_two) DO UPDATE SET status='pending', sender=?
        `).run(u1, u2, me, me);

        sendNetworkWS(targetUser, { type: 'network_update', sender: me, action: 'add' });
        return sendJSON(res, 200, { success: true, data: { relation: 'pending_sent' } });
      }

      if (action === 'accept') {
        db.prepare(`
          UPDATE friends SET status = 'accepted' WHERE user_one = ? AND user_two = ?
        `).run(u1, u2);

        sendNetworkWS(targetUser, { type: 'network_update', sender: me, action: 'accept' });
        return sendJSON(res, 200, { success: true, data: { relation: 'friend' } });
      }

      if (action === 'cancel') {
        db.prepare(`
          DELETE FROM friends WHERE user_one = ? AND user_two = ?
        `).run(u1, u2);

        sendNetworkWS(targetUser, { type: 'network_update', sender: me, action: 'cancel' });
        return sendJSON(res, 200, { success: true, data: { relation: 'none' } });
      }

      return sendJSON(res, 400, { error: 'Hành động mạng lưới không hợp lệ' });
    } catch (err) {
      console.error('❌ Lỗi xử lý Router API friend-action:', err.message);
      return sendJSON(res, 500, { error: 'Lỗi máy chủ hệ thống mạng lưới' });
    }
  }

  // POST /api/register
  if (pathname === '/api/register' && req.method === 'POST') {
    try {
      const { username, password } = await getPostBody(req);
      if (!username || !password) return sendJSON(res, 400, { error: 'Username và password không được để trống' });
      const clean = username.trim().toLowerCase();
      if (clean.length < 2 || clean.length > 30) return sendJSON(res, 400, { error: 'Username phải từ 2 đến 30 ký tự' });
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

      updateLastSeen(clean);
      const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '7d' });
      return sendJSON(res, 200, { success: true, token, username: clean });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // Lấy danh sách users - Kèm mối quan hệ kết bạn và Ép Offline nếu bị block
  if (pathname === '/api/users' && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    try {
      const me = payload.username;
      const allUsers = db.prepare('SELECT username, avatar FROM users WHERE username != ? ORDER BY username ASC').all(me);

      const usersList = allUsers.map(u => {
        const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([me, u.username, u.username, me]);
        
        const u1 = me < u.username ? me : u.username;
        const u2 = me < u.username ? u.username : me;
        const friendship = db.prepare('SELECT status, sender FROM friends WHERE user_one = ? AND user_two = ?').get(u1, u2);
        
        let relation = 'none';
        if (friendship) {
          if (friendship.status === 'accepted') {
            relation = 'friend';
          } else if (friendship.status === 'pending') {
            if (friendship.sender === me) {
              relation = 'pending_sent';
            } else {
              relation = 'pending_received';
            }
          }
        }

        return {
          username: u.username,
          avatar: u.avatar,
          online: hasBlock ? false : onlineUsers.has(u.username),
          relation: relation
        };
      });

      return sendJSON(res, 200, usersList);
    } catch (err) {
      console.error('❌ Lỗi hệ thống tại API /api/users:', err.message);
      return sendJSON(res, 500, { error: 'Không thể tải cấu trúc mạng lưới người dùng' });
    }
  }

  // Profile Endpoint - Ép trạng thái ngoại tuyến động nếu dính block
  if (pathname.startsWith('/api/profile/') && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });

    const me = payload.username;
    const target = decodeURIComponent(pathname.split('/').pop());
    if (!target) return sendJSON(res, 400, { error: 'Missing username' });

    const user = db.prepare(`SELECT username, avatar, bio, last_seen, created_at FROM users WHERE username = ?`).get(target);
    if (!user) return sendJSON(res, 404, { error: 'User not found' });

    const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([me, target, target, me]);

    let lastSeenText = '';
    if (hasBlock) {
      lastSeenText = 'Ngoại tuyến';
    } else {
      const lastSeen = new Date(user.last_seen);
      const now = new Date();
      const diffMinutes = Math.floor((now - lastSeen) / 60000);
      if (onlineUsers.has(target)) lastSeenText = 'Đang hoạt động';
      else if (diffMinutes < 1) lastSeenText = 'Vừa hoạt động';
      else if (diffMinutes < 60) lastSeenText = `${diffMinutes} phút trước`;
      else if (diffMinutes < 1440) lastSeenText = `${Math.floor(diffMinutes / 60)} giờ trước`;
      else lastSeenText = `${new Date(user.last_seen).toLocaleDateString('vi-VN')}`;
    }

    return sendJSON(res, 200, { ...user, lastSeenText, isBlockedReal: !!hasBlock });
  }

  // PUT /api/profile - Cập nhật avatar + bio
  if (pathname === '/api/profile' && req.method === 'PUT') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const { avatar, bio } = await getPostBody(req);
      updateLastSeen(payload.username);
      if (avatar !== undefined) db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run(avatar, payload.username);
      if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE username = ?').run(bio.trim().slice(0, 100), payload.username);
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi hệ thống' });
    }
  }

  // Gửi yêu cầu kết bạn (Endpoint dự phòng cũ)
  if (pathname === '/api/friends/request' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const { receiver } = await getPostBody(req);
      const sender = payload.username;
      if (!receiver || sender === receiver) return sendJSON(res, 400, { error: 'Dữ liệu không hợp lệ' });

      const isBlocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([sender, receiver, receiver, sender]);
      if (isBlocked) return sendJSON(res, 403, { error: 'NODE_BLOCKED: Giao tiếp bị chặn' });

      const u1 = sender < receiver ? sender : receiver;
      const u2 = sender < receiver ? receiver : sender;
      const existing = db.prepare('SELECT * FROM friends WHERE user_one = ? AND user_two = ?').get([u1, u2]);

      if (!existing) {
        db.prepare('INSERT INTO friends (user_one, user_two, status) VALUES (?, ?, "pending")').run(u1, u2);
        broadcastToUser(receiver, { type: 'friend_request', from: sender });
        return sendJSON(res, 200, { status: 'pending', message: 'Đã gửi yêu cầu kết nối Node' });
      } else if (existing.status === 'pending') {
        const hasSentPending = db.prepare('SELECT 1 FROM friends WHERE user_one=? AND status="pending"').get(sender);
        const originalSender = hasSentPending ? u1 : u2;
        if (originalSender !== sender) {
          db.prepare('UPDATE friends SET status = "accepted" WHERE user_one = ? AND user_two = ?').run(u1, u2);
          broadcastToUser(receiver, { type: 'friend_accepted', from: sender });
          return sendJSON(res, 200, { status: 'accepted', message: 'Đã thiết lập liên kết thành công' });
        }
        return sendJSON(res, 200, { status: 'pending', message: 'Yêu cầu đang chờ xử lý' });
      } else {
        return sendJSON(res, 200, { status: 'accepted', message: 'Hai Node đã liên kết từ trước' });
      }
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // Kiểm tra trạng thái quan hệ song phương
  if (pathname.startsWith('/api/friends/status/') && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    const target = decodeURIComponent(pathname.split('/').pop());
    const me = payload.username;

    const isBlockedMe = db.prepare('SELECT 1 FROM blocks WHERE blocker=? AND blocked=?').get([me, target]);
    if (isBlockedMe) return sendJSON(res, 200, { relation: 'blocking' });

    const isBlockedByTarget = db.prepare('SELECT 1 FROM blocks WHERE blocker=? AND blocked=?').get([target, me]);
    if (isBlockedByTarget) return sendJSON(res, 200, { relation: 'blocked_by' });

    const u1 = me < target ? me : target;
    const u2 = me < target ? target : me;
    const row = db.prepare('SELECT * FROM friends WHERE user_one = ? AND user_two = ?').get([u1, u2]);

    if (!row) return sendJSON(res, 200, { relation: 'none' });
    if (row.status === 'accepted') return sendJSON(res, 200, { relation: 'friends' });
    return sendJSON(res, 200, { relation: 'pending', sender: row.user_one === me ? 'me' : 'them' });
  }

  // Hủy kết nối / Từ chối bạn bè
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

  // Khởi chạy hành vi BLOCK chặn người dùng
  if (pathname === '/api/block' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const { target } = await getPostBody(req);
      const blocker = payload.username;
      if (!target || blocker === target) return sendJSON(res, 400, { error: 'Dữ liệu không hợp lệ' });

      db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked) VALUES (?, ?)').run(blocker, target);
      const u1 = blocker < target ? blocker : target;
      const u2 = blocker < target ? target : blocker;
      db.prepare('DELETE FROM friends WHERE user_one = ? AND user_two = ?').run(u1, u2);

      broadcastStatusChangeToPair(blocker, target);
      return sendJSON(res, 200, { success: true, message: `Mạng lưới đã cách ly nút ${target.toUpperCase()}` });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi xử lý block' });
    }
  }

  // API UNBLOCK - Mở khóa chặn
  if (pathname === '/api/unblock' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const { target } = await getPostBody(req);
      const blocker = payload.username;
      if (!target) return sendJSON(res, 400, { error: 'Dữ liệu không hợp lệ' });

      db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').run(blocker, target);
      broadcastStatusChangeToPair(blocker, target);

      return sendJSON(res, 200, { success: true, message: 'Đã mở khóa kết nối mạng lưới thành công' });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ khi mở chặn' });
    }
  }

  // ==========================================
  // GROUP API ENDPOINTS
  // ==========================================

  // POST /api/groups/create - Tạo nhóm mới
  if (pathname === '/api/groups/create' && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const { name, description, avatar, members } = await getPostBody(req);
      if (!name || !name.trim()) return sendJSON(res, 400, { error: 'Tên nhóm không được để trống' });

      updateLastSeen(me);
      const info = db.prepare(`INSERT INTO groups (name, avatar, description, created_by) VALUES (?, ?, ?, ?)`).run(name.trim(), avatar || '', description || '', me);
      const groupId = info.lastInsertRowid;

      // Thêm creator vào group với role admin
      db.prepare(`INSERT INTO group_members (group_id, username, role) VALUES (?, ?, 'admin')`).run(groupId, me);

      // Thêm các members được mời
      const invitedMembers = Array.isArray(members) ? members.filter(u => u !== me) : [];
      for (const username of invitedMembers) {
        const userExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
        if (userExists) {
          db.prepare(`INSERT OR IGNORE INTO group_members (group_id, username, role) VALUES (?, ?, 'member')`).run(groupId, username);
          // Thông báo qua WS
          broadcastToUser(username, { type: 'group_invite', groupId, groupName: name.trim(), invitedBy: me });
        }
      }

      return sendJSON(res, 201, { success: true, groupId, name: name.trim() });
    } catch (err) {
      console.error('❌ Lỗi tạo nhóm:', err.message);
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // GET /api/groups/my - Danh sách nhóm của user
  if (pathname === '/api/groups/my' && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groups = db.prepare(`
        SELECT g.id, g.name, g.avatar, g.description, g.created_by, g.created_at,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
          (SELECT text FROM group_messages WHERE group_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message,
          (SELECT timestamp FROM group_messages WHERE group_id = g.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
          gm.role
        FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id AND gm.username = ?
        ORDER BY last_message_time DESC, g.created_at DESC
      `).all(me);
      return sendJSON(res, 200, groups);
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // GET /api/groups/:id - Chi tiết nhóm
  if (pathname.match(/^\/api\/groups\/\d+$/) && req.method === 'GET') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groupId = parseInt(pathname.split('/').pop());
      const isMember = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND username = ?').get(groupId, me);
      if (!isMember) return sendJSON(res, 403, { error: 'Bạn không phải thành viên nhóm này' });

      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      if (!group) return sendJSON(res, 404, { error: 'Nhóm không tồn tại' });

      const members = db.prepare(`
        SELECT gm.username, gm.role, gm.joined_at, u.avatar
        FROM group_members gm
        LEFT JOIN users u ON gm.username = u.username
        WHERE gm.group_id = ?
        ORDER BY gm.role DESC, gm.joined_at ASC
      `).all(groupId);

      return sendJSON(res, 200, { ...group, members, myRole: isMember.role });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // PUT /api/groups/:id - Cập nhật thông tin nhóm (chỉ admin)
  if (pathname.match(/^\/api\/groups\/\d+$/) && req.method === 'PUT') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groupId = parseInt(pathname.split('/').pop());
      const member = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND username = ?').get(groupId, me);
      if (!member || member.role !== 'admin') return sendJSON(res, 403, { error: 'Chỉ admin mới có thể sửa nhóm' });

      const { name, description, avatar } = await getPostBody(req);
      if (name) db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name.trim(), groupId);
      if (description !== undefined) db.prepare('UPDATE groups SET description = ? WHERE id = ?').run(description, groupId);
      if (avatar !== undefined) db.prepare('UPDATE groups SET avatar = ? WHERE id = ?').run(avatar, groupId);

      // Broadcast update cho toàn bộ thành viên online
      const allMembers = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
      const updatedGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      allMembers.forEach(m => broadcastToUser(m.username, { type: 'group_updated', group: updatedGroup }));

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // POST /api/groups/:id/invite - Mời thành viên
  if (pathname.match(/^\/api\/groups\/\d+\/invite$/) && req.method === 'POST') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groupId = parseInt(pathname.split('/')[3]);
      const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(groupId, me);
      if (!isMember) return sendJSON(res, 403, { error: 'Bạn không phải thành viên nhóm này' });

      const { username } = await getPostBody(req);
      if (!username) return sendJSON(res, 400, { error: 'Thiếu username' });

      const userExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
      if (!userExists) return sendJSON(res, 404, { error: 'User không tồn tại' });

      const alreadyMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(groupId, username);
      if (alreadyMember) return sendJSON(res, 400, { error: 'User đã là thành viên' });

      db.prepare(`INSERT INTO group_members (group_id, username, role) VALUES (?, ?, 'member')`).run(groupId, username);
      const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);
      broadcastToUser(username, { type: 'group_invite', groupId, groupName: group.name, invitedBy: me });

      // Thông báo cho cả nhóm có thành viên mới
      const allMembers = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
      allMembers.forEach(m => {
        if (m.username !== username) broadcastToUser(m.username, { type: 'group_member_joined', groupId, username });
      });

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // DELETE /api/groups/:id/members/:username - Kick thành viên (chỉ admin)
  if (pathname.match(/^\/api\/groups\/\d+\/members\/.+$/) && req.method === 'DELETE') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const parts = pathname.split('/');
      const groupId = parseInt(parts[3]);
      const targetUsername = decodeURIComponent(parts[5]);

      const myRole = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND username = ?').get(groupId, me);
      if (!myRole || myRole.role !== 'admin') return sendJSON(res, 403, { error: 'Chỉ admin mới có thể kick' });
      if (targetUsername === me) return sendJSON(res, 400, { error: 'Không thể kick chính mình' });

      db.prepare('DELETE FROM group_members WHERE group_id = ? AND username = ?').run(groupId, targetUsername);

      // Thông báo bị kick
      broadcastToUser(targetUsername, { type: 'group_kicked', groupId });
      const allMembers = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
      allMembers.forEach(m => broadcastToUser(m.username, { type: 'group_member_left', groupId, username: targetUsername }));

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // DELETE /api/groups/:id/leave - Rời nhóm
  if (pathname.match(/^\/api\/groups\/\d+\/leave$/) && req.method === 'DELETE') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groupId = parseInt(pathname.split('/')[3]);

      const myRole = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND username = ?').get(groupId, me);
      if (!myRole) return sendJSON(res, 400, { error: 'Bạn không trong nhóm này' });

      // Nếu admin và còn người khác → chuyển quyền cho người đầu tiên
      if (myRole.role === 'admin') {
        const nextMember = db.prepare(`SELECT username FROM group_members WHERE group_id = ? AND username != ? LIMIT 1`).get(groupId, me);
        if (nextMember) {
          db.prepare(`UPDATE group_members SET role = 'admin' WHERE group_id = ? AND username = ?`).run(groupId, nextMember.username);
          broadcastToUser(nextMember.username, { type: 'group_promoted', groupId });
        } else {
          // Không còn ai → xóa nhóm luôn
          db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
          return sendJSON(res, 200, { success: true, groupDeleted: true });
        }
      }

      db.prepare('DELETE FROM group_members WHERE group_id = ? AND username = ?').run(groupId, me);
      const allMembers = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
      allMembers.forEach(m => broadcastToUser(m.username, { type: 'group_member_left', groupId, username: me }));

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // DELETE /api/groups/:id - Xóa nhóm (chỉ creator/admin)
  if (pathname.match(/^\/api\/groups\/\d+$/) && req.method === 'DELETE') {
    const payload = authenticateToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const me = payload.username;
      const groupId = parseInt(pathname.split('/').pop());
      const group = db.prepare('SELECT created_by FROM groups WHERE id = ?').get(groupId);
      if (!group) return sendJSON(res, 404, { error: 'Nhóm không tồn tại' });
      if (group.created_by !== me) return sendJSON(res, 403, { error: 'Chỉ người tạo nhóm mới có thể xóa' });

      const allMembers = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
      db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
      allMembers.forEach(m => {
        if (m.username !== me) broadcastToUser(m.username, { type: 'group_deleted', groupId });
      });

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      return sendJSON(res, 500, { error: 'Lỗi máy chủ' });
    }
  }

  // Static file server ở cuối cùng
  if (req.method === 'GET') return serveStatic(req, res);
  sendJSON(res, 404, { error: 'Không tìm thấy' });
});

// ==========================================
// WEBSOCKET SERVER LOGIC
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
  for (const [targetUser, connections] of onlineUsers.entries()) {
    const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([username, targetUser, targetUser, username]);
    const payload = JSON.stringify({ type: 'status_change', username, online: hasBlock ? false : online });
    connections.forEach(c => c.readyState === ws.OPEN && c.send(payload));
  }
}

function broadcastStatusChangeToPair(userA, userB) {
  const isAOnline = onlineUsers.has(userA);
  const isBOnline = onlineUsers.has(userB);
  const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([userA, userB, userB, userA]);

  if (isAOnline) {
    const msgToA = JSON.stringify({ type: 'status_change', username: userB, online: hasBlock ? false : isBOnline });
    onlineUsers.get(userA).forEach(c => c.readyState === ws.OPEN && c.send(msgToA));
  }
  if (isBOnline) {
    const msgToB = JSON.stringify({ type: 'status_change', username: userA, online: hasBlock ? false : isAOnline });
    onlineUsers.get(userB).forEach(c => c.readyState === ws.OPEN && c.send(msgToB));
  }
}

function broadcastSystemMessage(text) {
  const payload = JSON.stringify({ type: 'system', text, timestamp: new Date().toISOString() });
  for (const [targetUser, connections] of onlineUsers.entries()) {
    connections.forEach(c => c.readyState === ws.OPEN && c.send(payload));
  }
}

function broadcastToUser(targetUsername, payload) {
  if (onlineUsers.has(targetUsername)) {
    const stringData = JSON.stringify(payload);
    onlineUsers.get(targetUsername).forEach(client => {
      if (client.readyState === ws.OPEN) client.send(stringData);
    });
  }
}

// Hàm helper chuyển tiếp tín hiệu kết bạn qua WebSocket toàn cục
function sendNetworkWS(targetUsername, payloadObj) {
  if (onlineUsers.has(targetUsername)) {
    const payloadStr = JSON.stringify(payloadObj);
    onlineUsers.get(targetUsername).forEach(c => {
      if (c.readyState === ws.OPEN) {
        c.send(payloadStr);
      }
    });
  }
}

wss.on('connection', (wsConn, request, username) => {
  console.log(`[WS] ${username} connected`);
  updateLastSeen(username);

  let isAlive = true;
  wsConn.on('pong', () => { isAlive = true; updateLastSeen(username); });

  const pingInterval = setInterval(() => {
    if (!isAlive) return wsConn.terminate();
    isAlive = false;
    wsConn.ping();
  }, 30000);

  if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
  onlineUsers.get(username).add(wsConn);

  if (onlineUsers.get(username).size === 1) {
    broadcastStatusChange(username, true);
    broadcastSystemMessage(`${username} đã đăng nhập vào mạng lưới.`);
  }

  wsConn.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      updateLastSeen(username);

      if (data.type === 'typing') {
        const { to, isTyping } = data;
        if (!to) return;
        const hasBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([username, to, to, username]);
        if (hasBlock) return; 

        const typingMsg = { type: 'typing', sender: username, isTyping };
        if (onlineUsers.has(to)) {
          onlineUsers.get(to).forEach(c => { if (c.readyState === ws.OPEN) c.send(JSON.stringify(typingMsg)); });
        }
        return;
      }

      if (data.type === 'get_history') {
        const { with: withUser } = data;
        if (!withUser) return;

        const anyBlock = db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get([username, withUser, withUser, username]);
        if (!anyBlock) {
          markMessagesRead(withUser, username);
          if (onlineUsers.has(withUser)) {
            const readReceipt = { type: 'read_receipt', reader: username, with: withUser };
            onlineUsers.get(withUser).forEach(c => { if (c.readyState === ws.OPEN) c.send(JSON.stringify(readReceipt)); });
          }
        }
        const history = db.prepare(`
          SELECT m.id, m.sender, m.receiver, m.text, m.timestamp, m.delivered, m.read_at,
            COALESCE((SELECT json_group_object(emoji, total_count) FROM (SELECT emoji, SUM(count) as total_count FROM reactions WHERE message_id = m.id GROUP BY emoji)), '{}') as reactions,
            COALESCE((SELECT json_group_object(emoji, max_ts) FROM (SELECT emoji, MAX(strftime('%s', created_at)) as max_ts FROM reactions WHERE message_id = m.id GROUP BY emoji)), '{}') as reaction_timestamps
          FROM messages m WHERE (m.sender = ? AND m.receiver = ?) OR (m.sender = ? AND m.receiver = ?) ORDER BY m.timestamp ASC
        `).all(username, withUser, withUser, username);
        wsConn.send(JSON.stringify({ type: 'history', with: withUser, messages: history }));
        return;
      }

      if (data.type === 'send_message') {
        const { to, text } = data;
        if (!to || !text?.trim()) return;
        const cleanText = text.trim();

        const amIBlocking = db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get([username, to]);
        if (amIBlocking) {
          return wsConn.send(JSON.stringify({ type: 'system', text: `[ SYSTEM // THAO TÁC BỊ TỪ CHỐI: Bạn phải bỏ chặn đối phương để gửi tin nhắn ]` }));
        }

        const amIBlockedByThem = db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get([to, username]);
        if (amIBlockedByThem) {
          return wsConn.send(JSON.stringify({ type: 'system', text: `[ SYSTEM // ACCESS_DENIED: Bạn đã bị ${to.toUpperCase()} chặn kết nối ]` }));
        }

        const isReceiverOnline = onlineUsers.has(to);
        const deliveredValue = isReceiverOnline ? 1 : 0;

        const info = db.prepare(`INSERT INTO messages (sender, receiver, text, delivered) VALUES (?, ?, ?, ?)`).run(username, to, cleanText, deliveredValue);
        const chatMsg = { type: 'message', id: Number(info.lastInsertRowid), sender: username, receiver: to, text: cleanText, timestamp: new Date().toISOString(), delivered: deliveredValue, read_at: null };

        if (isReceiverOnline) {
          onlineUsers.get(to).forEach(c => { if (c.readyState === ws.OPEN) c.send(JSON.stringify(chatMsg)); });
        }
        wsConn.send(JSON.stringify({ ...chatMsg, self: true }));
        return;
      }

      // ==========================================
      // GROUP WEBSOCKET HANDLERS
      // ==========================================

      if (data.type === 'send_group_message') {
        const { groupId, text } = data;
        if (!groupId || !text?.trim()) return;

        const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(groupId, username);
        if (!isMember) return wsConn.send(JSON.stringify({ type: 'system', text: '[ SYSTEM // ACCESS_DENIED: Bạn không phải thành viên nhóm này ]' }));

        const cleanText = text.trim();
        const info = db.prepare(`INSERT INTO group_messages (group_id, sender, text) VALUES (?, ?, ?)`).run(groupId, username, cleanText);
        const msg = {
          type: 'group_message',
          id: Number(info.lastInsertRowid),
          groupId,
          sender: username,
          text: cleanText,
          timestamp: new Date().toISOString()
        };

        // Broadcast tới tất cả thành viên online trong nhóm
        const members = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
        members.forEach(m => {
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

        const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(groupId, username);
        if (!isMember) return;

        const messages = db.prepare(`
          SELECT gm.id, gm.group_id, gm.sender, gm.text, gm.timestamp,
            COALESCE((SELECT json_group_object(gr.username, gr.emoji) FROM group_reactions gr WHERE gr.message_id = gm.id), '{}') as reactions
          FROM group_messages gm
          WHERE gm.group_id = ?
          ORDER BY gm.timestamp ASC
        `).all(groupId);

        wsConn.send(JSON.stringify({ type: 'group_history', groupId, messages }));
        return;
      }

      if (data.type === 'group_typing') {
        const { groupId, isTyping } = data;
        if (!groupId) return;

        const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(groupId, username);
        if (!isMember) return;

        const members = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(groupId);
        members.forEach(m => {
          if (m.username !== username) {
            broadcastToUser(m.username, { type: 'group_typing', groupId, sender: username, isTyping });
          }
        });
        return;
      }

      if (data.type === 'group_reaction') {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;

        const msg = db.prepare('SELECT group_id FROM group_messages WHERE id = ?').get(messageId);
        if (!msg) return;

        const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?').get(msg.group_id, username);
        if (!isMember) return;

        db.prepare(`INSERT INTO group_reactions (message_id, username, emoji) VALUES (?, ?, ?)
          ON CONFLICT(message_id, username) DO UPDATE SET emoji = ?, created_at = CURRENT_TIMESTAMP`).run(messageId, username, emoji, emoji);

        const reactions = db.prepare(`SELECT username, emoji FROM group_reactions WHERE message_id = ?`).all(messageId);
        const reactionMap = {};
        reactions.forEach(r => { reactionMap[r.username] = r.emoji; });

        const members = db.prepare('SELECT username FROM group_members WHERE group_id = ?').all(msg.group_id);
        members.forEach(m => {
          broadcastToUser(m.username, { type: 'group_reaction_update', messageId, groupId: msg.group_id, reactions: reactionMap });
        });
        return;
      }
    } catch (err) {
      console.error('WS error:', err.message);
    }
  });

  wsConn.on('close', () => {
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
});

// ==========================================
// START
// ==========================================
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🤖 CYBERPUNK SERVER RE-ENGINEERED SUCCESSFUL`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`====================================================`);
});