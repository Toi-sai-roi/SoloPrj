// =========================================================================
// chat.js — Version 3.5 (Unread Notification + Reply/Quote + Delete + Pin + Search + Wallpaper + Animation)
// WebSocket + Chat Room logic + Reactions + Typing + Read Receipt + Block Check + Unread Counts
// =========================================================================

let typingTimeout = null;
let currentReactionMessageId = null;

// Helper: Lấy top 3 reactions mới nhất (giống Zalo)
function getTopReactions(reactionMap, reactionTimestamps = {}) {
  if (!reactionMap || Object.keys(reactionMap).length === 0) return [];

  const values = Object.values(reactionMap);
  const isAggregated = typeof values[0] === 'number';

  const emojiStats = {};

  if (isAggregated) {
    for (const [emoji, count] of Object.entries(reactionMap)) {
      emojiStats[emoji] = { count: Number(count), lastTimestamp: parseInt(reactionTimestamps[emoji]) || 0 };
    }
  } else {
    for (const [userId, emoji] of Object.entries(reactionMap)) {
      if (!emojiStats[emoji]) emojiStats[emoji] = { count: 0, lastTimestamp: 0 };
      emojiStats[emoji].count++;
      const ts = parseInt(reactionTimestamps[userId]) || 0;
      if (ts > emojiStats[emoji].lastTimestamp) emojiStats[emoji].lastTimestamp = ts;
    }
  }

  return Object.entries(emojiStats)
    .sort((a, b) => b[1].lastTimestamp - a[1].lastTimestamp)
    .slice(0, 3)
    .map(([emoji, stats]) => ({ emoji, count: stats.count }));
}

// 🔥 TÍCH HỢP VỊ TRÍ 1: Hàm kiểm tra trạng thái quan hệ song phương và khóa/mở khóa ô chat
async function checkChatLockState(targetUser) {
  try {
    const res = await fetch(`/api/friends/status/${encodeURIComponent(targetUser)}`, {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return;
      throw new Error('Failed');
    }
    const relData = await res.json();
    const inputField = document.getElementById('chat-input-field');
    const sendBtn = document.getElementById('chat-send-btn');

    if (inputField) {
      if (relData.relation === 'blocking') {
        inputField.disabled = true;
        inputField.placeholder = "BẠN ĐÃ KHÓA KẾT NỐI VỚI NODE NÀY. HÃY MỞ CHẶN ĐỂ GIAO TIẾP.";
        inputField.value = "";
        if (sendBtn) sendBtn.disabled = true;
      } else if (relData.relation === 'blocked_by') {
        inputField.disabled = true;
        inputField.placeholder = "NODE NÀY ĐÃ NGẮT KẾT NỐI ĐẾN BẠN [ACCESS_DENIED]...";
        inputField.value = "";
        if (sendBtn) sendBtn.disabled = true;
      } else {
        inputField.disabled = false;
        inputField.placeholder = "ENTER MESSAGE...";
        if (sendBtn) sendBtn.disabled = false;
      }
    }
  } catch (err) {
    console.error("❌ Lỗi kiểm tra cấu trúc khóa mạng lưới chat:", err);
  }
}

function initWebSocket() {
  if (AppState.ws) AppState.ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  AppState.ws = new WebSocket(`${protocol}//${window.location.host}?token=${AppState.token}`);

  AppState.ws.onopen = () => console.log('[WS Connected]');

  AppState.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 🔥 DEBUG: Log all WS messages
      if (data.type !== 'typing' && data.type !== 'group_typing') {
        console.log('[WS RECEIVED]', data.type, data);
      }

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

        case 'network_update': {
          const targetUser = data.sender;
          const actionType = data.action;
          const idx = AppState.usersData.findIndex(u => u.username === targetUser);

          if (idx !== -1) {
            console.log(`[WS NETWORK]: Nhận tín hiệu tương tác từ ${targetUser} -> Action: ${actionType}`);

            if (actionType === 'add') {
              AppState.usersData[idx].relation = 'pending_received';
            }
            else if (actionType === 'accept') {
              AppState.usersData[idx].relation = 'friend';
            }
            else if (actionType === 'cancel') {
              AppState.usersData[idx].relation = 'none';
            }

            if (typeof renderUsersList === 'function') {
              renderUsersList();
            }

            if (actionType === 'add' && typeof glowNotification === 'function') {
              glowNotification(targetUser);
            }
          }
          break;
        }

        case 'system': {
          if (data.text.includes('ACCESS_DENIED')) {
            appendSystemMessage(data.text);
            const inputField = document.getElementById('chat-input-field');
            const sendBtn = document.getElementById('chat-send-btn');
            if (inputField) {
              inputField.disabled = true;
              inputField.placeholder = "BẠN ĐÃ BỊ CHẶN KẾT NỐI ĐẾN NODE NÀY...";
              inputField.value = "";
            }
            if (sendBtn) sendBtn.disabled = true;
          } else {
            if (AppState.activeChatPartner && data.text.includes(AppState.activeChatPartner)) {
              appendSystemMessage(data.text);
            }
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

        // 🔥 UNREAD COUNTS FROM SERVER
        case 'unread_counts': {
          console.log('[UNREAD] Received counts:', data.counts);
          AppState.unreadCounts = data.counts || {};
          console.log('[UNREAD] AppState.unreadCounts now:', AppState.unreadCounts);
          if (typeof renderUsersList === 'function') {
            renderUsersList();
            console.log('[UNREAD] renderUsersList() called');
          }
          break;
        }

        case 'message': {
          const isFromPartner = data.sender === AppState.activeChatPartner;
          const isToPartner = data.receiver === AppState.activeChatPartner;

          if (isFromPartner || isToPartner) {
            appendChatMessage(data);
            if (isFromPartner && AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
              AppState.ws.send(JSON.stringify({ type: 'get_history', with: AppState.activeChatPartner }));
            }
          } else {
            // Message from someone else while not in their chat
            console.log('[UNREAD] New message from', data.sender, '- not active chat');
            if (!AppState.unreadCounts[data.sender]) {
              AppState.unreadCounts[data.sender] = 0;
            }
            AppState.unreadCounts[data.sender]++;
            console.log('[UNREAD] Updated counts:', AppState.unreadCounts);
            if (typeof renderUsersList === 'function') {
              renderUsersList();
            }
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

        case 'group_history': {
          if (AppState.activeGroup === data.groupId) {
            const area = document.getElementById('group-messages-area');
            if (area) {
              area.innerHTML = '';
              data.messages.forEach(msg => appendGroupMessage(msg));
              area.scrollTop = area.scrollHeight;
            }
          }
          break;
        }

        case 'group_message': {
          if (AppState.activeGroup === data.groupId) {
            appendGroupMessage(data);
          } else {
            if (typeof loadAndRenderGroups === 'function' && AppState.currentUsersTab === 'groups') {
              loadAndRenderGroups();
            }
          }
          break;
        }

        case 'group_typing': {
          if (AppState.activeGroup === data.groupId) {
            const indicator = document.getElementById('group-typing-indicator');
            if (indicator) {
              if (data.isTyping) {
                indicator.textContent = `${data.sender.toUpperCase()} ĐANG GÕ...`;
                indicator.style.display = 'block';
                if (window.groupTypingHideTimeout) clearTimeout(window.groupTypingHideTimeout);
                window.groupTypingHideTimeout = setTimeout(() => { indicator.style.display = 'none'; }, 3000);
              } else {
                indicator.style.display = 'none';
              }
            }
          }
          break;
        }

        case 'group_reaction_update': {
          if (AppState.activeGroup === data.groupId) {
            updateGroupMessageReaction(data.messageId, data.reactions);
          }
          break;
        }

        case 'group_invite': {
          if (confirm(`Bạn được mời vào nhóm "${data.groupName}" bởi ${data.invitedBy}. Mở chat nhóm ngay?`)) {
            openGroupChat(data.groupId);
          }
          if (AppState.currentUsersTab === 'groups' && typeof loadAndRenderGroups === 'function') {
            loadAndRenderGroups();
          }
          break;
        }

        case 'group_kicked': {
          if (AppState.activeGroup === data.groupId) {
            alert('Bạn đã bị kick khỏi nhóm này.');
            exitGroupChat();
          }
          if (AppState.currentUsersTab === 'groups' && typeof loadAndRenderGroups === 'function') {
            loadAndRenderGroups();
          }
          break;
        }

        case 'group_deleted': {
          if (AppState.activeGroup === data.groupId) {
            alert('Nhóm này đã bị xóa bởi creator.');
            exitGroupChat();
          }
          if (AppState.currentUsersTab === 'groups' && typeof loadAndRenderGroups === 'function') {
            loadAndRenderGroups();
          }
          break;
        }

        case 'group_member_joined':
        case 'group_member_left':
        case 'group_updated': {
          if (AppState.activeGroup === data.groupId) {
            const metaEl = document.getElementById('group-chat-meta');
            fetch(`/api/groups/${data.groupId}`, {
              headers: { 'Authorization': `Bearer ${AppState.token}` }
            }).then(r => {
              if (!r.ok) {
                if (r.status === 401 || r.status === 403) return null;
                throw new Error('Failed');
              }
              return r.json();
            }).then(group => {
              if (group && metaEl) metaEl.textContent = `${group.members.length} NODES`;
              if (group) AppState.activeGroupData = group;
            }).catch(() => { });
          }
          if (AppState.currentUsersTab === 'groups' && typeof loadAndRenderGroups === 'function') {
            loadAndRenderGroups();
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
  const pickerWidth = 360;

  picker.style.position = 'fixed';
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

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

  const msgBubble = messageDiv.querySelector('.msg-bubble');
  if (!msgBubble) return;

  let reactionsRow = msgBubble.querySelector('.reactions-row');
  if (!reactionsRow) {
    reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions-row';
    msgBubble.appendChild(reactionsRow);
  }

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
  checkChatLockState(username);
}

// --- Media Attachment ---

function triggerMediaInput() {
  document.getElementById('media-input').click();
}

async function handleMediaSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const MAX_SIZE = 8 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    alert('LỖI MẠNG LƯỚI: Kích thước file vượt quá giới hạn cho phép (8MB).');
    clearMediaSelection();
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AppState.token}` },
      body: formData
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return;
      throw new Error('Upload failed');
    }
    const data = await res.json();

    AppState.selectedMedia = data.url;
    AppState.selectedMediaType = file.type;
    AppState.selectedMediaName = file.name;

    const previewContainer = document.getElementById('media-preview-container');
    const previewWrapper = document.getElementById('media-preview-wrapper');
    const previewName = document.getElementById('media-preview-name');
    const previewSize = document.getElementById('media-preview-size');

    previewName.textContent = file.name.toUpperCase();
    previewSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;

    previewWrapper.innerHTML = '';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = data.url;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      previewWrapper.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      previewWrapper.innerHTML = '<span style="font-size: 20px;">🎥</span>';
    }

    previewContainer.style.display = 'flex';
    scrollToBottom();

  } catch (err) {
    console.error('Upload error:', err);
    alert('Không thể upload file. Vui lòng thử lại.');
    clearMediaSelection();
  }
}

function handleSendMessage(e) {
  e.preventDefault();
  const field = document.getElementById('chat-input-field');
  const text = field.value.trim();

  if (!AppState.activeChatPartner) return;
  if (!text && !AppState.selectedMedia) return;

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    if (AppState.selectedMedia) {
      console.log('Sending media:', AppState.selectedMedia);
      AppState.ws.send(JSON.stringify({
        type: 'send_message',
        to: AppState.activeChatPartner,
        text: text || '',
        media_url: AppState.selectedMedia
      }));
      clearMediaSelection();
    } else if (text) {
      AppState.ws.send(JSON.stringify({
        type: 'send_message',
        to: AppState.activeChatPartner,
        text: text
      }));
    }

    field.value = '';
    field.focus();
    sendTypingStop();
    if (typingTimeout) clearTimeout(typingTimeout);
  }
}

// --- Render Helpers ---

function appendChatMessage(msg) {
  const messagesArea = document.getElementById('messages-area');
  if (!messagesArea) {
    console.error('messages-area not found!');
    return;
  }

  const blankState = messagesArea.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const isSelf = msg.sender === AppState.currentUser || msg.self;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'}`;
  wrapper.setAttribute('data-message-id', msg.id);

  let bubbleContent = '';

  if (msg.media_url && msg.media_url.trim() !== '') {
    if (msg.media_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || msg.media_url.startsWith('data:image/')) {
      bubbleContent = `<img src="${msg.media_url}" class="chat-media-img" onclick="openLightbox(this.src)" title="Nhấp để phóng to" alt="Ảnh đính kèm">`;
    } else if (msg.media_url.match(/\.(mp4|webm|mov)$/i) || msg.media_url.startsWith('data:video/')) {
      bubbleContent = `<video src="${msg.media_url}" controls class="chat-media-vid"></video>`;
    } else {
      const filename = msg.media_url.split('/').pop();
      bubbleContent = `<a href="${msg.media_url}" download="${filename}" class="chat-file-link">📎 ${filename}</a>`;
    }
  } else if (msg.text && msg.text.startsWith('data:')) {
    if (msg.text.startsWith('data:image/')) {
      bubbleContent = `<img src="${msg.text}" class="chat-media-img" onclick="openLightbox(this.src)" title="Nhấp để phóng to" alt="Ảnh đính kèm">`;
    } else if (msg.text.startsWith('data:video/')) {
      bubbleContent = `<video src="${msg.text}" controls class="chat-media-vid"></video>`;
    } else {
      bubbleContent = `<a href="${msg.text}" download="file" class="chat-file-link">📎 Tải file</a>`;
    }
  } else {
    bubbleContent = escapeHTML(msg.text || '');
  }

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

function openLightbox(src) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  if (!overlay || !img) return;

  img.src = src;
  overlay.style.display = 'flex';
  overlay.style.zIndex = '99999999';

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