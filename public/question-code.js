// Remembers the student's question code on this device so they can find
// their answers later. Browsers can block storage (private browsing, for
// example), so every access is guarded and the site still works without it.
const questionCode = {
  CODE_KEY: 'torahTech.questionCode',
  SEEN_KEY: 'torahTech.answersSeenAt',

  get() {
    try { return localStorage.getItem(this.CODE_KEY); } catch { return null; }
  },
  set(code) {
    try { localStorage.setItem(this.CODE_KEY, code); } catch {}
  },
  forget() {
    try {
      localStorage.removeItem(this.CODE_KEY);
      localStorage.removeItem(this.SEEN_KEY);
    } catch {}
  },

  // When the student last looked at their answers, so newer ones can be marked.
  seenAt() {
    try { return localStorage.getItem(this.SEEN_KEY) ?? ''; } catch { return ''; }
  },
  markSeen() {
    try { localStorage.setItem(this.SEEN_KEY, new Date().toISOString()); } catch {}
  },
  isUnseen(question, seenAt = this.seenAt()) {
    return question.status === 'answered' && Boolean(question.answeredAt) && question.answeredAt > seenAt;
  },

  async fetchQuestions(code) {
    const res = await fetch('/api/my-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body.questions;
  },
};
