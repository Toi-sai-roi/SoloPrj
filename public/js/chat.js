// ==========================================
// chat.js — Version 3.4 Production Ready (Optimized)
// WebSocket + Chat Room logic + Reactions + Typing + Read Receipt
// ==========================================

let typingTimeout = null;
let currentReactionMessageId = null;

// Helper: Lấy top 3 reactions mới nhất (giống Zalo)
function getTopReactions(reactionMap, reactionTimestamps = {}) {
  const emojiStats = {};
  for (const [userId, emoji] of Object.entries(reactionMap)) {
    if (!emojiStats[emoji]) {
      emojiStats[emoji] = { count: 0, lastTimestamp: 0 };
    }
    emojiStats[emoji].count++;

    // Khắc phục hạt sạn #1: Ép kiểu hẳn hoi để tránh lỗi so sánh String từ SQLite
    const ts = parseInt(reactionTimestamps[userId]) || 0;
    if (ts > emojiStats[emoji].lastTimestamp) {
      emojiStats[emoji].lastTimestamp = ts;
    }
  }

  const sorted = Object.entries(reactionMap)
    .map(([emoji, count]) => ({
      emoji,
      count: Number(count),
      lastTimestamp: parseInt(reactionTimestamps[emoji]) || 0
    }))
    // Ưu tiên các emoji vừa mới được thả lên trên đầu danh sách hiển thị
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, 3); // Lấy tối đa top 3 loại emoji xuất hiện gần nhất

  return sorted.map(item => ({ emoji: item.emoji, count: item.count }));
}

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
          // Khắc phục hạt sạn #3: Chỉ hiện thông báo hệ thống nếu liên quan đến người đang chat trực tiếp
          if (AppState.activeChatPartner && data.text.includes(AppState.activeChatPartner)) {
            appendSystemMessage(data.text);
          }
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

        case 'reaction_update': {
          updateMessageReaction(data.messageId, data.reactions, data.reactionTimestamps);
          break;
        }

        case 'message': {
          const isFromPartner = data.sender === AppState.activeChatPartner;
          const isToPartner = data.receiver === AppState.activeChatPartner;
          if (isFromPartner || isToPartner) {
            appendChatMessage(data);

            // Khắc phục hạt sạn #4 (Tối ưu): Nếu nhận được tin nhắn từ đối phương khi đang mở sẵn khung chat, 
            // tự động phát tín hiệu 'get_history' để kích hoạt read receipt báo cho họ biết mình đã đọc ngay lập tức.
            if (isFromPartner && AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
              AppState.ws.send(JSON.stringify({ type: 'get_history', with: AppState.activeChatPartner }));
            }
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

// --- Reaction Functions (Zalo style) ---

function showReactionPicker(messageId, event) {
  event.stopPropagation();
  currentReactionMessageId = messageId;

  const oldPicker = document.querySelector('.reaction-picker');
  if (oldPicker) oldPicker.remove();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = `
    <div class="reaction-option" data-emoji="👍">👍</div>
    <div class="reaction-option" data-emoji="❤️">❤️</div>
    <div class="reaction-option" data-emoji="😂">😂</div>
    <div class="reaction-option" data-emoji="😮">😮</div>
    <div class="reaction-option" data-emoji="😢">😢</div>
    <div class="reaction-option" data-emoji="😡">😡</div>
    <div class="reaction-option" data-emoji="🎉">🎉</div>
    <div class="reaction-option" data-emoji="🔥">🔥</div>
  `;

  const rect = event.target.getBoundingClientRect();
  const pickerWidth = 360; // Chiều rộng ước tính tối đa của picker chứa 8 emoji

  picker.style.position = 'fixed';
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

  // THUẬT TOÁN ĐẨY TRÁI (IN-SCREEN): Nếu mút bên phải vượt quá màn hình, neo lề theo bên phải của nút 😊
  if (rect.left + pickerWidth > window.innerWidth) {
    picker.style.right = (window.innerWidth - rect.right - 10) + 'px';
    picker.style.left = 'auto';
  } else {
    picker.style.left = (rect.left - 50) + 'px';
    picker.style.right = 'auto';
  }

  document.body.appendChild(picker);

  picker.querySelectorAll('.reaction-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = opt.dataset.emoji;
      addReaction(messageId, emoji);
      picker.remove();
    });
  });

  setTimeout(() => {
    const closePicker = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    };
    document.addEventListener('click', closePicker);
  }, 0);
}

function addReaction(messageId, emoji) {
  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({
      type: 'add_reaction',
      messageId: messageId,
      emoji: emoji
    }));
  }
}

function updateMessageReaction(messageId, reactionMapRaw, reactionTimestampsRaw) {
  const messageDiv = document.querySelector(`.msg-wrapper[data-message-id="${messageId}"]`);
  if (!messageDiv) return;

  // TÌM HOẶC TẠO LẠI KHUNG CHỨA REACTION BÊN TRONG BONG BÓNG CHAT
  const msgBubble = messageDiv.querySelector('.msg-bubble');
  if (!msgBubble) return; // Phòng hờ lỗi cấu trúc HTML không tìm thấy bubble

  let reactionsRow = msgBubble.querySelector('.reactions-row');
  if (!reactionsRow) {
    reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions-row';
    msgBubble.appendChild(reactionsRow); // Luôn chèn vào cuối thẻ .msg-bubble để đúng cấu trúc khi F5
  }

  // Chuẩn hóa dữ liệu đầu vào trước khi đếm top reaction
  const reactionMap = typeof reactionMapRaw === 'string' ? JSON.parse(reactionMapRaw) : (reactionMapRaw || {});
  const reactionTimestamps = typeof reactionTimestampsRaw === 'string' ? JSON.parse(reactionTimestampsRaw) : (reactionTimestampsRaw || {});
  const topReactions = getTopReactions(reactionMap, reactionTimestamps);

  if (topReactions.length === 0) {
    reactionsRow.remove();
    return;
  }

  reactionsRow.innerHTML = '';
  for (const { emoji, count } of topReactions) {
    const badge = document.createElement('div');
    badge.className = 'reaction-badge';
    badge.setAttribute('data-emoji', emoji);
    badge.innerHTML = `
      <span class="reaction-emoji">${emoji}</span>
      <span class="reaction-count">${count}</span>
    `;
    badge.onclick = (e) => {
      e.stopPropagation();
      addReaction(messageId, emoji);
    };
    reactionsRow.appendChild(badge);
  }
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
  reader.onload = function (e) {
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
  wrapper.setAttribute('data-message-id', msg.id);

  let bubbleContent = '';
  if (msg.text && msg.text.startsWith('data:image/')) {
    bubbleContent = `<img src="${msg.text}" class="chat-media-img" onclick="openLightbox(this.src)" title="Nhấp để phóng to" alt="Ảnh đính kèm">`;
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

  // Ép kiểu bóc tách dữ liệu phản hồi an toàn
  let reactionMap = typeof msg.reactions === 'string' ? JSON.parse(msg.reactions) : (msg.reactions || {});
  let reactionTimestamps = typeof msg.reaction_timestamps === 'string' ? JSON.parse(msg.reaction_timestamps) : (msg.reaction_timestamps || {});

  let reactionsRowHtml = '';
  if (Object.keys(reactionMap).length > 0) {
    const topReactions = getTopReactions(reactionMap, reactionTimestamps);
    if (topReactions.length > 0) {
      reactionsRowHtml = '<div class="reactions-row">';
      for (const { emoji, count } of topReactions) {
        reactionsRowHtml += `
          <div class="reaction-badge" data-emoji="${emoji}" onclick="event.stopPropagation(); addReaction(${msg.id}, '${emoji}')">
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">${count}</span>
          </div>
        `;
      }
      reactionsRowHtml += '</div>';
    }
  }

  // Đưa nút 😊 ra hẳn ngoài cấu trúc để Flexbox của CSS tự động điều hướng trái/phải
  wrapper.innerHTML = `
    <div class="msg-sender">${msg.sender}</div>
    <div class="msg-content-node">
      <div class="reaction-trigger" onclick="event.stopPropagation(); showReactionPicker(${msg.id}, event)">😊</div>
      <div class="msg-bubble">
        <div class="msg-text-data">${bubbleContent}${statusIcon}</div>
        ${reactionsRowHtml}
      </div>
    </div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
  `;
  messagesArea.appendChild(wrapper);
  scrollToBottom();
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

function clearMediaSelection() {
  AppState.selectedMedia = null;
  AppState.selectedMediaType = null;
  document.getElementById('media-input').value = '';
  document.getElementById('media-preview-container').style.display = 'none';
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

// THAY THẾ TOÀN BỘ HÀM openLightbox TRONG FILE chat.js THÀNH ĐOẠN NÀY:
// THAY THẾ CHÍNH XÁC HÀM openLightbox TRONG FILE chat.js
function openLightbox(src) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  if (!overlay || !img) return;

  img.src = src;
  overlay.style.display = 'flex';

  // ÉP TẦNG MAX: Đè chặt lên trên cái Modal Bio (99999) để không bị ẩn phía dưới
  overlay.style.zIndex = '99999999';

  // Giữ tỉ lệ nguyên bản trọn vẹn 100% của ảnh gốc không mất góc
  img.style.objectFit = 'contain';
  img.style.width = 'auto';
  img.style.height = 'auto';
  img.style.maxWidth = '90vw';
  img.style.maxHeight = '90vh';

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