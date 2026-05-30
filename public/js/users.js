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
  // 1. Khởi tạo tab mặc định nếu chưa có
  if (typeof AppState.currentUsersTab === 'undefined') {
    AppState.currentUsersTab = 'all';
  }

  const list = filteredUsers || AppState.usersData || [];
  let displayUsers = list.filter(u => u.username !== AppState.currentUser);

  // 2. LỌC NGAY TỪ TRONG MẢNG DỮ LIỆU (Không dùng CSS ẩn hiện thẻ sau khi render nữa)
  if (AppState.currentUsersTab === 'friends') {
    displayUsers = displayUsers.filter(u => u.relation === 'friend');
  }

  const container = document.getElementById('users-list-container');
  const blankState = document.getElementById('users-blank-state');
  const countEl = document.getElementById('users-count');

  if (!container) return;
  container.innerHTML = '';

  // 3. ĐẾM VÀ QUẢN LÝ ĐĨA BAY CHUẨN XÁC THEO MẢNG DỮ LIỆU THỰC TẾ
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

  // 4. RENDER VÀ CHÈN NÚT ĐỒNG THỜI (BẢO TOÀN 100% CẤU TRÚC V4 GỐC)
  displayUsers.forEach(user => {
    const card = document.createElement('div');
    card.className = 'user-card glass-panel';

    // Click vào card mở chat (giữ nguyên v4)
    card.onclick = () => openChatWith(user.username);

    // Logic avatar súp lơ phát sáng (giữ nguyên v4)
    const avatarContent = user.avatar
      ? `<img src="${user.avatar}" class="user-avatar-img" style="width:100%; height:100%; border-radius:inherit; object-fit:cover; display:block;">`
      : user.username.charAt(0).toUpperCase();

    // Tính toán nút bấm mạng lưới dựa trên quan hệ dữ liệu thực tế
    let actionBtnHtml = '';
    const relation = user.relation || 'none';

    if (relation === 'friend') {
      actionBtnHtml = `<button class="cyber-btn" style="padding:4px 8px; font-size:9px; border-color:var(--neon-pink); color:var(--neon-pink); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${user.username}', 'cancel')">UNFRIEND</button>`;
    } else if (relation === 'pending_sent') {
      actionBtnHtml = `<span style="font-size:9px; color:var(--text-muted); font-family:var(--font-tech);">[ĐANG CHỜ...]</span>`;
    } else if (relation === 'pending_received') {
      actionBtnHtml = `
        <div style="display:flex; gap:4px;">
          <button class="cyber-btn" style="padding:4px 6px; font-size:9px; border-color:var(--neon-green); color:var(--neon-green); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${user.username}', 'accept')">NHẬN</button>
          <button class="cyber-btn" style="padding:4px 6px; font-size:9px; border-color:var(--neon-pink); color:var(--neon-pink); min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${user.username}', 'cancel')">TỪ CHỐI</button>
        </div>
      `;
    } else {
      actionBtnHtml = `<button class="cyber-btn cyan-alt" style="padding:4px 8px; font-size:9px; min-width:auto; height:auto; line-height:1; font-family:var(--font-tech);" onclick="event.stopPropagation(); handleFriendRequestAction('${user.username}', 'add')">ADD FRIEND</button>`;
    }

    // Thiết lập布局 flexbox để dồn nút và dấu chấm sang bên phải gọn gàng như trong ảnh cap
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'space-between';

    card.innerHTML = `
      <div class="user-card-info" style="display:flex; align-items:center; gap:10px;">
        <div class="user-avatar" onclick="event.stopPropagation(); openProfile('${user.username}')">
          ${avatarContent}
        </div>
        <div class="user-name">${user.username}</div>
      </div>
      
      <div style="display:flex; align-items:center; gap:12px;" onclick="event.stopPropagation();">
        <div class="cyber-network-action-area">
          ${actionBtnHtml}
        </div>
        <span class="status-dot ${user.online ? 'online' : 'offline'}" id="status-dot-${user.username}" style="position:static; margin:0;"></span>
      </div>
    `;

    container.appendChild(card);
  });
}

// 5. HÀM CHUYỂN TAB CHUẨN ĐỒNG BỘ
function switchUsersTab(tabName) {
  AppState.currentUsersTab = tabName;

  const tabAll = document.getElementById('tab-users-all');
  const tabFriends = document.getElementById('tab-users-friends');

  if (tabAll && tabFriends) {
    if (tabName === 'all') {
      tabAll.classList.add('active');
      tabFriends.classList.remove('active');
    } else {
      tabAll.classList.remove('active');
      tabFriends.classList.add('active');
    }
  }

  // Render trực tiếp, loại bỏ hoàn toàn setInterval bên ngoài
  renderUsersList();
}

async function handleFriendRequestAction(targetUser, actionType) {
  console.log(`[NETWORK ACTION]: Tiến hành ${actionType} với user: ${targetUser}`);

  // 1. TRẢI NGHIỆM LẬP TỨC (Optimistic UI): Đổi nút ngay lập tức, không đợi API phản hồi
  const userIdx = AppState.usersData.findIndex(u => u.username === targetUser);
  let backupRelation = 'none'; // Biến dự phòng để hoàn tác nếu API thất bại

  if (userIdx !== -1) {
    backupRelation = AppState.usersData[userIdx].relation || 'none';

    // Giả lập trạng thái quan hệ mới trong bộ nhớ RAM của client
    if (actionType === 'add') AppState.usersData[userIdx].relation = 'pending_sent';
    else if (actionType === 'accept') AppState.usersData[userIdx].relation = 'friend';
    else if (actionType === 'cancel') AppState.usersData[userIdx].relation = 'none';

    // Vẽ lại giao diện ngay tức thì
    renderUsersList();
  }

  // 2. BẮN REQUEST LÊN SERVER ĐỂ ĐỒNG BỘ VÀO DATABASE
  try {
    const response = await fetch('/api/users/friend-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({
        targetUser: targetUser,
        action: actionType // Gửi lên 'add', 'accept', hoặc 'cancel'
      })
    });

    if (!response.ok) {
      throw new Error('Server gặp sự cố hoặc từ chối xử lý');
    }

    const result = await response.json();

    // Nếu Backend trả về dữ liệu relation mới cập nhật chuẩn từ DB, cập nhật lại lần nữa cho chắc
    if (userIdx !== -1 && result.data && result.data.relation) {
      AppState.usersData[userIdx].relation = result.data.relation;
      renderUsersList();
    }

  } catch (err) {
    console.error('Lỗi tương tác mạng lưới kết bạn:', err);

    // NẾU LỖI (Mất mạng, sập server...): Hoàn tác (Rollback) giao diện về nút cũ để tránh lừa dối người dùng
    if (userIdx !== -1) {
      AppState.usersData[userIdx].relation = backupRelation;
      renderUsersList();
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