// ==========================================
// auth.js — Login / Register / Logout
// ==========================================

let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  const authErrorMsg = document.getElementById('auth-error-msg');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authForm = document.getElementById('auth-form');
  const forgotForm = document.getElementById('forgot-form');

  authErrorMsg.style.display = 'none';
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('tab-forgot').classList.toggle('active', mode === 'forgot');

  if (mode === 'forgot') {
    authForm.style.display = 'none';
    forgotForm.style.display = 'block';
  } else {
    authForm.style.display = 'block';
    forgotForm.style.display = 'none';
    authSubmitBtn.textContent = mode === 'login' ? 'INITIATE CONNECT' : 'REGISTER PROTOCOL';
  }
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

    // Nếu vừa register, bắt buộc hiện recovery code trước khi vào app
    if (authMode === 'register' && data.recoveryCode) {
      showRecoveryCode(data.recoveryCode, () => {
        showScreen('home-screen');
        loadUsers();
        initWebSocket();
      });
    } else {
      showScreen('home-screen');
      loadUsers();
      initWebSocket();
    }

  } catch (err) {
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

function showRecoveryCode(code, onConfirm) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.9);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; flex-direction: column; padding: 20px; text-align: center;
  `;
  overlay.innerHTML = `
    <h2 style="color:#ff2fd0; margin-bottom:16px;">⚠ LƯU MÃ KHÔI PHỤC NÀY</h2>
    <p style="color:#aaa; max-width:400px; margin-bottom:20px;">
      Mã này chỉ hiện <strong>1 lần duy nhất</strong>. Dùng để lấy lại tài khoản nếu quên mật khẩu.
      Không ai có thể xem lại mã này giúp bạn.
    </p>
    <div style="font-size:28px; font-family:monospace; letter-spacing:4px; color:#0ff; background:#111; padding:16px 24px; border:1px solid #0ff; border-radius:8px; margin-bottom:24px;">
      ${code}
    </div>
    <button id="recovery-confirm-btn" style="padding:12px 32px; background:#ff2fd0; border:none; border-radius:6px; color:#000; font-weight:bold; cursor:pointer;">
      TÔI ĐÃ LƯU MÃ NÀY
    </button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('recovery-confirm-btn').addEventListener('click', () => {
    document.body.removeChild(overlay);
    onConfirm();
  });
}

async function handleForgotPassword(e) {
  e.preventDefault();

  const username = document.getElementById('forgot-username').value;
  const recoveryCode = document.getElementById('forgot-recovery-code').value;
  const newPassword = document.getElementById('forgot-new-password').value;
  const errorMsg = document.getElementById('forgot-error-msg');

  errorMsg.style.display = 'none';

  try {
    const response = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, recoveryCode, newPassword })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Lỗi không xác định');
    }

    showRecoveryCode(data.recoveryCode, () => {
      switchAuthTab('login');
      document.getElementById('forgot-username').value = '';
      document.getElementById('forgot-recovery-code').value = '';
      document.getElementById('forgot-new-password').value = '';
    });

  } catch (err) {
    errorMsg.textContent = `LỖI PROTOCOL: ${err.message.toUpperCase()}`;
    errorMsg.style.display = 'block';
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

