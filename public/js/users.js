// ==========================================
// users.js — Fetch, render, search users
// ==========================================

async function loadUsers() {
  try {
    const response = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });

    if (!response.ok) {
      if (response.status === 401) { handleLogout(); return; }
      throw new Error('Không thể fetch dữ liệu users');
    }

    AppState.usersData = await response.json();
    renderUsersList();
  } catch (err) {
    console.error('Lỗi tải danh sách users:', err);
  }
}

function renderUsersList(filteredUsers = null) {
  const list = filteredUsers || AppState.usersData;
  const displayUsers = list.filter(u => u.username !== AppState.currentUser);

  const container = document.getElementById('users-list-container');
  const blankState = document.getElementById('users-blank-state');
  const countEl = document.getElementById('users-count');

  container.innerHTML = '';

  if (displayUsers.length === 0) {
    blankState.style.display = 'flex';
    countEl.textContent = '0 NODES';
    return;
  }

  blankState.style.display = 'none';
  countEl.textContent = `${displayUsers.length} NODES`;

  displayUsers.forEach(user => {
    const card = document.createElement('div');
    card.className = 'user-card glass-panel';

    // Khi click vào vùng card (trừ avatar) thì mở chat
    card.onclick = () => openChatWith(user.username);

    // KIỂM TRA AVATAR: Nếu có base64 thì render thẻ img, nếu không thì lấy chữ cái đầu
    const avatarContent = user.avatar
      ? `<img src="${user.avatar}" class="user-avatar-img" style="width:100%; height:100%; border-radius:inherit; object-fit:cover; display:block;">`
      : user.username.charAt(0).toUpperCase();

    // Dùng event.stopPropagation() ở thẻ avatar để khi click xem profile, nó KHÔNG kích hoạt mở chat của thẻ cha
    card.innerHTML = `
      <div class="user-card-info">
        <div class="user-avatar" onclick="event.stopPropagation(); openProfile('${user.username}')">
          ${avatarContent}
        </div>
        <div class="user-name">${user.username}</div>
      </div>
      <span class="status-dot ${user.online ? 'online' : 'offline'}" id="status-dot-${user.username}"></span>
    `;
    container.appendChild(card);
  });
}

function filterUsers() {
  const term = document.getElementById('search-input').value.toLowerCase().trim();
  if (!term) { renderUsersList(); return; }
  const filtered = AppState.usersData.filter(u => u.username.toLowerCase().includes(term));
  renderUsersList(filtered);
}

function glowNotification(sender) {
  const dot = document.getElementById(`status-dot-${sender}`);
  if (dot) {
    dot.style.backgroundColor = 'var(--neon-pink)';
    dot.style.boxShadow = '0 0 12px var(--neon-pink)';
    setTimeout(() => {
      const userObj = AppState.usersData.find(u => u.username === sender);
      if (userObj) {
        dot.className = `status-dot ${userObj.online ? 'online' : 'offline'}`;
        dot.style = '';
      }
    }, 4000);
  }
}