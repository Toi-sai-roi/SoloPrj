// ==========================================
// profile.js — User profile & avatar (FIXED 3 TẦNG TUYỆT ĐỐI)
// ==========================================

// Hàm mở Modal Profile (Lớp 2)
async function openProfile(username) {
    let modal = document.getElementById('cyber-profile-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cyber-profile-modal';
        modal.className = 'profile-modal-overlay';
        // Đặt mức ưu tiên hiển thị cho Lớp 2
        modal.style.zIndex = '99999'; 
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';

    // Hiển thị giao diện chờ tải dữ liệu
    modal.innerHTML = `
    <div class="profile-modal-card glass-panel" style="text-align:center;">
      <div class="profile-modal-title">LOADING_DATA...</div>
    </div>
  `;

    try {
        // Gọi API lấy dữ liệu chi tiết của User cần xem
        const response = await fetch(`/api/profile/${username}`, {
            headers: { 'Authorization': `Bearer ${AppState.token}` }
        });

        if (!response.ok) throw new Error('Không thể tải profile mạng lưới');
        const profileData = await response.json();

        // Kiểm tra xem User đang xem có phải là chính mình không để bật chế độ chỉnh sửa (Edit)
        const isMe = (username === AppState.currentUser);

        // CHÍ MẠNG LỚP 3: Gọi hàm mở Lightbox nội bộ đè trực tiếp lên Modal, chặn nổi bọt tuyệt đối
        const avatarHtml = profileData.avatar
            ? `<img src="${profileData.avatar}" id="profile-avatar-img" onclick="openInternalLightbox(event, this.src)" style="width:100%; height:100%; border-radius:4px; object-fit:cover; cursor:pointer;">`
            : `<div id="profile-avatar-placeholder" style="font-size:42px; font-family:var(--font-tech);">${username.charAt(0).toUpperCase()}</div>`;
        
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
              <label>BIOGRAPHY (TIỂU SỬ - TỐI ĐA 100 KÝ TỰ)</label>
              ${isMe ? `
                <textarea id="profile-bio-input" class="cyber-input" style="resize:none; height:70px; font-family:var(--font-body);" placeholder="Nhập tiểu sử mạng lưới của bạn..." maxlength="100">${profileData.bio || ''}</textarea>
              ` : `
                <div class="cyber-input" style="height:auto; min-height:50px; background:rgba(0,0,0,0.2); font-family:var(--font-body); white-space:pre-wrap;">${profileData.bio || 'Chưa cấu hình tiểu sử...'}</div>
              `}
            </div>

            <div class="profile-field" style="margin-top: 5px; font-family:var(--font-tech); font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
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
        internalOverlay.onclick = function(e) {
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
        img.onclick = function(e) { e.stopPropagation(); };
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