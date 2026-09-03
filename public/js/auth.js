(function () {
  const tabs = document.querySelectorAll('.tab');
  const forms = document.querySelectorAll('.form');
  const errorBox = document.getElementById('formError');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      forms.forEach((f) => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + 'Form').classList.add('active');
      errorBox.textContent = '';
    });
  });

  async function submitAuth(url, payload) {
    errorBox.textContent = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        errorBox.textContent = data.error || 'Что-то пошло не так';
        return;
      }
      window.location.href = '/chat.html';
    } catch (e) {
      errorBox.textContent = 'Нет соединения с сервером';
    }
  }

  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    submitAuth('/api/login', { username, password });
  });

  document.getElementById('registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    submitAuth('/api/register', { username, password });
  });

  // if already logged in, skip straight to chat
  fetch('/api/me')
    .then((res) => (res.ok ? (window.location.href = '/chat.html') : null))
    .catch(() => {});
})();
