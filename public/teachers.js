const REFRESH_MS = 60 * 1000;

const els = {
  login: document.getElementById('login'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  board: document.getElementById('board'),
  boardError: document.getElementById('board-error'),
  logout: document.getElementById('logout'),
  refresh: document.getElementById('refresh'),
  tabs: document.querySelectorAll('.tabs button'),
  topicFilter: document.getElementById('filter-topic'),
  search: document.getElementById('filter-search'),
  list: document.getElementById('question-list'),
  empty: document.getElementById('empty'),
  updated: document.getElementById('updated'),
  template: document.getElementById('question-template'),
};

const state = {
  questions: [],
  topics: new Map(),
  status: 'new',
  topic: '',
  search: '',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

class SignedOutError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new SignedOutError();
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function showMessage(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

function reportError(err) {
  if (err instanceof SignedOutError) return;
  showMessage(els.boardError, err instanceof TypeError
    ? "Couldn't reach the server. Check your internet connection."
    : err.message);
}

function showLogin() {
  els.board.hidden = true;
  els.logout.hidden = true;
  els.login.hidden = false;
  document.getElementById('password').focus();
}

async function showBoard() {
  els.login.hidden = true;
  els.board.hidden = false;
  els.logout.hidden = false;
  await loadQuestions();
}

async function loadTopics() {
  const groups = await api('/api/topics');
  for (const group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const topic of group.topics) {
      state.topics.set(topic.id, { ...topic, group: group.id });
      optgroup.append(new Option(topic.label, topic.id));
    }
    els.topicFilter.append(optgroup);
  }
}

async function loadQuestions() {
  try {
    const { questions } = await api('/api/questions');
    state.questions = questions;
    showMessage(els.boardError, '');
    els.updated.textContent = `Updated at ${timeFormat.format(new Date())}`;
    render();
  } catch (err) {
    reportError(err);
  }
}

function matches(question) {
  if (state.status !== 'all' && question.status !== state.status) return false;
  if (state.topic && question.topic !== state.topic) return false;
  if (state.search) {
    const haystack = [question.question, question.source, question.name, question.className].join(' ').toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

function render() {
  const counts = { new: 0, answered: 0, all: state.questions.length };
  for (const q of state.questions) counts[q.status] += 1;
  for (const [status, count] of Object.entries(counts)) {
    document.querySelector(`[data-count="${status}"]`).textContent = count;
  }
  for (const tab of els.tabs) {
    tab.setAttribute('aria-pressed', String(tab.dataset.status === state.status));
  }

  const visible = state.questions.filter(matches);
  els.list.replaceChildren(...visible.map(renderQuestion));

  els.empty.hidden = visible.length > 0;
  if (!visible.length) {
    els.empty.textContent = state.questions.length === 0
      ? 'No questions yet. When students send one, it will show up here.'
      : state.status === 'new' && !state.topic && !state.search
        ? 'All caught up. There are no new questions.'
        : 'No questions match these filters.';
  }
}

function renderQuestion(question) {
  const item = els.template.content.firstElementChild.cloneNode(true);
  const topic = state.topics.get(question.topic);
  const answered = question.status === 'answered';

  item.classList.toggle('is-answered', answered);

  const chip = item.querySelector('.chip');
  chip.textContent = topic ? `${topic.label} · ${topic.hebrew}` : question.topic;
  if (topic) chip.classList.add(`chip-${topic.group}`);

  const time = item.querySelector('time');
  time.dateTime = question.createdAt;
  time.textContent = dateFormat.format(new Date(question.createdAt));

  item.querySelector('.status').textContent = answered ? 'Answered' : 'New';
  item.querySelector('.question-text').textContent = question.question;

  const source = item.querySelector('.question-source');
  if (question.source) source.textContent = `Came up in: ${question.source}`;
  else source.remove();

  const asker = item.querySelector('.asker');
  asker.textContent = [question.name || 'Anonymous', question.className].filter(Boolean).join(' · ');
  asker.classList.toggle('is-anonymous', !question.name);

  const toggle = item.querySelector('.toggle');
  toggle.textContent = answered ? 'Move back to new' : 'Mark answered';
  toggle.addEventListener('click', () => setStatus(question, answered ? 'new' : 'answered', toggle));

  const del = item.querySelector('.delete');
  del.addEventListener('click', () => deleteQuestion(question, del));

  return item;
}

async function setStatus(question, status, button) {
  button.disabled = true;
  try {
    const { question: updated } = await api(`/api/questions/${question.id}`, { method: 'PATCH', body: { status } });
    Object.assign(question, updated);
    render();
  } catch (err) {
    button.disabled = false;
    reportError(err);
  }
}

async function deleteQuestion(question, button) {
  if (!confirm("Delete this question? This can't be undone.")) return;
  button.disabled = true;
  try {
    await api(`/api/questions/${question.id}`, { method: 'DELETE' });
    state.questions = state.questions.filter((q) => q.id !== question.id);
    render();
  } catch (err) {
    button.disabled = false;
    reportError(err);
  }
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = els.loginForm.querySelector('button');
  button.disabled = true;
  showMessage(els.loginError, '');
  try {
    await api('/api/login', { method: 'POST', body: { password: els.loginForm.password.value } });
    els.loginForm.reset();
    await showBoard();
  } catch (err) {
    showMessage(els.loginError, err instanceof TypeError
      ? "Couldn't reach the server. Check your internet connection."
      : err.message);
  } finally {
    button.disabled = false;
  }
});

els.logout.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.questions = [];
  showLogin();
});

els.refresh.addEventListener('click', loadQuestions);

for (const tab of els.tabs) {
  tab.addEventListener('click', () => {
    state.status = tab.dataset.status;
    render();
  });
}

els.topicFilter.addEventListener('change', () => {
  state.topic = els.topicFilter.value;
  render();
});

els.search.addEventListener('input', () => {
  state.search = els.search.value.trim().toLowerCase();
  render();
});

// Check for new questions every minute while the board is open on screen.
setInterval(() => {
  if (!els.board.hidden && document.visibilityState === 'visible') loadQuestions();
}, REFRESH_MS);

async function start() {
  try {
    await loadTopics();
    const { teacher } = await api('/api/session');
    if (teacher) await showBoard();
    else showLogin();
  } catch (err) {
    showLogin();
    showMessage(els.loginError, "Couldn't reach the server. Please refresh the page.");
  }
}

start();
