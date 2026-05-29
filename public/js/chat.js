// ==========================================
// chat.js — WebSocket + Chat Room logic
// ==========================================

function initWebSocket() {
  if (AppState.ws) AppState.ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  AppState.ws = new WebSocket(`${protocol}//${window.location.host}?token=${AppState.token}`);

  AppState.ws.onopen = () => console.log('[WS Connected]');

  AppState.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {

        case 'status_change': {
          const idx = AppState.usersData.findIndex(u => u.username === data.username);
          if (idx !== -1) {
            AppState.usersData[idx].online = data.online;
            renderUsersList();
          } else {
            loadUsers(); // user mới đăng ký
          }
          if (AppState.activeChatPartner === data.username) {
            updateChatPartnerStatus(data.online);
          }
          break;
        }

        case 'system': {
          if (AppState.activeChatPartner) appendSystemMessage(data.text);
          break;
        }

        case 'message': {
          const isFromPartner = data.sender === AppState.activeChatPartner;
          const isToPartner   = data.receiver === AppState.activeChatPartner;
          if (isFromPartner || isToPartner) {
            appendChatMessage(data);
          } else {
            glowNotification(data.sender);
          }
          break;
        }

        case 'history': {
          if (AppState.activeChatPartner === data.with) {
            const messagesArea = document.getElementById('messages-area');
            messagesArea.innerHTML = '';
            data.messages.forEach(msg => appendChatMessage(msg));
            scrollToBottom();
          }
          break;
        }
      }
    } catch (err) {
      console.error('[WS Message Error]', err);
    }
  };

  AppState.ws.onclose = () => {
    console.log('[WS Disconnected]');
    if (AppState.token) setTimeout(initWebSocket, 5000); // auto-reconnect
  };

  AppState.ws.onerror = (err) => console.error('[WS Error]', err);
}

// --- Chat Room ---

function openChatWith(username) {
  AppState.activeChatPartner = username;

  document.getElementById('chat-partner-name').textContent = `CHAT WITH // ${username.toUpperCase()}`;
  document.getElementById('chat-partner-avatar').textContent = username.charAt(0).toUpperCase();

  const partner = AppState.usersData.find(u => u.username === username);
  updateChatPartnerStatus(partner ? partner.online : false);

  document.getElementById('messages-area').innerHTML =
    '<div class="blank-state">ĐANG KẾT NỐI VÀ TẢI LỊCH SỬ TIN NHẮN...</div>';

  showScreen('chat-screen');

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({ type: 'get_history', with: username }));
  }
}

function updateChatPartnerStatus(isOnline) {
  const dot  = document.getElementById('chat-partner-status-dot');
  const text = document.getElementById('chat-partner-status-text');
  if (isOnline) {
    dot.className = 'status-dot online';
    text.textContent = 'ONLINE';
    text.style.color = 'var(--neon-green)';
    text.style.textShadow = '0 0 5px rgba(57, 255, 20, 0.4)';
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'OFFLINE';
    text.style.color = 'var(--text-muted)';
    text.style.textShadow = 'none';
  }
}

function exitChat() {
  AppState.activeChatPartner = null;
  showScreen('home-screen');
  loadUsers();
}

// --- Xử lý đính kèm ảnh/video ---

function triggerMediaInput() {
  document.getElementById('media-input').click();
}

function handleMediaSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Giới hạn kích thước file 8MB để tránh nghẽn WebSocket
  const MAX_SIZE = 8 * 1024 * 1024; // 8MB
  if (file.size > MAX_SIZE) {
    alert('LỖI MẠNG LƯỚI: Kích thước file vượt quá giới hạn cho phép (8MB).');
    clearMediaSelection();
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    AppState.selectedMedia = e.target.result;
    AppState.selectedMediaType = file.type;

    // Cập nhật giao diện hộp xem trước
    const previewContainer = document.getElementById('media-preview-container');
    const previewWrapper = document.getElementById('media-preview-wrapper');
    const previewName = document.getElementById('media-preview-name');
    const previewSize = document.getElementById('media-preview-size');

    previewName.textContent = file.name.toUpperCase();
    previewSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;

    previewWrapper.innerHTML = '';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      previewWrapper.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      previewWrapper.innerHTML = '<span style="font-size: 20px;">🎥</span>';
    }

    previewContainer.style.display = 'flex';
    scrollToBottom();
  };

  reader.readAsDataURL(file);
}

function clearMediaSelection() {
  AppState.selectedMedia = null;
  AppState.selectedMediaType = null;
  document.getElementById('media-input').value = '';
  document.getElementById('media-preview-container').style.display = 'none';
}

function handleSendMessage(e) {
  e.preventDefault();
  const field = document.getElementById('chat-input-field');
  const text  = field.value.trim();
  
  if (!AppState.activeChatPartner) return;
  if (!text && !AppState.selectedMedia) return;

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    // 1. Gửi tệp tin đính kèm trước (nếu có)
    if (AppState.selectedMedia) {
      AppState.ws.send(JSON.stringify({ 
        type: 'send_message', 
        to: AppState.activeChatPartner, 
        text: AppState.selectedMedia 
      }));
      clearMediaSelection();
    }

    // 2. Gửi tin nhắn văn bản đi kèm sau (nếu có)
    if (text) {
      AppState.ws.send(JSON.stringify({ 
        type: 'send_message', 
        to: AppState.activeChatPartner, 
        text: text 
      }));
      field.value = '';
      field.focus();
    }
  } else {
    alert('Kênh WebSocket đã bị ngắt kết nối. Đang thử kết nối lại...');
  }
}

// --- Render helpers ---

function appendChatMessage(msg) {
  const messagesArea = document.getElementById('messages-area');
  const blankState = messagesArea.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const isSelf = msg.sender === AppState.currentUser || msg.self;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'}`;

  // Kiểm tra xem tin nhắn là text hay file Base64 đính kèm
  let bubbleContent = '';
  if (msg.text.startsWith('data:image/')) {
    bubbleContent = `<img src="${msg.text}" class="chat-media-img" onclick="openLightbox(this.src)" title="Nhấp để phóng to ảnh trực tiếp trong ứng dụng" alt="Ảnh đính kèm">`;
  } else if (msg.text.startsWith('data:video/')) {
    bubbleContent = `<video src="${msg.text}" controls class="chat-media-vid"></video>`;
  } else {
    bubbleContent = escapeHTML(msg.text);
  }

  wrapper.innerHTML = `
    <div class="msg-sender">${msg.sender}</div>
    <div class="msg-bubble">${bubbleContent}</div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
  `;
  messagesArea.appendChild(wrapper);
  scrollToBottom();
}

function appendSystemMessage(text) {
  const messagesArea = document.getElementById('messages-area');
  const blankState = messagesArea.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const el = document.createElement('div');
  el.className = 'msg-system';
  el.innerHTML = `[ SYSTEM // ${escapeHTML(text)} ]`;
  messagesArea.appendChild(el);
  scrollToBottom();
}

// --- Xử lý phóng to ảnh (Lightbox) ---

function openLightbox(src) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  overlay.style.display = 'flex';
  setTimeout(() => {
    img.style.transform = 'scale(1)';
  }, 50);
}

function closeLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  img.style.transform = 'scale(0.9)';
  setTimeout(() => {
    overlay.style.display = 'none';
    img.src = '';
  }, 200);
}