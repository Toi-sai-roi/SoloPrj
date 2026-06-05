// ==========================================
// auth.js — Login / Register / Logout
// ==========================================

let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  const authErrorMsg = document.getElementById('auth-error-msg');
  const authSubmitBtn = document.getElementById('auth-submit-btn');

  authErrorMsg.style.display = 'none';
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  authSubmitBtn.textContent = mode === 'login' ? 'INITIATE CONNECT' : 'REGISTER PROTOCOL';
}

async function handleAuthSubmit(e) {
  e.preventDefault();

  const authErrorMsg = document.getElementById('auth-error-msg');
  const authSpinner = document.getElementById('auth-spinner');
  const authSubmitBtn = document.getElementById('auth-submit-btn');

  authErrorMsg.style.display = 'none';
  authSpinner.style.display = 'inline-block';
  authSubmitBtn.disabled = true;

  const username = document.getElementById('auth-username').value;
  const password = document.getElementById('auth-password').value;
  const endpoint = authMode === 'login' ? '/api/login' : '/api/register';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      // Ưu tiên message từ backend, fallback sang error code
      const errorMsg = data.message || data.error || 'Lỗi mạng không xác định';
      throw new Error(errorMsg);
    }

    // Lưu token & username vào state toàn cục (app.js)
    AppState.token = data.token;
    AppState.currentUser = data.username;
    localStorage.setItem('cyber_token', data.token);
    localStorage.setItem('cyber_username', data.username);

    document.getElementById('current-user-display').textContent = `USER // ${data.username.toUpperCase()}`;
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';

    showScreen('home-screen');
    loadUsers();
    initWebSocket();

  } catch (err) {
    // Kiểm tra nếu là lỗi từ server với message cụ thể
    let errorMessage = err.message;

    if (err.message === 'NODE_NOT_FOUND') {
      errorMessage = 'NODE KHÔNG TỒN TẠI TRONG MẠNG LƯỚI';
    } else if (err.message === 'ACCESS_DENIED') {
      errorMessage = 'MÃ XÁC THỰC KHÔNG CHÍNH XÁC';
    } else if (err.message === 'Invalid credentials') {
      errorMessage = 'THÔNG TIN XÁC THỰC KHÔNG HỢP LỆ';
    }

    authErrorMsg.textContent = `LỖI PROTOCOL: ${errorMessage.toUpperCase()}`;
    authErrorMsg.style.display = 'block';
  } finally {
    authSpinner.style.display = 'none';
    authSubmitBtn.disabled = false;
  }
}

function handleLogout() {
  if (AppState.ws) AppState.ws.close();
  localStorage.removeItem('cyber_token');
  localStorage.removeItem('cyber_username');
  AppState.token = null;
  AppState.currentUser = null;
  AppState.activeChatPartner = null;
  showScreen('auth-screen');
}