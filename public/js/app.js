// ==========================================
// public/js/app.js — Global state, screen routing, init
// ==========================================

// State toàn cục - dùng chung cho tất cả modules
const AppState = {
  token: localStorage.getItem('cyber_token'),
  currentUser: localStorage.getItem('cyber_username'),
  usersData: [],
  groupsData: [],
  activeChatPartner: null,
  activeGroup: null,
  activeGroupData: null,
  ws: null
};

// === AUTO LOGOUT KHI AUTH FAIL ===
function handleAuthError() {
  localStorage.removeItem('cyber_token');
  localStorage.removeItem('cyber_username');
  AppState.token = null;
  AppState.currentUser = null;
  if (AppState.ws) {
    AppState.ws.close();
    AppState.ws = null;
  }
  alert('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
  location.reload();
}

// Global fetch interceptor — tự động logout khi API trả 401/403
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const res = await originalFetch.apply(this, args);

  if ((res.status === 401 || res.status === 403) && !res.url.includes('/api/login') && !res.url.includes('/api/register')) {
    handleAuthError();
  }

  return res;
};

// Theme toggle
function initTheme() {
  const savedTheme = localStorage.getItem('cyber_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '☀️';
  }
}

function toggleTheme() {
  const btn = document.getElementById('theme-toggle-btn');
  const profileBtn = document.getElementById('profile-theme-toggle-btn');
  if (document.body.classList.contains('light-theme')) {
    document.body.classList.remove('light-theme');
    localStorage.setItem('cyber_theme', 'dark');
    if (btn) btn.textContent = '🌙';
    if (profileBtn) profileBtn.textContent = '☀️ LIGHT MODE';
  } else {
    document.body.classList.add('light-theme');
    localStorage.setItem('cyber_theme', 'light');
    if (btn) btn.textContent = '☀️';
    if (profileBtn) profileBtn.textContent = '🌙 DARK MODE';
  }
  if (typeof closeProfileModal === 'function') closeProfileModal();
}

// Khởi động app khi DOM sẵn sàng
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (AppState.token && AppState.currentUser) {
    const userDisplay = document.getElementById('current-user-display');

    // Gán text hiển thị
    userDisplay.textContent = `USER // ${AppState.currentUser.toUpperCase()}`;

    // THÊM DÒNG NÀY: Biến nút thành pointer và bắt sự kiện click mở profile
    userDisplay.style.cursor = 'pointer';
    userDisplay.addEventListener('click', () => {
      // Ép hẳn về toLowerCase() trước khi truyền vào để bảo đảm an toàn tuyệt đối
      const safeUsername = AppState.currentUser.toLowerCase();
      openProfile(safeUsername);
    });

    showScreen('home-screen');
    loadUsers();
    initWebSocket();
  } else {
    showScreen('auth-screen');
  }
});

// Chuyển màn hình với fade transition
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(scr => {
    scr.classList.remove('active');
    scr.style.display = 'none';
  });
  const activeScr = document.getElementById(screenId);
  activeScr.style.display = 'flex';
  setTimeout(() => activeScr.classList.add('active'), 50);
}