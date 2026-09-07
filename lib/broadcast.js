// ==========================================
// lib/broadcast.js — Centralized broadcast functions
// Tách ra để tránh circular require giữa server.js và routes/*
// ==========================================

const ws = require('ws');

// onlineUsers Map được inject từ server.js khi khởi động
let _onlineUsers = null;

function init(onlineUsersMap) {
  _onlineUsers = onlineUsersMap;
}

function broadcastToUser(targetUsername, payload) {
  if (!_onlineUsers || !_onlineUsers.has(targetUsername)) return;
  const stringData = JSON.stringify(payload);
  _onlineUsers.get(targetUsername).forEach(client => {
    if (client.readyState === ws.OPEN) {
      client.send(stringData);
    }
  });
}

function broadcastStatusChange(username, online) {
  if (!_onlineUsers) return;
  const payload = JSON.stringify({ type: 'status_change', username, online });
  for (const connections of _onlineUsers.values()) {
    connections.forEach(c => {
      if (c.readyState === ws.OPEN) c.send(payload);
    });
  }
}

function broadcastStatusChangeToPair(userA, userB) {
  if (!_onlineUsers) return;
  const isAOnline = _onlineUsers.has(userA);
  const isBOnline = _onlineUsers.has(userB);

  if (isAOnline) {
    const msgToA = JSON.stringify({ type: 'status_change', username: userB, online: isBOnline });
    _onlineUsers.get(userA).forEach(c => {
      if (c.readyState === ws.OPEN) c.send(msgToA);
    });
  }

  if (isBOnline) {
    const msgToB = JSON.stringify({ type: 'status_change', username: userA, online: isAOnline });
    _onlineUsers.get(userB).forEach(c => {
      if (c.readyState === ws.OPEN) c.send(msgToB);
    });
  }
}

function broadcastSystemMessage(text) {
  if (!_onlineUsers) return;
  const payload = JSON.stringify({ type: 'system', text, timestamp: new Date().toISOString() });
  for (const connections of _onlineUsers.values()) {
    connections.forEach(c => {
      if (c.readyState === ws.OPEN) c.send(payload);
    });
  }
}

module.exports = {
  init,
  broadcastToUser,
  broadcastStatusChange,
  broadcastStatusChangeToPair,
  broadcastSystemMessage
};
