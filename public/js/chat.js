(function () {
  const meNameEl = document.getElementById('meName');
  const onlineListEl = document.getElementById('onlineList');
  const messageListEl = document.getElementById('messageList');
  const emptyStateEl = document.getElementById('emptyState');
  const composerEl = document.getElementById('composer');
  const inputEl = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('statusText');
  const logoutBtn = document.getElementById('logoutBtn');

  let me = null;
  let socket = null;

  function timeLabel(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessage(msg) {
    emptyStateEl.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'msg-row ' + (msg.username === me ? 'own' : 'other');

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = (msg.username === me ? 'Вы' : msg.username) + ' · ' + timeLabel(msg.createdAt);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text;

    row.appendChild(meta);
    row.appendChild(bubble);
    messageListEl.appendChild(row);
    messageListEl.scrollTop = messageListEl.scrollHeight;
  }

  function renderPresence(usernames) {
    onlineListEl.innerHTML = '';
    usernames.forEach((name) => {
      const li = document.createElement('li');
      li.className = 'online-item';
      const pulse = document.createElement('span');
      pulse.className = 'pulse';
      const label = document.createElement('span');
      label.textContent = name === me ? name + ' (вы)' : name;
      li.appendChild(pulse);
      li.appendChild(label);
      onlineListEl.appendChild(li);
    });
  }

  function setConnected(connected) {
    statusEl.classList.toggle('connected', connected);
    statusTextEl.textContent = connected ? 'в сети' : 'подключение…';
  }

  async function init() {
    // auth guard
    let meRes;
    try {
      meRes = await fetch('/api/me');
    } catch (e) {
      window.location.href = '/';
      return;
    }
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }
    const meData = await meRes.json();
    me = meData.username;
    meNameEl.textContent = me;

    // history
    try {
      const historyRes = await fetch('/api/messages');
      if (historyRes.ok) {
        const history = await historyRes.json();
        history.forEach(renderMessage);
      }
    } catch (e) {
      // ignore, socket will still work
    }

    // realtime
    socket = io({ withCredentials: true });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      setConnected(false);
      statusTextEl.textContent = 'нет соединения';
    });

    socket.on('message:new', renderMessage);
    socket.on('presence', renderPresence);
  }

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !socket) return;
    socket.emit('message:send', { text });
    inputEl.value = '';
    inputEl.style.height = 'auto';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composerEl.requestSubmit();
    }
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });

  init();
})();
