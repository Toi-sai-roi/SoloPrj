// ==========================================
// utils.js — Helper functions dùng chung
// ==========================================

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

function formatTime(isoStr) {
  const date = new Date(isoStr);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function scrollToBottom() {
  const messagesArea = document.getElementById('messages-area');
  if (messagesArea) messagesArea.scrollTop = messagesArea.scrollHeight;
}