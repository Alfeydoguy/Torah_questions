const els = {
  codeCard: document.getElementById('code-card'),
  codeValue: document.getElementById('code-value'),
  copyCode: document.getElementById('copy-code'),
  forgetCode: document.getElementById('forget-code'),
  codeForm: document.getElementById('code-form'),
  codeInput: document.getElementById('code-input'),
  codeError: document.getElementById('code-error'),
  listError: document.getElementById('list-error'),
  list: document.getElementById('my-list'),
  empty: document.getElementById('my-empty'),
  template: document.getElementById('my-question-template'),
};

const topics = new Map();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function showMessage(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

function errorText(err) {
  return err instanceof TypeError
    ? "Couldn't reach the server. Check your internet connection and try again."
    : err.message;
}

async function loadTopics() {
  const groups = await (await fetch('/api/topics')).json();
  for (const group of groups) {
    for (const topic of group.topics) topics.set(topic.id, { ...topic, group: group.id });
  }
}

function showCodeForm() {
  els.codeCard.hidden = true;
  els.codeForm.hidden = false;
  els.list.replaceChildren();
  els.empty.hidden = true;
  showMessage(els.listError, '');
}

async function showQuestions(code) {
  try {
    const questions = await questionCode.fetchQuestions(code);
    const seenAt = questionCode.seenAt();
    els.codeForm.hidden = true;
    els.codeCard.hidden = false;
    els.codeValue.textContent = code;
    showMessage(els.listError, '');
    els.list.replaceChildren(...questions.map((q) => renderQuestion(q, seenAt)));
    els.empty.hidden = questions.length > 0;
    els.empty.textContent = 'No questions here yet. Questions you send from this device will show up here.';
    questionCode.markSeen();
  } catch (err) {
    showMessage(els.listError, errorText(err));
  }
}

function renderQuestion(question, seenAt) {
  const item = els.template.content.firstElementChild.cloneNode(true);
  const topic = topics.get(question.topic);
  const answered = question.status === 'answered';

  item.classList.toggle('is-answered', answered);

  const chip = item.querySelector('.chip');
  chip.textContent = topic ? `${topic.label} · ${topic.hebrew}` : question.topic;
  if (topic) chip.classList.add(`chip-${topic.group}`);

  const time = item.querySelector('time');
  time.dateTime = question.createdAt;
  time.textContent = `Asked ${dateFormat.format(new Date(question.createdAt))}`;

  const status = item.querySelector('.status');
  if (questionCode.isUnseen(question, seenAt)) {
    status.textContent = 'New answer';
    status.classList.add('status-fresh');
  } else {
    status.textContent = answered ? 'Answered' : 'Waiting for an answer';
  }

  item.querySelector('.question-text').textContent = question.question;
  const source = item.querySelector('.question-source');
  if (question.source) source.textContent = `Came up in: ${question.source}`;
  else source.remove();

  const answer = item.querySelector('.answer');
  const note = item.querySelector('.answer-note');
  if (question.answer) {
    answer.hidden = false;
    const when = question.answeredAt ? ` · ${dateFormat.format(new Date(question.answeredAt))}` : '';
    item.querySelector('.answer-label').textContent = `Answer${question.answeredBy ? ` from ${question.answeredBy}` : ''}${when}`;
    item.querySelector('.answer-text').textContent = question.answer;
    note.remove();
  } else if (answered) {
    note.textContent = 'A teacher marked this answered. They may have answered it in class or in person.';
  } else {
    note.textContent = "Your teachers haven't answered yet. Check back soon.";
  }

  return item;
}

els.codeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = els.codeForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage(els.codeError, '');
  try {
    const typed = els.codeInput.value;
    const questions = await questionCode.fetchQuestions(typed);
    if (!questions.length) {
      throw new Error("We couldn't find any questions with that code. Check it and try again.");
    }
    const code = typed.toUpperCase().replace(/[\s-]/g, '').match(/.{4}/g).join('-');
    questionCode.set(code);
    els.codeForm.reset();
    await showQuestions(code);
  } catch (err) {
    showMessage(els.codeError, errorText(err));
  } finally {
    button.disabled = false;
  }
});

els.copyCode.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.codeValue.textContent);
    els.copyCode.textContent = 'Copied';
  } catch {
    // Clipboard blocked: select the code so the student can copy it themselves.
    getSelection().selectAllChildren(els.codeValue);
    els.copyCode.textContent = 'Code selected';
  }
  setTimeout(() => { els.copyCode.textContent = 'Copy code'; }, 2500);
});

els.forgetCode.addEventListener('click', () => {
  questionCode.forget();
  showCodeForm();
  els.codeInput.focus();
});

function start() {
  const code = questionCode.get();
  if (code) showQuestions(code);
  else showCodeForm();
}

// Check again when the student comes back to this tab, in case a teacher answered.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') start();
});

loadTopics()
  .catch(() => {})
  .finally(start);
