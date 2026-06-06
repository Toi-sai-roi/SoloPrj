// =========================================================================
// chat.js — v2.1-fix (Fixed: reply_info render, no auto get_history reload)
// =========================================================================

let typingTimeout = null;
let currentReactionMessageId = null;
let replyingTo = null;
let currentPinnedMessage = null;
let currentSearchResults = [];
let currentWallpaper = null;
let wallpaperOpacity = 15;

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
            if (actionType === 'add') AppState.usersData[idx].relation = 'pending_received';
            else if (actionType === 'accept') AppState.usersData[idx].relation = 'friend';
            else if (actionType === 'cancel') AppState.usersData[idx].relation = 'none';
            if (typeof renderUsersList === 'function') renderUsersList();
            if (actionType === 'add' && typeof glowNotification === 'function') glowNotification(targetUser);
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

        case 'unread_counts': {
          AppState.unreadCounts = data.counts || {};
          if (typeof renderUsersList === 'function') renderUsersList();
          break;
        }

        case 'message': {
          const isFromPartner = data.sender === AppState.activeChatPartner;
          const isToPartner = data.receiver === AppState.activeChatPartner;

          if (isFromPartner || isToPartner) {
            // 🔥 FIX: Just append the new message, DON'T reload entire history
            appendChatMessage(data);
            scrollToBottom();
          } else {
            // Message from someone else while not in their chat
            if (!AppState.unreadCounts[data.sender]) {
              AppState.unreadCounts[data.sender] = 0;
            }
            AppState.unreadCounts[data.sender]++;
            if (typeof renderUsersList === 'function') renderUsersList();
            glowNotification(data.sender);
          }
          break;
        }

        case 'message_deleted': {
          const msgEl = document.querySelector(`.msg-wrapper[data-message-id="${data.messageId}"]`);
          if (msgEl) {
            msgEl.classList.add('msg-deleted');
            const bubble = msgEl.querySelector('.msg-bubble');
            if (bubble) {
              bubble.innerHTML = '<div class="msg-text-data deleted-text">[TIN NHẮN ĐÃ BỊ XÓA]</div>';
            }
            const actions = msgEl.querySelector('.msg-actions');
            if (actions) actions.remove();
          }

          // 🔥 FIX: Nếu tin nhắn bị xóa đang là pinned thì ẩn pinned bar
          if (currentPinnedMessage && currentPinnedMessage.id == data.messageId) {
            hidePinnedBar();
          }
          break;
        }

        case 'pin_update': {
          const { conversation, pinned_message } = data;
          // Check if this pin update is for current conversation
          const isCurrentConvo =
            (conversation.user1 === AppState.currentUser && conversation.user2 === AppState.activeChatPartner) ||
            (conversation.user1 === AppState.activeChatPartner && conversation.user2 === AppState.currentUser);

          if (isCurrentConvo) {
            if (pinned_message) {
              showPinnedBar(pinned_message);
            } else {
              hidePinnedBar();
            }
          }
          break;
        }

        case 'search_results': {
          const { with: withUser, query, results } = data;
          if (withUser === AppState.activeChatPartner) {
            renderSearchResults(results, query);
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

// Reply functions
function startReply(messageId) {
  const msgEl = document.querySelector(`.msg-wrapper[data-message-id="${messageId}"]`);
  if (!msgEl) return;

  const sender = msgEl.querySelector('.msg-sender')?.textContent || '';
  const textEl = msgEl.querySelector('.msg-text-data');
  let text = '';

  if (textEl) {
    const clone = textEl.cloneNode(true);
    const statusSpan = clone.querySelector('.msg-status');
    if (statusSpan) statusSpan.remove();
    text = clone.textContent.trim();
  }

  replyingTo = { id: messageId, sender, text };
  showReplyIndicator();

  const inputField = document.getElementById('chat-input-field');
  if (inputField) inputField.focus();
}

function showReplyIndicator() {
  let indicator = document.getElementById('reply-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'reply-indicator';
    indicator.className = 'reply-indicator';
    const form = document.getElementById('chat-input-form');
    if (form) form.parentNode.insertBefore(indicator, form);
  }

  if (replyingTo) {
    indicator.innerHTML = `
      <span>↳ REPLYING TO // ${replyingTo.sender.toUpperCase()}: "${replyingTo.text.substring(0, 60)}${replyingTo.text.length > 60 ? '...' : ''}"</span>
      <span class="reply-cancel" onclick="cancelReply()">✕</span>
    `;
    indicator.style.display = 'flex';
  } else {
    indicator.style.display = 'none';
  }
}

function cancelReply() {
  replyingTo = null;
  const indicator = document.getElementById('reply-indicator');
  if (indicator) indicator.style.display = 'none';
}

function deleteMessage(messageId) {
  if (!confirm('XÓA TIN NHẮN? Hành động này không thể hoàn tác.')) return;

  if (currentPinnedMessage && currentPinnedMessage.id == messageId) {
    unpinCurrentMessage();
  }

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({
      type: 'delete_message',
      messageId: messageId
    }));
  }
}

function openChatWith(username) {
  AppState.activeChatPartner = username;
  cancelReply();

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
    const payload = {
      type: 'send_message',
      to: AppState.activeChatPartner,
      text: text || ''
    };

    if (AppState.selectedMedia) {
      payload.media_url = AppState.selectedMedia;
      clearMediaSelection();
    }

    if (replyingTo) {
      payload.reply_to = replyingTo.id;
      cancelReply();
    }

    AppState.ws.send(JSON.stringify(payload));

    field.value = '';
    field.focus();
    sendTypingStop();
    if (typingTimeout) clearTimeout(typingTimeout);
  }
}

function appendChatMessage(msg) {
  const messagesArea = document.getElementById('messages-area');
  if (!messagesArea) {
    console.error('messages-area not found!');
    return;
  }

  const blankState = messagesArea.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const isSelf = msg.sender === AppState.currentUser || msg.self;
  const isDeleted = msg.deleted_at || msg.text === '[TIN NHẮN ĐÃ BỊ XÓA]';
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'} ${isDeleted ? 'msg-deleted' : ''}`;
  wrapper.setAttribute('data-message-id', msg.id);

  let bubbleContent = '';

  if (isDeleted) {
    bubbleContent = '<span class="deleted-text">[TIN NHẮN ĐÃ BỊ XÓA]</span>';
  } else if (msg.media_url && msg.media_url.trim() !== '') {
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
  if (isSelf && !isDeleted) {
    if (msg.read_at) {
      statusIcon = '<span class="msg-status read" data-id="' + msg.id + '">✓✓💙</span>';
    } else if (msg.delivered) {
      statusIcon = '<span class="msg-status delivered" data-id="' + msg.id + '">✓✓</span>';
    } else {
      statusIcon = '<span class="msg-status sent" data-id="' + msg.id + '">✓</span>';
    }
  }

  // Reply quote block
  let replyHtml = '';
  if (msg.reply_to && msg.reply_info && !isDeleted) {
    const replyInfo = typeof msg.reply_info === 'string' ? JSON.parse(msg.reply_info) : msg.reply_info;
    if (replyInfo) {
      replyHtml = `
        <div class="msg-reply-quote" onclick="scrollToMessage(${replyInfo.id})">
          <div class="reply-sender">↳ ${replyInfo.sender}</div>
          <div class="reply-text">${escapeHTML(replyInfo.text || '[Không có nội dung]')}</div>
        </div>
      `;
    }
  }

  let reactionMap = typeof msg.reactions === 'string' ? JSON.parse(msg.reactions) : (msg.reactions || {});
  let reactionTimestamps = typeof msg.reaction_timestamps === 'string' ? JSON.parse(msg.reaction_timestamps) : (msg.reaction_timestamps || {});

  let reactionsRowHtml = '';
  if (Object.keys(reactionMap).length > 0 && !isDeleted) {
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

  let actionButtonsHtml = '';
  if (isSelf && !isDeleted) {
    actionButtonsHtml = `
    <div class="msg-actions" style="display:flex;gap:4px;align-items:center;">
      <button class="msg-action-btn reply-btn" onclick="event.stopPropagation(); startReply(${msg.id})" style="display:inline-flex;align-items:center;gap:4px;">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
        REPLY
      </button>
      <button class="msg-action-btn pin-btn" onclick="event.stopPropagation(); pinMessage(${msg.id})" style="display:inline-flex;align-items:center;gap:4px;">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        PIN
      </button>
      <button class="msg-action-btn delete-btn" onclick="event.stopPropagation(); deleteMessage(${msg.id})" style="display:inline-flex;align-items:center;gap:4px;">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        DELETE
      </button>
    </div>
  `;
  } else if (!isSelf && !isDeleted) {
    actionButtonsHtml = `
    <div class="msg-actions" style="display:flex;gap:4px;align-items:center;">
      <button class="msg-action-btn reply-btn" onclick="event.stopPropagation(); startReply(${msg.id})" style="display:inline-flex;align-items:center;gap:4px;">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
        REPLY
      </button>
      <button class="msg-action-btn pin-btn" onclick="event.stopPropagation(); pinMessage(${msg.id})" style="display:inline-flex;align-items:center;gap:4px;">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        PIN
      </button>
    </div>
  `;
  }

  wrapper.innerHTML = `
    ${actionButtonsHtml}
    <div class="msg-sender">${msg.sender}</div>
    <div class="msg-content-node">
      <div class="reaction-trigger" onclick="event.stopPropagation(); showReactionPicker(${msg.id}, event)">😊</div>
      <div class="msg-bubble">
        ${replyHtml}
        <div class="msg-text-data">${bubbleContent}${statusIcon}</div>
        ${reactionsRowHtml}
      </div>
    </div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
  `;
  messagesArea.appendChild(wrapper);
}

function scrollToMessage(messageId) {
  const msgEl = document.querySelector(`.msg-wrapper[data-message-id="${messageId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.style.animation = 'highlightMessage 1s ease';
    setTimeout(() => { msgEl.style.animation = ''; }, 1000);
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
  cancelReply();
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

// Typing Event Listener
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

// ==========================================
// PIN MESSAGE FUNCTIONS
// ==========================================

function pinMessage(messageId) {
  if (!AppState.ws || AppState.ws.readyState !== WebSocket.OPEN) return;
  AppState.ws.send(JSON.stringify({
    type: 'pin_message',
    messageId: messageId
  }));
}

function unpinCurrentMessage() {
  if (!AppState.activeChatPartner) return;
  if (!AppState.ws || AppState.ws.readyState !== WebSocket.OPEN) return;

  AppState.ws.send(JSON.stringify({
    type: 'unpin_message',
    withUser: AppState.activeChatPartner
  }));

  hidePinnedBar();
}

function requestPinnedMessage() {
  if (!AppState.activeChatPartner) return;
  if (!AppState.ws || AppState.ws.readyState !== WebSocket.OPEN) return;

  AppState.ws.send(JSON.stringify({
    type: 'get_pinned',
    with: AppState.activeChatPartner
  }));
}

function showPinnedBar(message) {
  const bar = document.getElementById('pinned-bar');
  const senderEl = document.getElementById('pinned-sender');
  const textEl = document.getElementById('pinned-text');
  const navBtn = document.getElementById('pin-nav-btn');

  if (!message) {
    hidePinnedBar();
    return;
  }

  currentPinnedMessage = message;

  let displayText = message.text || '';
  if (message.media_url) displayText = '📎 Media attachment';
  if (displayText.length > 60) displayText = displayText.substring(0, 60) + '...';

  senderEl.textContent = message.sender.toUpperCase() + ' //';
  textEl.textContent = displayText;

  bar.style.display = 'flex';
  if (navBtn) navBtn.style.display = 'block';
}

function hidePinnedBar() {
  const bar = document.getElementById('pinned-bar');
  const navBtn = document.getElementById('pin-nav-btn');
  if (bar) bar.style.display = 'none';
  if (navBtn) navBtn.style.display = 'none';
  currentPinnedMessage = null;
}

function scrollToPinnedMessage() {
  if (!currentPinnedMessage) return;
  scrollToMessage(currentPinnedMessage.id);
}

function openPinnedBar() {
  const bar = document.getElementById('pinned-bar');
  if (bar) bar.style.display = 'flex';
}

// ==========================================
// SEARCH MESSAGE FUNCTIONS
// ==========================================

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  const partnerName = document.getElementById('search-partner-name');
  const input = document.getElementById('search-input-field');
  const resultsList = document.getElementById('search-results-list');
  const countEl = document.getElementById('search-results-count');

  if (!modal) return;

  partnerName.textContent = AppState.activeChatPartner?.toUpperCase() || '';
  input.value = '';
  resultsList.innerHTML = '';
  countEl.textContent = '';
  currentSearchResults = [];

  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 100);
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) modal.style.display = 'none';
}

function executeSearch() {
  const input = document.getElementById('search-input-field');
  const keyword = input.value.trim();

  if (!keyword || !AppState.activeChatPartner) return;

  if (!AppState.ws || AppState.ws.readyState !== WebSocket.OPEN) return;

  AppState.ws.send(JSON.stringify({
    type: 'search_messages',
    with: AppState.activeChatPartner,
    q: keyword
  }));

  const resultsList = document.getElementById('search-results-list');
  const countEl = document.getElementById('search-results-count');
  resultsList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-family:var(--font-tech);font-size:10px;">SCANNING NEURAL ARCHIVES...</div>';
  countEl.textContent = 'SEARCHING...';
}

function renderSearchResults(results, query) {
  const resultsList = document.getElementById('search-results-list');
  const countEl = document.getElementById('search-results-count');

  currentSearchResults = results;

  if (!results || results.length === 0) {
    resultsList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-family:var(--font-tech);font-size:10px;">NO MATCHES FOUND IN ARCHIVE</div>';
    countEl.textContent = '0 RESULTS';
    return;
  }

  countEl.textContent = `${results.length} RESULT${results.length > 1 ? 'S' : ''} FOUND`;

  const lowerQuery = query.toLowerCase();

  resultsList.innerHTML = results.map(msg => {
    let text = escapeHTML(msg.text || '');
    // Highlight matching text
    text = text.replace(
      new RegExp(`(${lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      '<mark>$1</mark>'
    );

    const time = formatTime(msg.timestamp);
    const isMedia = msg.media_url ? '📎 ' : '';

    return `
      <div class="search-result-item" onclick="jumpToSearchResult(${msg.id})">
        <div class="search-result-sender">${escapeHTML(msg.sender)} // ${time}</div>
        <div class="search-result-text">${isMedia}${text}</div>
      </div>
    `;
  }).join('');
}

function jumpToSearchResult(messageId) {
  closeSearchModal();
  scrollToMessage(messageId);
}
// ==========================================
// WALLPAPER FUNCTIONS (Feature 4)
// ==========================================

function openWallpaperModal() {
  const modal = document.getElementById('wallpaper-modal');
  if (!modal) return;

  // Load current settings
  const saved = localStorage.getItem(`wallpaper_${AppState.activeChatPartner}`);
  if (saved) {
    const data = JSON.parse(saved);
    wallpaperOpacity = data.opacity || 15;
    const opacityInput = document.getElementById('wallpaper-opacity');
    const opacityVal = document.getElementById('wallpaper-opacity-val');
    if (opacityInput) opacityInput.value = wallpaperOpacity;
    if (opacityVal) opacityVal.textContent = wallpaperOpacity + '%';

    // Highlight selected preset
    document.querySelectorAll('.wallpaper-option').forEach(el => el.classList.remove('selected'));
    const selected = document.querySelector(`[data-preset="${data.preset}"]`);
    if (selected) selected.classList.add('selected');
  }

  modal.style.display = 'flex';
}

function closeWallpaperModal() {
  const modal = document.getElementById('wallpaper-modal');
  if (modal) modal.style.display = 'none';
}

function updateWallpaperOpacity(val) {
  wallpaperOpacity = parseInt(val);
  const opacityVal = document.getElementById('wallpaper-opacity-val');
  if (opacityVal) opacityVal.textContent = val + '%';
  applyWallpaperOpacity();
  saveWallpaperSettings();
}

function applyWallpaperOpacity() {
  const container = document.getElementById('chat-wallpaper-container');
  if (container) {
    container.style.opacity = wallpaperOpacity / 100;
  }
}

function setWallpaper(preset) {
  currentWallpaper = preset;

  // Update UI selection
  document.querySelectorAll('.wallpaper-option').forEach(el => el.classList.remove('selected'));
  const selected = document.querySelector(`[data-preset="${preset}"]`);
  if (selected) selected.classList.add('selected');

  renderWallpaper();
  saveWallpaperSettings();
}

function renderWallpaper() {
  const container = document.getElementById('chat-wallpaper-container');
  if (!container) return;

  // Clear previous content
  container.innerHTML = '';
  container.className = 'chat-wallpaper-layer';
  container.style.backgroundImage = '';
  container.style.background = '';

  switch (currentWallpaper) {
    case 'solid':
      container.style.background = '#0a0e1a';
      break;

    case 'grid':
      container.classList.add('wallpaper-grid');
      break;

    case 'matrix':
      container.classList.add('wallpaper-matrix');
      initMatrixWallpaper(container);
      break;

    case 'neon':
      container.classList.add('wallpaper-neon');
      break;

    case 'custom':
      const url = localStorage.getItem(`wallpaper_custom_${AppState.activeChatPartner}`);
      if (url) {
        container.classList.add('wallpaper-custom');
        container.style.backgroundImage = `url(${url})`;
      }
      break;
  }

  applyWallpaperOpacity();
}

function initMatrixWallpaper(container) {
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
  const columnWidth = 20;
  const columns = Math.max(10, Math.floor(container.offsetWidth / columnWidth));

  for (let i = 0; i < columns; i++) {
    const span = document.createElement('span');
    span.className = 'matrix-column';
    span.style.left = `${i * columnWidth}px`;
    span.style.animationDuration = `${5 + Math.random() * 10}s`;
    span.style.animationDelay = `${Math.random() * 5}s`;
    span.textContent = Array(25).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    container.appendChild(span);
  }
}

function handleWallpaperUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    alert('Image too large. Max 2MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const url = e.target.result;
    localStorage.setItem(`wallpaper_custom_${AppState.activeChatPartner}`, url);
    currentWallpaper = 'custom';
    renderWallpaper();
    saveWallpaperSettings();
  };
  reader.readAsDataURL(file);
}

function setWallpaperFromUrl() {
  const input = document.getElementById('wallpaper-url');
  const url = input.value.trim();
  if (!url) return;

  // Validate URL
  const img = new Image();
  img.onload = () => {
    localStorage.setItem(`wallpaper_custom_${AppState.activeChatPartner}`, url);
    currentWallpaper = 'custom';
    renderWallpaper();
    saveWallpaperSettings();
    input.value = '';
  };
  img.onerror = () => {
    alert('Invalid image URL. Please check and try again.');
  };
  img.src = url;
}

function saveWallpaperSettings() {
  if (!AppState.activeChatPartner) return;
  const data = {
    preset: currentWallpaper,
    opacity: wallpaperOpacity,
    timestamp: Date.now()
  };
  localStorage.setItem(`wallpaper_${AppState.activeChatPartner}`, JSON.stringify(data));
}

function loadWallpaperForPartner(partner) {
  const saved = localStorage.getItem(`wallpaper_${partner}`);
  if (saved) {
    const data = JSON.parse(saved);
    currentWallpaper = data.preset;
    wallpaperOpacity = data.opacity || 15;
    renderWallpaper();
  } else {
    // Default
    currentWallpaper = 'solid';
    wallpaperOpacity = 15;
    renderWallpaper();
  }
}

// ==========================================
// ANIMATION HELPERS 
// ==========================================

function animateReactionPop(element) {
  element.classList.add('new');
  setTimeout(() => element.classList.remove('new'), 300);
}

function animateMediaLoad(element) {
  element.classList.add('loaded');
}

// Override showTypingIndicator for cyberpunk dots
function showTypingIndicator() {
  const statusText = document.getElementById('chat-partner-status-text');
  if (!statusText) return;
  if (!statusText.dataset.originalText) {
    statusText.dataset.originalText = statusText.textContent;
  }
  statusText.innerHTML = `
    <span style="display:flex;align-items:center;gap:6px;">
      <span class="typing-indicator">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
      <span style="font-family:var(--font-tech);font-size:9px;letter-spacing:1px;">TYPING</span>
    </span>
  `;
  statusText.style.color = 'var(--neon-cyan)';
  statusText.style.textShadow = '0 0 5px var(--neon-cyan)';
}

// Override openChatWith to load wallpaper
const originalOpenChatWith = openChatWith;
openChatWith = function (username) {
  originalOpenChatWith(username);
  // Load wallpaper for this conversation
  loadWallpaperForPartner(username);
};

// Override appendChatMessage to add media load animation
const originalAppendChatMessage = appendChatMessage;
appendChatMessage = function (msg) {
  originalAppendChatMessage(msg);

  // Add media load animation
  const messagesArea = document.getElementById('messages-area');
  if (!messagesArea) return;

  const lastWrapper = messagesArea.lastElementChild;
  if (!lastWrapper) return;

  const mediaElements = lastWrapper.querySelectorAll('.chat-media-img, .chat-media-vid');
  mediaElements.forEach(el => {
    if (el.complete || el.readyState >= 3) {
      el.classList.add('loaded');
    } else {
      el.addEventListener('load', () => el.classList.add('loaded'));
      el.addEventListener('error', () => el.classList.add('loaded'));
    }
  });
};

// Override message_deleted handler for fade animation
const originalWsOnMessage = initWebSocket;

// Add pin bar pulse when showing pinned bar
const originalShowPinnedBar = showPinnedBar;
showPinnedBar = function (message) {
  originalShowPinnedBar(message);
  const bar = document.getElementById('pinned-bar');
  if (bar && message) {
    bar.classList.add('has-pinned');
  }
};

const originalHidePinnedBar = hidePinnedBar;
hidePinnedBar = function () {
  const bar = document.getElementById('pinned-bar');
  if (bar) bar.classList.remove('has-pinned');
  originalHidePinnedBar();
};