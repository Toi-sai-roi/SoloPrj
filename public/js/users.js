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

  const container  = document.getElementById('users-list-container');
  const blankState = document.getElementById('users-blank-state');
  const countEl    = document.getElementById('users-count');

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
    card.onclick = () => openChatWith(user.username);
    card.innerHTML = `
      <div class="user-card-info">
        <div class="user-avatar">${user.username.charAt(0)}</div>
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