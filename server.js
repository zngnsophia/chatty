const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const http = require('http');
const { Server } = require('socket.io');

// ---------- paths & persistence ----------
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'));

const JWT_SECRET = process.env.JWT_SECRET || fs.readFileSync(SECRET_FILE, 'utf8').trim();
const COOKIE_NAME = 'mm_token';
const MAX_MESSAGES = 300;

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getUsers() {
  return readJSON(USERS_FILE);
}

function saveUsers(users) {
  writeJSON(USERS_FILE, users);
}

function getMessages() {
  return readJSON(MESSAGES_FILE);
}

function saveMessages(messages) {
  writeJSON(MESSAGES_FILE, messages);
}

function findUserByUsername(username) {
  const users = getUsers();
  const lower = username.toLowerCase();
  return users.find((u) => u.username.toLowerCase() === lower);
}

// ---------- validation ----------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Заполните логин и пароль';
  }
  if (!USERNAME_RE.test(username)) {
    return 'Логин: 3–20 символов, латиница, цифры и подчёркивание';
  }
  if (password.length < 6 || password.length > 100) {
    return 'Пароль должен быть от 6 до 100 символов';
  }
  return null;
}

// ---------- auth helpers ----------
function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function getTokenFromReq(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  return null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Не авторизован' });
  req.user = payload;
  next();
}

// simple cookie parser middleware (avoids extra dependency issues)
function cookieParserMiddleware(req, res, next) {
  const header = req.headers.cookie;
  req.cookies = header ? cookie.parse(header) : {};
  next();
}

// ---------- app setup ----------
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(cookieParserMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ---------- API: auth ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  const error = validateCredentials(username, password);
  if (error) return res.status(400).json({ error });

  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Такой логин уже занят' });
  }

  const users = getUsers();
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ username: user.username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Заполните логин и пароль' });
  }

  const user = findUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

app.get('/api/messages', requireAuth, (req, res) => {
  const messages = getMessages();
  res.json(messages.slice(-MAX_MESSAGES));
});

// ---------- server + socket.io ----------
const server = http.createServer(app);
const io = new Server(server, {
  cookie: false,
});

// auth middleware for sockets
io.use((socket, next) => {
  const header = socket.handshake.headers.cookie;
  const cookies = header ? cookie.parse(header) : {};
  const token = cookies[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return next(new Error('unauthorized'));
  socket.user = payload;
  next();
});

const online = new Map(); // socket.id -> username

function broadcastPresence() {
  const usernames = [...new Set(online.values())].sort((a, b) => a.localeCompare(b));
  io.emit('presence', usernames);
}

io.on('connection', (socket) => {
  online.set(socket.id, socket.user.username);
  broadcastPresence();

  socket.on('message:send', (payload) => {
    const text = typeof payload === 'string' ? payload : payload && payload.text;
    if (typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;

    const message = {
      id: crypto.randomUUID(),
      userId: socket.user.sub,
      username: socket.user.username,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    const messages = getMessages();
    messages.push(message);
    if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
    saveMessages(messages);

    io.emit('message:new', message);
  });

  socket.on('disconnect', () => {
    online.delete(socket.id);
    broadcastPresence();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mini-messenger запущен: http://localhost:${PORT}`);
});
