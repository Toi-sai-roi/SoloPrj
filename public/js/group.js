// ==========================================
// group.js — Group Chat Logic V6
// Tạo nhóm, mở chat nhóm, quản lý thành viên
// ==========================================

// ==========================================
// OPEN / EXIT GROUP CHAT
// ==========================================

async function openGroupChat(groupId) {
  AppState.activeGroup = groupId;

  showScreen('group-chat-screen');

  document.getElementById('group-messages-area').innerHTML =
    '<div class="blank-state">ĐANG KẾT NỐI CỤM NODE...</div>';
  document.getElementById('group-chat-name').textContent = 'LOADING...';
  document.getElementById('group-chat-meta').textContent = '';

  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      throw new Error('Cannot load group');
    }
    const group = await res.json();

    AppState.activeGroupData = group;

    document.getElementById('group-chat-name').textContent = `GROUP // ${group.name.toUpperCase()}`;
    document.getElementById('group-chat-meta').textContent = `${group.members.length} NODES`;

    const avatarEl = document.getElementById('group-chat-avatar');
    if (group.avatar) {
      avatarEl.innerHTML = `<img src="${group.avatar}" style="width:100%;height:100%;border-radius:8px;object-fit:cover;">`;
    } else {
      avatarEl.textContent = group.name.charAt(0).toUpperCase();
    }

    // Lấy lịch sử tin nhắn qua WS
    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
      AppState.ws.send(JSON.stringify({ type: 'get_group_history', groupId }));
    }
  } catch (err) {
    console.error('Lỗi mở group chat:', err);
    document.getElementById('group-messages-area').innerHTML =
      '<div class="blank-state" style="color:var(--accent-pink);">ERROR: CANNOT LOAD CLUSTER</div>';
  }
}

function exitGroupChat() {
  AppState.activeGroup = null;
  AppState.activeGroupData = null;
  showScreen('home-screen');
  // Reload groups tab nếu đang ở tab groups
  if (AppState.currentUsersTab === 'groups') {
    loadAndRenderGroups();
  }
}

// ==========================================
// SEND GROUP MESSAGE
// ==========================================

function handleSendGroupMessage(e) {
  e.preventDefault();
  const field = document.getElementById('group-chat-input-field');
  const text = field.value.trim();
  if (!text || !AppState.activeGroup) return;

  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({
      type: 'send_group_message',
      groupId: AppState.activeGroup,
      text
    }));
    field.value = '';
    field.focus();
  }
}

// Typing indicator
document.addEventListener('DOMContentLoaded', () => {
  const groupInput = document.getElementById('group-chat-input-field');
  let groupTypingTimeout = null;
  if (groupInput) {
    groupInput.addEventListener('input', () => {
      if (!AppState.activeGroup) return;
      if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        AppState.ws.send(JSON.stringify({ type: 'group_typing', groupId: AppState.activeGroup, isTyping: true }));
        if (groupTypingTimeout) clearTimeout(groupTypingTimeout);
        groupTypingTimeout = setTimeout(() => {
          if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
            AppState.ws.send(JSON.stringify({ type: 'group_typing', groupId: AppState.activeGroup, isTyping: false }));
          }
        }, 1500);
      }
    });
  }
});

// ==========================================
// APPEND GROUP MESSAGE
// ==========================================

function appendGroupMessage(msg) {
  const area = document.getElementById('group-messages-area');
  if (!area) return;
  const blankState = area.querySelector('.blank-state');
  if (blankState) blankState.remove();

  const isSelf = msg.sender === AppState.currentUser || msg.self;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isSelf ? 'self' : 'other'}`;
  wrapper.setAttribute('data-group-message-id', msg.id);

  let bubbleContent = '';
  if (msg.text && msg.text.startsWith('data:image/')) {
    bubbleContent = `<img src="${msg.text}" class="chat-media-img" onclick="openLightbox(this.src)" alt="Ảnh đính kèm">`;
  } else {
    bubbleContent = escapeHTML(msg.text || '');
  }

  // Reactions
  let reactionsRowHtml = '';
  if (msg.reactions) {
    const reactionMap = typeof msg.reactions === 'string' ? JSON.parse(msg.reactions) : msg.reactions;
    const emojiCounts = {};
    Object.values(reactionMap).forEach(emoji => { emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1; });
    const topReactions = Object.entries(emojiCounts).slice(0, 3);
    if (topReactions.length > 0) {
      reactionsRowHtml = '<div class="reactions-row">' +
        topReactions.map(([emoji, count]) =>
          `<div class="reaction-badge" onclick="event.stopPropagation();sendGroupReaction(${msg.id},'${emoji}')">
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">${count}</span>
          </div>`
        ).join('') + '</div>';
    }
  }

  wrapper.innerHTML = `
    ${!isSelf ? `<div class="msg-sender" style="color:var(--neon-purple)">${escapeHTML(msg.sender)}</div>` : ''}
    <div class="msg-content-node">
      <div class="reaction-trigger" onclick="event.stopPropagation();showGroupReactionPicker(${msg.id},event)">😊</div>
      <div class="msg-bubble">
        <div class="msg-text-data">${bubbleContent}</div>
        ${reactionsRowHtml}
      </div>
    </div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
  `;

  area.appendChild(wrapper);
  area.scrollTop = area.scrollHeight;
}

function showGroupReactionPicker(messageId, event) {
  event.stopPropagation();
  const oldPicker = document.querySelector('.reaction-picker');
  if (oldPicker) oldPicker.remove();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = ['👍','❤️','😂','😮','😢','😡','🎉','🔥']
    .map(e => `<div class="reaction-option" data-emoji="${e}">${e}</div>`).join('');

  const rect = event.target.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  picker.style.left = Math.max(0, rect.left - 50) + 'px';
  document.body.appendChild(picker);

  picker.querySelectorAll('.reaction-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      sendGroupReaction(messageId, opt.dataset.emoji);
      picker.remove();
    });
  });

  setTimeout(() => {
    const close = e => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function sendGroupReaction(messageId, emoji) {
  if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
    AppState.ws.send(JSON.stringify({ type: 'group_reaction', messageId, emoji }));
  }
}

function updateGroupMessageReaction(messageId, reactionMap) {
  const wrapper = document.querySelector(`[data-group-message-id="${messageId}"]`);
  if (!wrapper) return;
  const bubble = wrapper.querySelector('.msg-bubble');
  if (!bubble) return;

  let reactionsRow = bubble.querySelector('.reactions-row');
  const emojiCounts = {};
  Object.values(reactionMap).forEach(emoji => { emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1; });
  const topReactions = Object.entries(emojiCounts).slice(0, 3);

  if (topReactions.length === 0) {
    if (reactionsRow) reactionsRow.remove();
    return;
  }

  if (!reactionsRow) {
    reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions-row';
    bubble.appendChild(reactionsRow);
  }

  reactionsRow.innerHTML = topReactions.map(([emoji, count]) =>
    `<div class="reaction-badge" onclick="event.stopPropagation();sendGroupReaction(${messageId},'${emoji}')">
      <span class="reaction-emoji">${emoji}</span>
      <span class="reaction-count">${count}</span>
    </div>`
  ).join('');
}

// ==========================================
// CREATE GROUP MODAL
// ==========================================

function openCreateGroupModal() {
  const modal = document.getElementById('create-group-modal');
  if (!modal) return;

  // Điền danh sách friends vào
  const membersContainer = document.getElementById('group-members-select');
  membersContainer.innerHTML = '';

  const friends = (AppState.usersData || []).filter(u => u.relation === 'friend');
  if (friends.length === 0) {
    membersContainer.innerHTML = '<div style="font-size:10px;color:var(--text-muted);font-family:var(--font-tech);padding:8px;">NO FRIENDS AVAILABLE — ADD FRIENDS FIRST</div>';
  } else {
    friends.forEach(user => {
      const item = document.createElement('label');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-radius:6px;transition:background 0.15s;';
      item.onmouseenter = () => item.style.background = 'var(--bg-card-hover)';
      item.onmouseleave = () => item.style.background = 'transparent';
      item.innerHTML = `
        <input type="checkbox" value="${user.username}" style="accent-color:var(--neon-cyan);">
        <span class="user-avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0;">${user.username.charAt(0).toUpperCase()}</span>
        <span style="font-size:11px;font-family:var(--font-tech);color:var(--text-main);">${user.username}</span>
        <span class="status-dot ${user.online ? 'online' : 'offline'}" style="position:static;margin:0;margin-left:auto;"></span>
      `;
      membersContainer.appendChild(item);
    });
  }

  document.getElementById('group-name-input').value = '';
  document.getElementById('group-desc-input').value = '';
  document.getElementById('create-group-error').style.display = 'none';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('group-name-input').focus(), 100);
}

function closeCreateGroupModal() {
  const modal = document.getElementById('create-group-modal');
  if (modal) modal.style.display = 'none';
}

async function submitCreateGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  const description = document.getElementById('group-desc-input').value.trim();
  const errorEl = document.getElementById('create-group-error');

  if (!name) {
    errorEl.textContent = 'TÊN NHÓM KHÔNG ĐƯỢC ĐỂ TRỐNG';
    errorEl.style.display = 'block';
    return;
  }

  const checkedBoxes = document.querySelectorAll('#group-members-select input[type="checkbox"]:checked');
  const members = Array.from(checkedBoxes).map(cb => cb.value);

  try {
    const res = await fetch('/api/groups/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ name, description, members })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      const result = await res.json();
      errorEl.textContent = result.error || 'LỖI TẠO NHÓM';
      errorEl.style.display = 'block';
      return;
    }

    const result = await res.json();
    closeCreateGroupModal();
    // Chuyển sang group chat mới tạo
    openGroupChat(result.groupId);
  } catch (err) {
    errorEl.textContent = 'LỖI KẾT NỐI MÁY CHỦ';
    errorEl.style.display = 'block';
  }
}

// ==========================================
// GROUP SETTINGS MODAL
// ==========================================

async function openGroupSettings(groupId) {
  const modal = document.getElementById('group-settings-modal');
  const content = document.getElementById('group-settings-content');
  if (!modal || !content) return;

  content.innerHTML = '<div style="font-size:10px;color:var(--text-muted);font-family:var(--font-tech);padding:20px;text-align:center;">LOADING...</div>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      throw new Error('Failed');
    }
    const group = await res.json();
    const isAdmin = group.myRole === 'admin';

    let membersHtml = group.members.map(m => {
      const isMe = m.username === AppState.currentUser;
      const kickBtn = isAdmin && !isMe
        ? `<button class="cyber-btn" style="padding:3px 7px;font-size:8px;min-width:auto;height:auto;border-color:var(--accent-pink);color:var(--accent-pink);"
            onclick="kickGroupMember(${groupId},'${m.username}')">KICK</button>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;border:1px solid var(--border-subtle);">
          <div class="user-avatar" style="width:30px;height:30px;font-size:11px;flex-shrink:0;">${m.username.charAt(0).toUpperCase()}</div>
          <div style="flex:1;">
            <div style="font-size:11px;font-family:var(--font-tech);color:var(--text-main);">${escapeHTML(m.username)} ${isMe ? '<span style="color:var(--accent-cyan)">[YOU]</span>' : ''}</div>
            <div style="font-size:9px;color:var(--text-muted);">${m.role.toUpperCase()}</div>
          </div>
          ${kickBtn}
        </div>
      `;
    }).join('');

    let inviteHtml = '';
    if (isAdmin) {
      const nonMembers = (AppState.usersData || []).filter(u =>
        u.relation === 'friend' && !group.members.find(m => m.username === u.username)
      );
      if (nonMembers.length > 0) {
        inviteHtml = `
          <div style="margin-top:16px;">
            <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-tech);letter-spacing:1px;margin-bottom:8px;">INVITE NEW NODE</div>
            <div style="display:flex;gap:8px;">
              <select id="invite-user-select" class="cyber-input" style="flex:1;padding:8px;">
                ${nonMembers.map(u => `<option value="${u.username}">${u.username}</option>`).join('')}
              </select>
              <button class="cyber-btn" onclick="inviteToGroup(${groupId})" style="padding:8px 16px;font-size:9px;min-width:auto;border-color:var(--neon-cyan);color:var(--neon-cyan);">INVITE</button>
            </div>
          </div>
        `;
      }
    }

    const isCreator = group.created_by === AppState.currentUser;
    const dangerZone = `
      <div style="margin-top:20px;border-top:1px solid var(--border-subtle);padding-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="cyber-btn" onclick="leaveGroup(${groupId})"
          style="padding:7px 14px;font-size:9px;min-width:auto;border-color:var(--neon-yellow);color:var(--neon-yellow);">LEAVE GROUP</button>
        ${isCreator
          ? `<button class="cyber-btn" onclick="deleteGroup(${groupId})"
              style="padding:7px 14px;font-size:9px;min-width:auto;border-color:var(--accent-pink);color:var(--accent-pink);">DELETE GROUP</button>`
          : ''}
      </div>
    `;

    content.innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-family:var(--font-tech);color:var(--accent-cyan);">${escapeHTML(group.name)}</div>
        ${group.description ? `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${escapeHTML(group.description)}</div>` : ''}
        <div style="font-size:9px;color:var(--text-muted);margin-top:4px;">Created by ${escapeHTML(group.created_by)}</div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-tech);letter-spacing:1px;margin-bottom:8px;">MEMBERS (${group.members.length})</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${membersHtml}</div>
      ${inviteHtml}
      ${dangerZone}
    `;
  } catch (err) {
    content.innerHTML = '<div style="color:var(--accent-pink);font-size:10px;font-family:var(--font-tech);">FAILED TO LOAD GROUP DATA</div>';
  }
}

function closeGroupSettings() {
  const modal = document.getElementById('group-settings-modal');
  if (modal) modal.style.display = 'none';
}

async function kickGroupMember(groupId, username) {
  if (!confirm(`Kick ${username} khỏi nhóm?`)) return;
  try {
    const res = await fetch(`/api/groups/${groupId}/members/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      alert('Kick thất bại');
      return;
    }
    openGroupSettings(groupId);
  } catch { alert('Lỗi kết nối'); }
}

async function inviteToGroup(groupId) {
  const select = document.getElementById('invite-user-select');
  if (!select) return;
  const username = select.value;
  if (!username) return;

  try {
    const res = await fetch(`/api/groups/${groupId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AppState.token}` },
      body: JSON.stringify({ username })
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      const d = await res.json();
      alert(d.error || 'Thất bại');
      return;
    }
    openGroupSettings(groupId);
  } catch { alert('Lỗi kết nối'); }
}

async function leaveGroup(groupId) {
  if (!confirm('Rời khỏi nhóm này?')) return;
  try {
    const res = await fetch(`/api/groups/${groupId}/leave`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      const d = await res.json();
      alert(d.error || 'Thất bại');
      return;
    }
    closeGroupSettings();
    exitGroupChat();
  } catch { alert('Lỗi kết nối'); }
}

async function deleteGroup(groupId) {
  if (!confirm('XÓA NHÓM NÀY? Hành động này không thể hoàn tác!')) return;
  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return; // handleAuthError đã xử lý
      const d = await res.json();
      alert(d.error || 'Thất bại');
      return;
    }
    closeGroupSettings();
    exitGroupChat();
  } catch { alert('Lỗi kết nối'); }
}