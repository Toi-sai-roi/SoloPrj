// ==========================================
// chat.js — WebSocket + Chat Room logic
// ==========================================

let typingTimeout = null;

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
            loadUsers();
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

        case 'typing': {
          if (data.sender === AppState.activeChatPartner) {
            if (data.isTyping) {
              showTypingIndicator();
              if (window.typingHideTimeout) clearTimeout(window.typingHideTimeout);
              window.typingHideTimeout = setTimeout(() => hideTypingIndicator(), 3000);
            } else {
              hideTypingIndicator();
              if (window.typingHideTimeout) clearTimeout(window.typingHideTimeout);
            }
          }
          break;
        }

        case 'delivered_receipt': {
          if (data.to === AppState.currentUser) {
            updateMessageStatus(data.messageId, 'delivered');
          }
          break;
        }

        case 'read_receipt': {
          if (data.reader === AppState.activeChatPartner) {
            updateAllMessagesStatus('read');
          }
          break;
        }

        case 'message': {
          const isFromPartner = data.sender === AppState.activeChatPartner;
          const isToPartner = data.receiver === AppState.activeChatPartner;
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
    if (AppState.token) setTimeout(initWebSocket, 5000);
  };

  AppState.ws.onerror = (err) => console.error('[WS Error]', err);
}

// --- Typing Indicator Functions ---

function sendTypingStart() {
  if (!AppState.activeChatPartner) return;
  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({
      type: 'typing',
      to: AppState.activeChatPartner,
      isTyping: true
    }));
  }
}

function sendTypingStop() {
  if (!AppState.activeChatPartner) return;
  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({
      type: 'typing',
      to: AppState.activeChatPartner,
      isTyping: false
    }));
  }
}

function showTypingIndicator() {
  const statusText = document.getElementById('chat-partner-status-text');
  if (!statusText) return;
  if (!statusText.dataset.originalText) {
    statusText.dataset.originalText = statusText.textContent;
  }
  statusText.innerHTML = 'ĐANG GÕ <span style="display: inline-flex; gap: 2px;">.<span>.</span><span>.</span></span>';
  statusText.style.color = 'var(--neon-cyan)';
  statusText.style.textShadow = '0 0 5px var(--neon-cyan)';
}

function hideTypingIndicator() {
  const statusText = document.getElementById('chat-partner-status-text');
  if (!statusText) return;
  const originalText = statusText.dataset.originalText;
  const dot = document.getElementById('chat-partner-status-dot');
  const isOnline = dot && dot.classList.contains('online');
  if (originalText) {
    statusText.textContent = originalText;
    statusText.style.color = isOnline ? 'var(--neon-green)' : 'var(--text-muted)';
    statusText.style.textShadow = isOnline ? '0 0 5px rgba(57, 255, 20, 0.4)' : 'none';
  }
}

// --- Read Receipt Functions ---

function updateMessageStatus(messageId, status) {
  const messageElements = document.querySelectorAll(`.msg-wrapper`);
  for (let el of messageElements) {
    const statusSpan = el.querySelector('.msg-status');
    if (statusSpan && statusSpan.dataset.id == messageId) {
      if (status === 'delivered') {
        statusSpan.textContent = '✓✓';
        statusSpan.className = 'msg-status delivered';
      } else if (status === 'read') {
        statusSpan.textContent = '✓✓💙';
        statusSpan.className = 'msg-status read';
      }
      break;
    }
  }
}

function updateAllMessagesStatus(status) {
  const messageElements = document.querySelectorAll(`.msg-wrapper.self .msg-status`);
  messageElements.forEach(el => {
    if (status === 'read') {
      el.textContent = '✓✓💙';
      el.className = 'msg-status read';
    }
  });
}

// --- Chat Room Functions ---

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
  
  hideTypingIndicator();
}

function updateChatPartnerStatus(isOnline) {
  const dot = document.getElementById('chat-partner-status-dot');
  const text = document.getElementById('chat-partner-status-text');
  if (isOnline) {
    dot.className = 'status-dot online';
    if (text.dataset.originalText) delete text.dataset.originalText;
    text.textContent = 'ONLINE';
    text.style.color = 'var(--neon-green)';
    text.style.textShadow = '0 0 5px rgba(57, 255, 20, 0.4)';
  } else {
    dot.className = 'status-dot offline';
    if (text.dataset.originalText) delete text.dataset.originalText;
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

// --- Media Attachment ---

function triggerMediaInput() {
  document.getElementById('media-input').click();
}

function handleMediaSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const MAX_SIZE = 8 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    alert('LỖI MẠNG LƯỚI: Kích thước file vượt quá giới hạn cho phép (8MB).');
    clearMediaSelection();
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    AppState.selectedMedia = e.target.result;
    AppState.selectedMediaType = file.type;

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
  const text = field.value.trim();
  
  if (!AppState.activeChatPartner) return;
  if (!text && !AppState.selectedMedia) return;

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    if (AppState.selectedMedia) {
      AppState.ws.send(JSON.stringify({ 
        type: 'send_message', 
        to: AppState.activeChatPartner, 
        text: AppState.selectedMedia 
      }));
      clearMediaSelection();
    }

    if (text) {
      AppState.ws.send(JSON.stringify({ 
        type: 'send_message', 
        to: AppState.activeChatPartner, 
        text: text 
      }));
      field.value = '';
      field.focus();
      sendTypingStop();
      if (typingTimeout) clearTimeout(typingTimeout);
    }
  } else {
    alert('Kênh WebSocket đã bị ngắt kết nối. Đang thử kết nối lại...');
  }
}

// --- Render Helpers ---

function appendChatMessage(msg) {
  const messagesArea = document.getElementById('messages-area');
  const blankState = messagesArea.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const isSelf = msg.sender === AppState.currentUser || msg.self;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'}`;

  let bubbleContent = '';
  if (msg.text && msg.text.startsWith('data:image/')) {
    bubbleContent = `<img src="${msg.text}" class="chat-media-img" onclick="openLightbox(this.src)" title="Nhấp để phóng to ảnh trực tiếp trong ứng dụng" alt="Ảnh đính kèm">`;
  } else if (msg.text && msg.text.startsWith('data:video/')) {
    bubbleContent = `<video src="${msg.text}" controls class="chat-media-vid"></video>`;
  } else {
    bubbleContent = escapeHTML(msg.text || '');
  }

  // Read receipt status
  let statusIcon = '';
  if (isSelf) {
    if (msg.read_at) {
      statusIcon = '<span class="msg-status read" data-id="' + msg.id + '">✓✓💙</span>';
    } else if (msg.delivered) {
      statusIcon = '<span class="msg-status delivered" data-id="' + msg.id + '">✓✓</span>';
    } else {
      statusIcon = '<span class="msg-status sent" data-id="' + msg.id + '">✓</span>';
    }
  }

  wrapper.innerHTML = `
    <div class="msg-sender">${msg.sender}</div>
    <div class="msg-bubble">${bubbleContent}${statusIcon}</div>
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

// --- Lightbox ---

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

// --- Typing Event Listener ---

document.addEventListener('DOMContentLoaded', () => {
  const inputField = document.getElementById('chat-input-field');
  if (inputField) {
    inputField.addEventListener('input', () => {
      if (!AppState.activeChatPartner) return;
      
      if (inputField.value.length > 0) {
        sendTypingStart();
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => sendTypingStop(), 1500);
      } else {
        sendTypingStop();
        if (typingTimeout) clearTimeout(typingTimeout);
      }
    });
  }
});