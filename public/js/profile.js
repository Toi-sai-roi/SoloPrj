// ==========================================
// js/profile.js — User profile & avatar
// ==========================================

// Hàm mở Modal Profile (Lớp 2)
async function openProfile(username) {
  let modal = document.getElementById('cyber-profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'cyber-profile-modal';
    modal.className = 'profile-modal-overlay';
    modal.style.zIndex = '99999';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = `<div class="profile-modal-card glass-panel" style="text-align:center;"><div class="profile-modal-title">LOADING_NODE_DATA...</div></div>`;

  try {
    const response = await fetch(`/api/profile/${encodeURIComponent(username)}`, { headers: { 'Authorization': `Bearer ${AppState.token}` } });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Failed to fetch node info');
    }
    const profileData = await response.json();
    console.log('API response:', profileData);
    
    const relResponse = await fetch(`/api/friends/status/${encodeURIComponent(username)}`, { headers: { 'Authorization': `Bearer ${AppState.token}` } });
    if (!relResponse.ok) {
      if (relResponse.status === 401 || relResponse.status === 403) return;
      throw new Error('Failed to fetch relation');
    }
    const relData = await relResponse.json();
    const isMe = (username === AppState.currentUser);

    const avatarHtml = profileData.avatar
      ? `<img src="${profileData.avatar}" id="profile-avatar-img" onclick="openInternalLightbox(event, this.src)" style="width:100%; height:100%; border-radius:4px; object-fit:cover; cursor:pointer;">`
      : `<div id="profile-avatar-placeholder" style="font-size:42px; font-family:var(--font-tech);">${username.charAt(0).toUpperCase()}</div>`;

    let actionButtonsHtml = '';
    if (!isMe) {
      let relButton = '';
      if (relData.relation === 'none') {
        relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'request')" style="flex: 1; border-color:var(--neon-cyan); color:var(--neon-cyan); padding: 10px 5px;">CONNECT_NODE</button>`;
      } else if (relData.relation === 'pending' && relData.sender === 'me') {
        relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex: 1; border-color:var(--text-muted); color:var(--text-muted); padding: 10px 5px;">PENDING_CANCEL</button>`;
      } else if (relData.relation === 'pending' && relData.sender === 'them') {
        relButton = `
          <div style="display:flex; gap:5px; flex:1;">
            <button class="cyber-btn" onclick="handleFriendAction('${username}', 'accept')" style="flex:1; border-color:var(--neon-green); color:var(--neon-green); padding: 10px 2px;">ACCEPT</button>
            <button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex:1; border-color:var(--neon-pink); color:var(--neon-pink); padding: 10px 2px;">DECLINE</button>
          </div>`;
      } else if (relData.relation === 'friends') {
        relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex: 1; border-color:var(--neon-purple); color:var(--neon-purple); padding: 10px 5px;">DISCONNECT_NODE</button>`;
      } else if (relData.relation === 'blocking') {
        relButton = `<button class="cyber-btn" onclick="handleUnblockAction('${username}')" style="flex: 1; border-color:var(--neon-green); color:var(--neon-green); padding: 10px 5px;">UNBLOCK_NODE</button>`;
      }

      actionButtonsHtml = `
        <div style="display: flex; gap: 10px; width: 100%; align-items: center; margin-top: 15px;">
          ${relButton}
          ${relData.relation !== 'blocking' ? `<button class="cyber-btn" onclick="handleBlockAction('${username}')" style="border-color:var(--neon-pink); color:var(--neon-pink); width: 85px; padding: 10px 0;">BLOCK</button>` : ''}
        </div>`;
    }

    modal.innerHTML = `
      <div class="profile-modal-card glass-panel">
        <div class="profile-modal-header">
          <span class="profile-modal-title">NODE_PROFILE // ${username.toUpperCase()}</span>
          <button class="profile-close-btn" onclick="closeProfileModal()">&times;</button>
        </div>
        <div class="profile-modal-body">
          <div class="profile-avatar-wrapper">
            <div id="profile-avatar-display" class="profile-avatar-large">${avatarHtml}</div>
            ${isMe ? `<label for="avatar-file-input" class="avatar-upload-trigger">⚡ EDIT_AVATAR</label><input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleProfileUpdate(event)">` : ''}
          </div>
          <div class="profile-info-fields">
            <div class="profile-field"><label>IDENTIFIER</label><input type="text" class="cyber-input" value="${username}" disabled style="opacity: 0.6;" /></div>
            <div class="profile-field">
              <label>BIOGRAPHY</label>
              ${isMe ? `<textarea id="profile-bio-input" class="cyber-input" style="resize:none; height:60px; font-family:var(--font-body);" maxlength="100">${profileData.bio || ''}</textarea>` : `<div class="cyber-input" style="height:auto; min-height:50px; background:rgba(0,0,0,0.2); font-family:var(--font-body); white-space:pre-wrap;">${profileData.bio || 'Chưa cấu hình tiểu sử...'}</div>`}
            </div>
            ${actionButtonsHtml}
            <div class="profile-field" style="margin-top:15px; font-family:var(--font-tech); font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
              <span>📅 JOINED: ${new Date(profileData.created_at).toLocaleDateString('vi-VN')}</span>
              <span style="color:${profileData.isBlockedReal ? 'var(--text-muted)' : 'var(--neon-green)'}">● ${(profileData.lastseentext || profileData.lastSeenText || 'OFFLINE').toUpperCase()}</span>            
            </div>
            ${isMe ? `<button class="cyber-btn" onclick="saveProfileBio()" style="width:100%; margin-top:10px; padding:10px;">LƯU THÔNG TIN PROFILE</button>
            <button class="cyber-btn" id="profile-theme-toggle-btn" onclick="toggleTheme()" style="width:100%; margin-top:8px; padding:10px; border-color:var(--text-muted); color:var(--text-muted); font-size:10px;">${document.body.classList.contains('light-theme') ? '🌙 DARK MODE' : '☀️ LIGHT MODE'}</button>` : ''}
          </div>
        </div>
      </div>`;
  } catch (err) {
    console.error(err);
    closeProfileModal();
  }
}

async function handleBlockAction(targetUser) {
  if (!confirm(`Xác nhận cô lập và chặn hoàn toàn Node ${targetUser.toUpperCase()}?`)) return;
  try {
    const response = await fetch('/api/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AppState.token}` },
      body: JSON.stringify({ target: targetUser })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Block failed');
    }
    const resData = await response.json();
    alert(resData.message);
    openProfile(targetUser);
    if (typeof loadUsers === 'function') loadUsers();
  } catch (e) { console.error(e); }
}

async function handleUnblockAction(targetUser) {
  try {
    const response = await fetch('/api/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AppState.token}` },
      body: JSON.stringify({ target: targetUser })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Unblock failed');
    }
    const resData = await response.json();
    alert(resData.message);
    openProfile(targetUser);
    if (typeof loadUsers === 'function') loadUsers();
  } catch (e) { console.error(e); }
}

// Hàm xử lý tương tác Kết bạn / Hủy bạn
async function handleFriendAction(targetUser, actionType) {
  try {
    let url, method, body;

    if (actionType === 'request') {
      url = '/api/friends/request';
      method = 'POST';
      body = { receiver: targetUser };
    } else if (actionType === 'accept') {
      url = '/api/friends/accept';
      method = 'PUT';
      body = { sender: targetUser };
    } else if (actionType === 'cancel') {
      url = '/api/friends/cancel';
      method = 'DELETE';
      body = { target: targetUser };
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Friend action failed');
    }

    openProfile(targetUser);
    if (typeof loadUsers === 'function') loadUsers();
  } catch (e) {
    console.error(e);
  }
}

function closeProfileModal() {
  const modal = document.getElementById('cyber-profile-modal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// HÀM TẠO LỚP NỀN ĐEN NỘI BỘ (LỚP 3) - ĐÈ KHÍT LÊN TRÊN MODAL PROFILE
// ==========================================
function openInternalLightbox(event, src) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  let internalOverlay = document.getElementById('internal-profile-lightbox');
  if (!internalOverlay) {
    internalOverlay = document.createElement('div');
    internalOverlay.id = 'internal-profile-lightbox';
    internalOverlay.style = `
      display: none; 
      position: fixed; 
      top: 0; left: 0; 
      width: 100vw; height: 100vh; 
      background: rgba(4, 4, 6, 0.98); 
      z-index: 999999; 
      justify-content: center; 
      align-items: center; 
      cursor: zoom-out;
    `;

    internalOverlay.onclick = function (e) {
      internalOverlay.style.display = 'none';
    };

    internalOverlay.innerHTML = `
      <button class="cyber-btn" style="position: absolute; top: 20px; right: 20px; border-color: var(--neon-pink); padding: 8px 16px; font-size: 11px; min-width: auto; cursor: pointer;">CLOSE</button>
      <img id="internal-lightbox-img" src="" style="max-width: 90%; max-height: 90%; border: 2px solid var(--neon-cyan); box-shadow: 0 0 30px rgba(0, 240, 255, 0.3); object-fit: contain; width: auto; height: auto;">
    `;
    document.body.appendChild(internalOverlay);
  }

  const img = document.getElementById('internal-lightbox-img');
  if (img) {
    img.src = src;
    img.onclick = function (e) { e.stopPropagation(); };
  }

  internalOverlay.style.display = 'flex';
}

async function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 1024 * 1024) {
    alert('Dung lượng ảnh vượt mức cho phép (Tối đa 1MB)!');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    const base64Data = e.target.result;

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AppState.token}`
        },
        body: JSON.stringify({ avatar: base64Data })
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return;
        throw new Error('Cập nhật dữ liệu thất bại');
      }

      const displayBox = document.getElementById('profile-avatar-display');
      if (displayBox) {
        displayBox.innerHTML = `<img src="${base64Data}" id="profile-avatar-img" onclick="openInternalLightbox(event, this.src)" style="width:100%; height:100%; border-radius:4px; object-fit:cover; cursor:pointer;">`;
      }

      if (typeof loadUsers === 'function') loadUsers();

    } catch (err) {
      console.error('Lỗi lưu avatar:', err);
      alert('Không thể đồng bộ ảnh đại diện.');
    }
  };
  reader.readAsDataURL(file);
}

function handleProfileUpdate(event) {
  handleAvatarUpload(event);
}

async function saveProfileBio() {
  const bioInput = document.getElementById('profile-bio-input');
  if (!bioInput) return;

  const bioValue = bioInput.value;

  try {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ bio: bioValue })
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return;
      throw new Error('Không thể đồng bộ cơ sở dữ liệu');
    }

    alert('Đã cập nhật tiểu sử cá nhân thành công!');
    closeProfileModal();
  } catch (err) {
    console.error('Lỗi lưu tiểu sử:', err);
    alert('Gặp sự cố khi lưu thông tin tiểu sử.');
  }
}