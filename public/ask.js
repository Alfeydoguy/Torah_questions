const form = document.getElementById('ask-form');
const topicSelect = document.getElementById('topic');
const submitButton = form.querySelector('button[type="submit"]');
const formError = document.getElementById('form-error');
const thanks = document.getElementById('thanks');
const codeNote = document.getElementById('code-note');
const newAnswers = document.getElementById('new-answers');

async function loadTopics() {
  const res = await fetch('/api/topics');
  const groups = await res.json();
  for (const group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const topic of group.topics) {
      optgroup.append(new Option(`${topic.label} · ${topic.hebrew}`, topic.id));
    }
    topicSelect.append(optgroup);
  }
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

// Shows the "Not you?" note and counts answers the student hasn't seen yet.
async function refreshCodeState() {
  const code = questionCode.get();
  codeNote.hidden = !code;
  newAnswers.hidden = true;
  if (!code) return;
  try {
    const questions = await questionCode.fetchQuestions(code);
    const seenAt = questionCode.seenAt();
    const count = questions.filter((q) => questionCode.isUnseen(q, seenAt)).length;
    newAnswers.textContent = count;
    newAnswers.title = `${count} new ${count === 1 ? 'answer' : 'answers'}`;
    newAnswers.hidden = count === 0;
  } catch {
    // The badge is a bonus; the form works without it.
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';

  try {
    const data = Object.fromEntries(new FormData(form));
    const code = questionCode.get();
    if (code) data.code = code;

    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');

    questionCode.set(body.code);
    document.getElementById('thanks-code').textContent = body.code;

    // Keep the name and class so the next question is quicker to send.
    form.topic.value = '';
    form.question.value = '';
    form.source.value = '';
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
    refreshCodeState();
  } catch (err) {
    showError(err instanceof TypeError
      ? "Couldn't reach the server. Check your internet connection and try again."
      : err.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Send question';
  }
});

document.getElementById('ask-another').addEventListener('click', () => {
  thanks.hidden = true;
  form.hidden = false;
  topicSelect.focus();
});

// On a shared computer, the next student starts with their own code.
document.getElementById('start-fresh').addEventListener('click', () => {
  questionCode.forget();
  document.getElementById('name').value = '';
  document.getElementById('className').value = '';
  refreshCodeState();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshCodeState();
});

loadTopics().catch(() => showError("Couldn't load the topic list. Please refresh the page."));
refreshCodeState();
