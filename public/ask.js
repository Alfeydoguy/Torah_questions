const form = document.getElementById('ask-form');
const topicSelect = document.getElementById('topic');
const submitButton = form.querySelector('button[type="submit"]');
const formError = document.getElementById('form-error');
const thanks = document.getElementById('thanks');

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';

  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');

    // Keep the name and class so the next question is quicker to send.
    form.topic.value = '';
    form.question.value = '';
    form.source.value = '';
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
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

loadTopics().catch(() => showError("Couldn't load the topic list. Please refresh the page."));
