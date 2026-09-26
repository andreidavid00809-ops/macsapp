const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'macsapp-secret-key';
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function ensureDbFile() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const base = { users: [], subjects: [], notifications: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(base, null, 2));
  }
}

function readDb() {
  ensureDbFile();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: '7d'
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function addNotification(userId, message) {
  const db = readDb();
  db.notifications.unshift({
    id: crypto.randomUUID(),
    userId,
    message,
    createdAt: new Date().toISOString(),
    read: false
  });
  writeDb(db);
}

function getUserSubjects(userId) {
  const db = readDb();
  return (db.subjects || []).filter(subject => subject.userId === userId);
}

function computeSubjectProgress(subject) {
  const tasks = subject.tasks || [];
  if (tasks.length === 0) {
    return { percent: 0, completed: 0, total: 0 };
  }

  const completed = tasks.filter(task => task.status === 'completed').length;
  const percent = Math.round((completed / tasks.length) * 100);

  return {
    percent,
    completed,
    total: tasks.length
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  const db = readDb();
  const exists = (db.users || []).find(user => user.email.toLowerCase() === email.toLowerCase());

  if (exists) {
    return res.status(409).json({ message: 'User already exists' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email: email.toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  writeDb(db);

  const token = createToken(user);
  return res.status(201).json({
    token,
    user: sanitizeUser(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const db = readDb();
  const user = (db.users || []).find(item => item.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const matches = bcrypt.compareSync(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = createToken(user);
  return res.json({
    token,
    user: sanitizeUser(user)
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const db = readDb();
  const user = (db.users || []).find(item => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.get('/api/dashboard', authMiddleware, (req, res) => {
  const db = readDb();
  const user = (db.users || []).find(item => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const subjects = (db.subjects || []).filter(subject => subject.userId === req.user.id);
  const notifications = (db.notifications || []).filter(notification => notification.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return res.json({
    user: sanitizeUser(user),
    subjects: subjects.map(subject => ({
      ...subject,
      progress: computeSubjectProgress(subject)
    })),
    notifications
  });
});

app.get('/api/subjects', authMiddleware, (req, res) => {
  const db = readDb();
  const subjects = (db.subjects || []).filter(subject => subject.userId === req.user.id);
  res.json(subjects.map(subject => ({
    ...subject,
    progress: computeSubjectProgress(subject)
  })));
});

app.post('/api/subjects', authMiddleware, (req, res) => {
  const { name, color, description } = req.body || {};

  if (!name) {
    return res.status(400).json({ message: 'Subject name is required' });
  }

  const db = readDb();
  const subject = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name,
    description: description || '',
    color: color || '#4f46e5',
    tasks: [],
    createdAt: new Date().toISOString()
  };

  db.subjects.push(subject);
  writeDb(db);
  res.status(201).json({ ...subject, progress: computeSubjectProgress(subject) });
});

app.post('/api/subjects/:subjectId/tasks', authMiddleware, (req, res) => {
  const { subjectId } = req.params;
  const { title, type, deadline, notes, status } = req.body || {};

  if (!title) {
    return res.status(400).json({ message: 'Task title is required' });
  }

  const db = readDb();
  const subject = (db.subjects || []).find(item => item.id === subjectId && item.userId === req.user.id);

  if (!subject) {
    return res.status(404).json({ message: 'Subject not found' });
  }

  const task = {
    id: crypto.randomUUID(),
    title,
    type: type || 'assignment',
    deadline: deadline || '',
    notes: notes || '',
    status: status || 'pending',
    reminderSent: false,
    createdAt: new Date().toISOString()
  };

  subject.tasks.push(task);
  writeDb(db);

  res.status(201).json({ subject, task });
});

app.patch('/api/tasks/:taskId', authMiddleware, (req, res) => {
  const { taskId } = req.params;
  const updates = req.body || {};

  const db = readDb();
  let found = null;

  for (const subject of db.subjects || []) {
    if (subject.userId !== req.user.id) continue;

    const task = (subject.tasks || []).find(item => item.id === taskId);
    if (task) {
      found = { subject, task };
      Object.assign(task, updates);
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ message: 'Task not found' });
  }

  writeDb(db);
  return res.json({ message: 'Task updated', task: found.task });
});

app.delete('/api/tasks/:taskId', authMiddleware, (req, res) => {
  const { taskId } = req.params;
  const db = readDb();

  let deleted = false;
  for (const subject of db.subjects || []) {
    if (subject.userId !== req.user.id) continue;
    const index = (subject.tasks || []).findIndex(task => task.id === taskId);
    if (index !== -1) {
      subject.tasks.splice(index, 1);
      deleted = true;
      break;
    }
  }

  if (!deleted) {
    return res.status(404).json({ message: 'Task not found' });
  }

  writeDb(db);
  return res.json({ message: 'Task deleted' });
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  const db = readDb();
  const notifications = (db.notifications || []).filter(item => item.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(notifications);
});

app.patch('/api/notifications/:notificationId/read', authMiddleware, (req, res) => {
  const { notificationId } = req.params;
  const db = readDb();

  const notification = (db.notifications || []).find(item => item.id === notificationId && item.userId === req.user.id);
  if (!notification) {
    return res.status(404).json({ message: 'Notification not found' });
  }

  notification.read = true;
  writeDb(db);
  res.json({ message: 'Notification marked as read' });
});

cron.schedule('*/30 * * * * *', () => {
  const db = readDb();
  const now = Date.now();

  for (const subject of db.subjects || []) {
    for (const task of subject.tasks || []) {
      if (!task.deadline || task.status === 'completed') continue;

      const target = new Date(task.deadline).getTime();
      const hoursRemaining = (target - now) / (1000 * 60 * 60);

      if (hoursRemaining <= 24 && hoursRemaining > 0 && !task.reminderSent) {
        task.reminderSent = true;
        db.notifications.unshift({
          id: crypto.randomUUID(),
          userId: subject.userId,
          message: `Reminder: "${task.title}" in ${subject.name} is due soon on ${new Date(task.deadline).toLocaleDateString()}`,
          createdAt: new Date().toISOString(),
          read: false
        });
      }

      if (target < now && task.status !== 'completed') {
        db.notifications.unshift({
          id: crypto.randomUUID(),
          userId: subject.userId,
          message: `Deadline missed for "${task.title}" in ${subject.name}.`,
          createdAt: new Date().toISOString(),
          read: false
        });
      }
    }
  }

  writeDb(db);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`macsapp is running on http://localhost:${PORT}`);
});

