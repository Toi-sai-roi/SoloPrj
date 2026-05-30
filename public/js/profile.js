// ==========================================
// profile.js — User profile & avatar (FIXED 3 TẦNG TUYỆT ĐỐI)
// ==========================================

// Hàm mở Modal Profile (Lớp 2)
// THAY THẾ TOÀN BỘ HÀM openProfile TRONG FILE profile.js THÀNH BẢN VẬN HÀNH VERSION 5:
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
    modal.innerHTML = `
    <div class="profile-modal-card glass-panel" style="text-align:center;">
      <div class="profile-modal-title">LOADING_DATA...</div>
    </div>
  `;

    try {
        // 1. Tải thông tin Profile cơ bản
        const response = await fetch(`/api/profile/${username}`, {
            headers: { 'Authorization': `Bearer ${AppState.token}` }
        });
        if (!response.ok) throw new Error('Không thể tải profile mạng lưới');
        const profileData = await response.json();

        // 2. Tải trạng thái quan hệ giữa 2 người
        const relResponse = await fetch(`/api/friends/status/${username}`, {
            headers: { 'Authorization': `Bearer ${AppState.token}` }
        });
        const relData = await relResponse.json();

        const isMe = (username === AppState.currentUser);

        const avatarHtml = profileData.avatar
            ? `<img src="${profileData.avatar}" id="profile-avatar-img" onclick="openInternalLightbox(event, this.src)" style="width:100%; height:100%; border-radius:4px; object-fit:cover; cursor:pointer;">`
            : `<div id="profile-avatar-placeholder" style="font-size:42px; font-family:var(--font-tech);">${username.charAt(0).toUpperCase()}</div>`;

        // 3. Xử lý logic sinh Nút bấm tương tác dựa trên trạng thái quan hệ
        let actionButtonsHtml = '';
        if (!isMe) {
            let relButton = '';
            if (relData.relation === 'none') {
                relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'request')" style="flex: 1; border-color:var(--neon-cyan); color:var(--neon-cyan);">[ CONNECT_NODE ]</button>`;
            } else if (relData.relation === 'pending' && relData.sender === 'me') {
                relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex: 1; border-color:var(--text-muted); color:var(--text-muted);">[ PENDING_CANCEL ]</button>`;
            } else if (relData.relation === 'pending' && relData.sender === 'them') {
                relButton = `
            <button class="cyber-btn" onclick="handleFriendAction('${username}', 'request')" style="flex: 1; border-color:var(--neon-green); color:var(--neon-green);">[ ACCEPT ]</button>
            <button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex: 1; border-color:var(--neon-pink); color:var(--neon-pink);">[ DECLINE ]</button>
        `;
            } else if (relData.relation === 'friends') {
                relButton = `<button class="cyber-btn" onclick="handleFriendAction('${username}', 'cancel')" style="flex: 1; border-color:var(--neon-purple); color:var(--neon-purple);">[ DISCONNECT_NODE ]</button>`;
            } else if (relData.relation === 'blocking') {
                relButton = `<div style="flex: 1; color:var(--neon-pink); font-family:var(--font-tech); font-size:12px; display:flex; align-items:center;">[ NODE_BLOCKED_BY_YOU ]</div>`;
            }

            // Bọc trong một hộp Flex để xếp ngang hoàn hảo không bao giờ vỡ dòng
            actionButtonsHtml = `
        <div style="display: flex; gap: 10px; width: 100%; align-items: center;">
            ${relButton}
            ${relData.relation !== 'blocking' ? `<button class="cyber-btn" onclick="handleBlockAction('${username}')" style="border-color:var(--neon-pink); color:var(--neon-pink); min-width: 80px;">[ BLOCK ]</button>` : ''}
        </div>
    `;
        }

        modal.innerHTML = `
      <div class="profile-modal-card glass-panel">
        <div class="profile-modal-header">
          <span class="profile-modal-title">NODE_PROFILE // ${username.toUpperCase()}</span>
          <button class="profile-close-btn" onclick="closeProfileModal()">&times;</button>
        </div>
        <div class="profile-modal-body">
          
          <div class="profile-avatar-wrapper">
            <div id="profile-avatar-display" class="profile-avatar-large">
              ${avatarHtml}
            </div>
            ${isMe ? `
              <label for="avatar-file-input" class="avatar-upload-trigger">
                <span class="upload-icon">⚡</span> EDIT_AVATAR
              </label>
              <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleProfileUpdate(event)">
            ` : ''}
          </div>

          <div class="profile-info-fields">
            <div class="profile-field">
              <label>IDENTIFIER</label>
              <input type="text" class="cyber-input" value="${username}" disabled style="opacity: 0.6;" />
            </div>
            
            <div class="profile-field">
              <label>BIOGRAPHY</label>
              ${isMe ? `
                <textarea id="profile-bio-input" class="cyber-input" style="resize:none; height:70px; font-family:var(--font-body);" placeholder="Nhập tiểu sử..." maxlength="100">${profileData.bio || ''}</textarea>
              ` : `
                <div class="cyber-input" style="height:auto; min-height:50px; background:rgba(0,0,0,0.2); font-family:var(--font-body); white-space:pre-wrap;">${profileData.bio || 'Chưa cấu hình tiểu sử...'}</div>
              `}
            </div>

            <div class="profile-field" style="margin-top:15px; display:flex; justify-content:flex-start;">
                ${actionButtonsHtml}
            </div>

            <div class="profile-field" style="margin-top:15px; font-family:var(--font-tech); font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
              <span>📅 JOINED: ${new Date(profileData.created_at).toLocaleDateString('vi-VN')}</span>
              <span style="color:var(--neon-green)">● ONLINE</span>
            </div>

            ${isMe ? `
              <button class="cyber-btn" onclick="saveProfileBio()" style="width:100%; margin-top:10px; padding:10px;">LƯU THÔNG TIN PROFILE</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    } catch (err) {
        console.error('Lỗi mở profile:', err);
        alert('Không thể kết xuất dữ liệu profile.');
        closeProfileModal();
    }
}

// Hàm xử lý tương tác Kết bạn / Hủy bạn
async function handleFriendAction(targetUser, actionType) {
    const url = actionType === 'request' ? '/api/friends/request' : '/api/friends/cancel';
    const method = actionType === 'request' ? 'POST' : 'DELETE';
    const bodyData = actionType === 'request' ? { receiver: targetUser } : { target: targetUser };

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.token}`
            },
            body: JSON.stringify(bodyData)
        });
        const resData = await response.json();
        alert(resData.message || 'Thao tác liên kết thành công');

        // Refresh lại chính modal để cập nhật trạng thái nút bấm mới ngay lập tức
        openProfile(targetUser);
        if (typeof loadUsers === 'function') loadUsers();
    } catch (e) {
        console.error(e);
    }
}

// Hàm xử lý chặn (Block)
async function handleBlockAction(targetUser) {
    if (!confirm(`Bạn có chắc chắn muốn ngắt kết nối mạng lưới và chặn Node [${targetUser.toUpperCase()}] không?`)) return;

    try {
        const response = await fetch('/api/block', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.token}`
            },
            body: JSON.stringify({ target: targetUser })
        });
        const resData = await response.json();
        alert(resData.message);
        closeProfileModal();
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
        event.stopPropagation(); // Chặn đứng không cho lan ra Home
        event.preventDefault();
    }

    // Tìm xem đã có Lightbox nội bộ chưa, chưa có thì tự sinh ra ngay bên trong document
    let internalOverlay = document.getElementById('internal-profile-lightbox');
    if (!internalOverlay) {
        internalOverlay = document.createElement('div');
        internalOverlay.id = 'internal-profile-lightbox';
        // Ép CSS trực tiếp: z-index cực đại (999999) để đè bẹp Lớp 2 và Lớp 1
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

        // Khi click vào vùng đen thì TẮT LỚP 3, giữ nguyên Lớp 2, không động chạm gì vào Home
        internalOverlay.onclick = function (e) {
            internalOverlay.style.display = 'none';
        };

        internalOverlay.innerHTML = `
            <button class="cyber-btn" style="position: absolute; top: 20px; right: 20px; border-color: var(--neon-pink); padding: 8px 16px; font-size: 11px; min-width: auto; cursor: pointer;">CLOSE [X]</button>
            <img id="internal-lightbox-img" src="" style="max-width: 90%; max-height: 90%; border: 2px solid var(--neon-cyan); box-shadow: 0 0 30px rgba(0, 240, 255, 0.3); object-fit: contain; width: auto; height: auto;">
        `;
        document.body.appendChild(internalOverlay);
    }

    const img = document.getElementById('internal-lightbox-img');
    if (img) {
        img.src = src;
        // Chặn nổi bọt khi click trúng bức ảnh phóng to
        img.onclick = function (e) { e.stopPropagation(); };
    }

    internalOverlay.style.display = 'flex';
}

// XỬ LÝ EDIT #1: Upload và cập nhật Avatar (Gửi yêu cầu PUT lên server)
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

            if (!response.ok) throw new Error('Cập nhật dữ liệu thất bại');

            // Cập nhật nóng ảnh hiển thị tức thì trên Modal
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

// XỬ LÝ EDIT #2: Lưu nội dung Text Bio (Tiểu sử)
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

        if (!response.ok) throw new Error('Không thể đồng bộ cơ sở dữ liệu');

        alert('Đã cập nhật tiểu sử cá nhân thành công!');
        closeProfileModal();
    } catch (err) {
        console.error('Lỗi lưu tiểu sử:', err);
        alert('Gặp sự cố khi lưu thông tin tiểu sử.');
    }
}