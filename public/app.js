const state = {
  token: localStorage.getItem('macsappToken') || '',
  user: null,
  subjects: [],
  notifications: []
};

const authScreen = document.getElementById('authScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const subjectForm = document.getElementById('subjectForm');
const taskForm = document.getElementById('taskForm');

const totalTasksEl = document.getElementById('totalTasks');
const completedTasksEl = document.getElementById('completedTasks');
const overallProgressEl = document.getElementById('overallProgress');
const subjectListEl = document.getElementById('subjectList');
const taskListEl = document.getElementById('taskList');
const notificationListEl = document.getElementById('notificationList');
const calendarViewEl = document.getElementById('calendarView');
const taskSubjectSelect = document.getElementById('taskSubject');

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(typeof result === 'string' ? result : result.message || 'Request failed');
  }

  return result;
}

function showAuth() {
  authScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showDashboard() {
  authScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
}

function logout() {
  state.token = '';
  state.user = null;
  state.subjects = [];
  state.notifications = [];
  localStorage.removeItem('macsappToken');
  showAuth();
}

function setAuthToken(token) {
  state.token = token;
  localStorage.setItem('macsappToken', token);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    setAuthToken(response.token);
    state.user = response.user;
    await fetchDashboard();
    showDashboard();
    loginForm.reset();
  } catch (error) {
    alert(error.message);
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;

  try {
    const response = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });

    setAuthToken(response.token);
    state.user = response.user;
    await fetchDashboard();
    showDashboard();
    registerForm.reset();
  } catch (error) {
    alert(error.message);
  }
});

logoutBtn.addEventListener('click', logout);

subjectForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = document.getElementById('subjectName').value.trim();
  const description = document.getElementById('subjectDescription').value.trim();
  const color = document.getElementById('subjectColor').value;

  try {
    await apiRequest('/api/subjects', {
      method: 'POST',
      body: JSON.stringify({ name, description, color })
    });

    subjectForm.reset();
    document.getElementById('subjectColor').value = '#4f46e5';
    await fetchDashboard();
  } catch (error) {
    alert(error.message);
  }
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const subjectId = taskSubjectSelect.value;
  const title = document.getElementById('taskTitle').value.trim();
  const type = document.getElementById('taskType').value;
  const deadline = document.getElementById('taskDeadline').value;
  const notes = document.getElementById('taskNotes').value.trim();

  if (!subjectId) {
    alert('Please add a subject first.');
    return;
  }

  try {
    await apiRequest(`/api/subjects/${subjectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, type, deadline, notes })
    });

    taskForm.reset();
    await fetchDashboard();
  } catch (error) {
    alert(error.message);
  }
});

async function fetchDashboard() {
  try {
    const response = await apiRequest('/api/dashboard');
    state.subjects = response.subjects || [];
    state.notifications = response.notifications || [];
    state.user = response.user;

    renderSubjectOptions();
    renderStats();
    renderSubjects();
    renderTasks();
    renderNotifications();
    renderCalendar();
    triggerDeadlineAlerts();
  } catch (error) {
    if (error.message.includes('token') || error.message.includes('Invalid')) {
      logout();
    }
  }
}

function renderSubjectOptions() {
  if (!state.subjects.length) {
    taskSubjectSelect.innerHTML = '<option value="">No subjects yet</option>';
    return;
  }

  taskSubjectSelect.innerHTML = state.subjects
    .map(subject => `<option value="${subject.id}">${subject.name}</option>`)
    .join('');
}

function renderStats() {
  const allTasks = state.subjects.flatMap(subject => (subject.tasks || []).map(task => ({ ...task, subjectName: subject.name })));
  const completed = allTasks.filter(task => task.status === 'completed').length;
  const total = allTasks.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  totalTasksEl.textContent = String(total);
  completedTasksEl.textContent = String(completed);
  overallProgressEl.textContent = `${percent}%`;
}

function renderSubjects() {
  if (!state.subjects.length) {
    subjectListEl.innerHTML = '<p class="muted">No subjects yet.</p>';
    return;
  }

  subjectListEl.innerHTML = state.subjects
    .map(subject => {
      const progress = subject.progress || { percent: 0, completed: 0, total: 0 };
      return `
        <div class="subject-card">
          <div class="subject-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="subject-badge" style="background:${subject.color || '#4f46e5'}"></span>
              <strong>${subject.name}</strong>
            </div>
            <button class="secondary" data-subject-id="${subject.id}" data-action="select-subject">Open</button>
          </div>
          <p class="muted">${subject.description || 'No description yet.'}</p>
          <div class="progress-bar"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
          <small>${progress.completed}/${progress.total} tasks completed</small>
        </div>
      `;
    })
    .join('');

  subjectListEl.querySelectorAll('[data-action="select-subject"]').forEach(button => {
    button.addEventListener('click', () => {
      const subjectId = button.dataset.subjectId;
      taskSubjectSelect.value = subjectId;
      renderTasks();
    });
  });
}

function renderTasks() {
  const selectedSubjectId = taskSubjectSelect.value;
  const tasks = selectedSubjectId
    ? (state.subjects.find(subject => subject.id === selectedSubjectId)?.tasks || [])
    : state.subjects.flatMap(subject => (subject.tasks || []).map(task => ({ ...task, subjectName: subject.name })));

  if (!tasks.length) {
    taskListEl.innerHTML = '<p class="muted">No tasks yet.</p>';
    return;
  }

  taskListEl.innerHTML = tasks
    .slice()
    .sort((a, b) => new Date(a.deadline || '9999-12-31') - new Date(b.deadline || '9999-12-31'))
    .map(task => {
      const due = task.deadline ? new Date(task.deadline) : null;
      const statusClass = task.status === 'completed' ? 'status-completed' : due && due < new Date() ? 'status-overdue' : 'status-pending';
      const statusText = task.status === 'completed' ? 'Completed' : due && due < new Date() ? 'Overdue' : 'Pending';

      return `
        <div class="task-card">
          <div class="task-meta">
            <span>${task.type || 'task'}</span>
            <span class="status-pill ${statusClass}">${statusText}</span>
          </div>
          <strong>${task.title}</strong>
          <div>${task.notes || 'No notes added.'}</div>
          <small>${task.deadline ? `Due: ${new Date(task.deadline).toLocaleDateString()}` : 'No deadline set'}</small>
          <div class="task-actions">
            <button data-action="toggle-task" data-task-id="${task.id}">${task.status === 'completed' ? 'Mark pending' : 'Mark complete'}</button>
            <button class="secondary" data-action="delete-task" data-task-id="${task.id}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

  taskListEl.querySelectorAll('[data-action="toggle-task"]').forEach(button => {
    button.addEventListener('click', async () => {
      const taskId = button.dataset.taskId;
      const task = findTaskById(taskId);
      const nextStatus = task.status === 'completed' ? 'pending' : 'completed';

      try {
        await apiRequest(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus, reminderSent: false })
        });
        await fetchDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  taskListEl.querySelectorAll('[data-action="delete-task"]').forEach(button => {
    button.addEventListener('click', async () => {
      const taskId = button.dataset.taskId;
      try {
        await apiRequest(`/api/tasks/${taskId}`, { method: 'DELETE' });
        await fetchDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function findTaskById(taskId) {
  for (const subject of state.subjects) {
    const task = (subject.tasks || []).find(item => item.id === taskId);
    if (task) return task;
  }
  return null;
}

function renderNotifications() {
  if (!state.notifications.length) {
    notificationListEl.innerHTML = '<p class="muted">No notifications yet.</p>';
    return;
  }

  notificationListEl.innerHTML = state.notifications
    .slice(0, 8)
    .map(notification => `
      <div class="notification-card">
        <strong>${notification.message}</strong>
        <div class="muted">${new Date(notification.createdAt).toLocaleString()}</div>
      </div>
    `)
    .join('');
}

function renderCalendar() {
  const tasks = state.subjects.flatMap(subject => (subject.tasks || []).map(task => ({ ...task, subjectName: subject.name })));
  const days = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const items = tasks.filter(task => task.deadline && isSameDay(new Date(task.deadline), current));
    days.push({ date: current, items });
  }

  calendarViewEl.innerHTML = days
    .map(day => `
      <div class="calendar-day">
        <h4>${day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</h4>
        ${day.items.length ? day.items.map(item => `<div class="calendar-item">${item.title} (${item.subjectName})</div>`).join('') : '<span class="muted">No tasks</span>'}
      </div>
    `)
    .join('');
}

function isSameDay(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate();
}

function triggerDeadlineAlerts() {
  const allTasks = state.subjects.flatMap(subject => (subject.tasks || []).map(task => ({ ...task, subjectName: subject.name })));

  const dueSoonTasks = allTasks.filter(task => {
    if (!task.deadline || task.status === 'completed') return false;
    const deadline = new Date(task.deadline);
    const now = new Date();
    const diffMs = deadline - now;
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours <= 24 && diffHours > 0;
  });

  dueSoonTasks.forEach(task => {
    if (!task.reminderSent) {
      alert(`Reminder: "${task.title}" for ${task.subjectName} is due soon.`);
    }
  });
}

if (state.token) {
  fetchDashboard();
  showDashboard();
} else {
  showAuth();
}

setInterval(() => {
  if (state.token) {
    fetchDashboard();
  }
}, 20000);


