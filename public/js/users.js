// ==========================================
// js/users.js — Fetch, render, search users + STRONG Unread Notification
// v9.1-fix: Thay renderUsersList() bằng updateUserCard() trong các hot-path
//           để tránh rerender toàn bộ list mỗi lần bấm nút
// ==========================================

async function loadUsers() {
  try {
    const response = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Không thể fetch dữ liệu users');
    }

    AppState.usersData = await response.json();
    renderUsersList();
  } catch (err) {
    console.error('Lỗi tải danh sách users:', err);
  }
}

// Build action button HTML cho 1 user
function buildActionBtnHtml(username, relation) {
  if (relation === 'friend') {
    return `<button class="cyber-btn" style="padding:4px 8px; font-size:9px; border-color:var(--neon-pink); color:var(--neon-pink); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${username}', 'cancel')">UNFRIEND</button>`;
  } else if (relation === 'pending_sent') {
    return `<span style="font-size:9px; color:var(--text-muted); font-family:var(--font-tech);">[ĐANG CHỜ...]</span>`;
  } else if (relation === 'pending_received') {
    return `
      <div style="display:flex; gap:4px;">
        <button class="cyber-btn" style="padding:4px 6px; font-size:9px; border-color:var(--neon-green); color:var(--neon-green); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${username}', 'accept')">ACCEPT</button>
        <button class="cyber-btn" style="padding:4px 6px; font-size:9px; border-color:var(--neon-pink); color:var(--neon-pink); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${username}', 'cancel')">DECLINE</button>
      </div>
    `;
  } else {
    return `<button class="cyber-btn cyan-alt" style="padding:4px 8px; font-size:9px; min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${username}', 'add')">ADD FRIEND</button>`;
  }
}

// FIX: Update đúng 1 card trong DOM, không rerender cả list
function updateUserCard(username) {
  const user = AppState.usersData.find(u => u.username === username);
  if (!user) return;

  const container = document.getElementById('users-list-container');
  if (!container) return;

  // Tìm card theo data attribute
  const card = container.querySelector(`.user-card[data-username="${username}"]`);
  if (!card) return;

  const hasUnread = AppState.unreadCounts && AppState.unreadCounts[username] > 0;
  const relation = user.relation || 'none';

  // Update class card (unread glow)
  card.className = hasUnread ? 'user-card glass-panel has-unread' : 'user-card glass-panel';

  // Update action button
  const actionArea = card.querySelector('.cyber-network-action-area');
  if (actionArea) actionArea.innerHTML = buildActionBtnHtml(username, relation);

  // Update status dot
  const dot = card.querySelector(`#status-dot-${username}`);
  if (dot) {
    dot.className = hasUnread ? 'status-dot unread' : `status-dot ${user.online ? 'online' : 'offline'}`;
    dot.style = '';
  }

  // Nếu đang ở tab friends và relation không còn là friend → ẩn card
  if (AppState.currentUsersTab === 'friends' && relation !== 'friend') {
    card.style.display = 'none';
    // Update count
    const countEl = document.getElementById('users-count');
    if (countEl) {
      const visible = container.querySelectorAll('.user-card[data-username]:not([style*="display: none"])').length;
      countEl.textContent = `${visible} FRIENDS`;
    }
  }
}

// Update chỉ status dot của 1 user (dùng cho status_change)
function updateUserOnlineStatus(username, online) {
  const userIdx = AppState.usersData.findIndex(u => u.username === username);
  if (userIdx !== -1) {
    AppState.usersData[userIdx].online = online;
  }

  const dot = document.getElementById(`status-dot-${username}`);
  if (!dot) return;

  const hasUnread = AppState.unreadCounts && AppState.unreadCounts[username] > 0;
  if (!hasUnread) {
    dot.className = `status-dot ${online ? 'online' : 'offline'}`;
  }
}

// Update unread dot cho tất cả user có thay đổi unread (không rerender cả list)
function updateUnreadDots(newCounts) {
  const oldCounts = AppState.unreadCounts || {};
  AppState.unreadCounts = newCounts;

  // Chỉ update những user có sự thay đổi
  const allUsernames = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
  allUsernames.forEach(username => {
    if ((oldCounts[username] || 0) !== (newCounts[username] || 0)) {
      updateUserCard(username);
    }
  });
}

function renderUsersList(filteredUsers = null) {
  if (typeof AppState.currentUsersTab === 'undefined') {
    AppState.currentUsersTab = 'all';
  }

  const list = filteredUsers || AppState.usersData || [];
  let displayUsers = list.filter(u => u.username !== AppState.currentUser);

  if (AppState.currentUsersTab === 'friends') {
    displayUsers = displayUsers.filter(u => u.relation === 'friend');
  }

  const container = document.getElementById('users-list-container');
  const blankState = document.getElementById('users-blank-state');
  const countEl = document.getElementById('users-count');

  if (!container) return;
  container.innerHTML = '';

  if (displayUsers.length === 0) {
    if (blankState) blankState.style.setProperty('display', 'flex', 'important');
    if (countEl) {
      countEl.textContent = AppState.currentUsersTab === 'friends' ? '0 FRIENDS' : '0 NODES';
    }
    return;
  }

  if (blankState) blankState.style.setProperty('display', 'none', 'important');
  if (countEl) {
    countEl.textContent = `${displayUsers.length} ${AppState.currentUsersTab === 'friends' ? 'FRIENDS' : 'NODES'}`;
  }

  displayUsers.forEach(user => {
    const card = document.createElement('div');

    const hasUnread = AppState.unreadCounts && AppState.unreadCounts[user.username] > 0;

    card.className = hasUnread ? 'user-card glass-panel has-unread' : 'user-card glass-panel';
    // FIX: Thêm data-username để updateUserCard() tìm được
    card.dataset.username = user.username;
    card.onclick = () => openChatWith(user.username);

    const avatarContent = user.avatar
      ? `<img src="${user.avatar}" class="user-avatar-img" style="width:100%; height:100%; border-radius:inherit; object-fit:cover; display:block;">`
      : user.username.charAt(0).toUpperCase();

    const relation = user.relation || 'none';
    const actionBtnHtml = buildActionBtnHtml(user.username, relation);
    const dotClass = hasUnread ? 'status-dot unread' : `status-dot ${user.online ? 'online' : 'offline'}`;

    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'space-between';

    card.innerHTML = `
      <div class="user-card-info" style="display:flex; align-items:center; gap:10px;">
        <div class="user-avatar" onclick="event.stopPropagation(); openProfile('${user.username}')">
          ${avatarContent}
        </div>
        <div class="user-name" title="${user.username}">${user.username}</div>
      </div>

      <div style="display:flex; align-items:center; gap:12px;" onclick="event.stopPropagation();">
        <div class="cyber-network-action-area">
          ${actionBtnHtml}
        </div>
        <span class="${dotClass}" id="status-dot-${user.username}" style="position:static; margin:0;"></span>
      </div>
    `;

    container.appendChild(card);
  });
}

function switchUsersTab(tabName) {
  AppState.currentUsersTab = tabName;

  const tabAll = document.getElementById('tab-users-all');
  const tabFriends = document.getElementById('tab-users-friends');
  const tabGroups = document.getElementById('tab-users-groups');
  const createGroupBtn = document.getElementById('create-group-btn');

  [tabAll, tabFriends, tabGroups].forEach(t => t && t.classList.remove('active'));

  if (tabName === 'all') {
    tabAll && tabAll.classList.add('active');
    if (createGroupBtn) createGroupBtn.style.display = 'none';
  } else if (tabName === 'friends') {
    tabFriends && tabFriends.classList.add('active');
    if (createGroupBtn) createGroupBtn.style.display = 'none';
  } else if (tabName === 'groups') {
    tabGroups && tabGroups.classList.add('active');
    if (createGroupBtn) createGroupBtn.style.display = 'block';
    loadAndRenderGroups();
    return;
  }

  renderUsersList();
}

async function handleFriendRequestAction(targetUser, actionType) {
  console.log(`[NETWORK ACTION]: Tiến hành ${actionType} với user: ${targetUser}`);

  const userIdx = AppState.usersData.findIndex(u => u.username === targetUser);
  let backupRelation = 'none';

  if (userIdx !== -1) {
    backupRelation = AppState.usersData[userIdx].relation || 'none';

    // Optimistic update — chỉ update card đó, không rerender cả list
    if (actionType === 'add') AppState.usersData[userIdx].relation = 'pending_sent';
    else if (actionType === 'accept') AppState.usersData[userIdx].relation = 'friend';
    else if (actionType === 'cancel') AppState.usersData[userIdx].relation = 'none';

    // FIX: updateUserCard thay vì renderUsersList
    updateUserCard(targetUser);
  }

  try {
    const response = await fetch('/api/users/friend-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ targetUser, action: actionType })
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Server gặp sự cố hoặc từ chối xử lý');
    }

    const result = await response.json();

    if (userIdx !== -1 && result.data && result.data.relation) {
      AppState.usersData[userIdx].relation = result.data.relation;
      // FIX: updateUserCard thay vì renderUsersList
      updateUserCard(targetUser);
    }

  } catch (err) {
    console.error('Lỗi tương tác mạng lưới kết bạn:', err);

    if (userIdx !== -1) {
      AppState.usersData[userIdx].relation = backupRelation;
      updateUserCard(targetUser);
      alert('Thao tác thất bại. Vui lòng kiểm tra lại kết nối!');
    }
  }
}

function filterUsers() {
  const term = document.getElementById('search-input').value.toLowerCase().trim();
  if (!term) { renderUsersList(); return; }
  const filtered = AppState.usersData.filter(u => u.username.toLowerCase().includes(term));
  renderUsersList(filtered);
}

document.getElementById('search-input').addEventListener('input', function () {
  const term = this.value.trim().toLowerCase();
  if (!term) { renderUsersList(); return; }
  const filtered = AppState.usersData.filter(u =>
    u.username.toLowerCase().includes(term)
  );
  renderUsersList(filtered);
});

// ==========================================
// GROUP TAB FUNCTIONS
// ==========================================

async function loadAndRenderGroups() {
  const container = document.getElementById('users-list-container');
  const blankState = document.getElementById('users-blank-state');
  const countEl = document.getElementById('users-count');
  if (!container) return;

  container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-family:var(--font-tech); font-size:10px; letter-spacing:1px;">SCANNING CLUSTERS...</div>';

  try {
    const res = await fetch('/api/groups/my', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return;
      throw new Error('Failed');
    }
    const groups = await res.json();
    AppState.groupsData = groups;

    container.innerHTML = '';

    if (groups.length === 0) {
      if (blankState) {
        blankState.style.setProperty('display', 'flex', 'important');
        const blankText = document.getElementById('blank-state-text');
        if (blankText) blankText.textContent = 'NO GROUP CLUSTERS DETECTED';
      }
      if (countEl) countEl.textContent = '0 GROUPS';
      return;
    }

    if (blankState) blankState.style.setProperty('display', 'none', 'important');
    if (countEl) countEl.textContent = `${groups.length} GROUPS`;

    groups.forEach(group => {
      const card = document.createElement('div');
      card.className = 'user-card glass-panel';
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.justifyContent = 'space-between';
      card.onclick = () => openGroupChat(group.id);

      const avatarContent = group.avatar
        ? `<img src="${group.avatar}" style="width:100%;height:100%;border-radius:8px;object-fit:cover;">`
        : group.name.charAt(0).toUpperCase();

      const lastMsg = group.last_message
        ? (group.last_message.startsWith('data:') ? '[Media]' : group.last_message.substring(0, 30) + (group.last_message.length > 30 ? '...' : ''))
        : 'No messages yet';

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="user-avatar" style="border-radius:8px;background:linear-gradient(135deg,var(--neon-purple),var(--neon-cyan));display:flex;align-items:center;justify-content:center;">
            ${avatarContent}
          </div>
          <div>
            <div class="user-name">${escapeHTML(group.name)}</div>
            <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-tech);margin-top:2px;">${group.member_count} NODES · ${escapeHTML(lastMsg)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${group.role === 'admin' ? '<span style="font-size:8px;color:var(--neon-purple);font-family:var(--font-tech);border:1px solid var(--neon-purple);padding:2px 5px;border-radius:3px;">ADMIN</span>' : ''}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Lỗi tải danh sách nhóm:', err);
    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--accent-pink); font-family:var(--font-tech); font-size:10px;">FAILED TO LOAD CLUSTERS</div>';
  }
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

// Matrix rain — light mode hover
function initMatrixRain() {
  if (!document.body.classList.contains('light-theme')) return;

  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';

  document.querySelectorAll('.user-card').forEach(card => {
    if (card._matrix) return;
    card._matrix = true;

    const rain = document.createElement('div');
    rain.className = 'matrix-rain';
    card.appendChild(rain);

    for (let i = 0; i < 15; i++) {
      const span = document.createElement('span');
      span.textContent = chars[Math.floor(Math.random() * chars.length)];
      span.style.left = `${(i / 15) * 100}%`;
      span.style.animationDuration = `${1.5 + Math.random() * 2}s`;
      span.style.animationDelay = `${Math.random() * 2}s`;
      rain.appendChild(span);
    }
  });
}