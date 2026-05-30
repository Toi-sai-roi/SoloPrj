// ==========================================
// app.js — App controller chính
// Global state, screen routing, init
// ==========================================

// State toàn cục - dùng chung cho tất cả modules
const AppState = {
  token: localStorage.getItem('cyber_token'),
  currentUser: localStorage.getItem('cyber_username'),
  usersData: [],
  activeChatPartner: null,
  ws: null
};

// Khởi động app khi DOM sẵn sàng
window.addEventListener('DOMContentLoaded', () => {
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