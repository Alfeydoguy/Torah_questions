import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { formatCode, hashCode, newCode, normalizeCode } from './codes.js';
import { createStore } from './store.js';
import { TOPIC_GROUPS, isTopic } from './topics.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SESSION_COOKIE = 'tt_teacher';
const SESSION_MS = 12 * 60 * 60 * 1000;

// Longest allowed value for each text field a student can fill in.
const FIELDS = {
  question: { label: 'Question', max: 4000 },
  source: { label: 'Source', max: 150 },
  name: { label: 'Name', max: 80 },
  className: { label: 'Class', max: 40 },
};
const ANSWER_MAX = 6000;
const ANSWERED_BY_MAX = 80;

// What a question looks like once it's back to waiting for an answer.
const UNANSWERED = { status: 'new', answer: '', answeredBy: '', answeredAt: null };

export function createApp({ dataFile, teacherPassword, sessionSecret, trustProxy = false }) {
  if (!teacherPassword) throw new Error('A teacher password is required.');
  sessionSecret ||= crypto.randomBytes(32).toString('hex');

  const store = createStore(dataFile);
  const submitLimiter = createRateLimiter({ max: 60, windowMs: 5 * 60 * 1000 });
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const lookupLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

  const sign = (value) => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');

  function isTeacher(req) {
    const [expires, signature] = (readCookie(req, SESSION_COOKIE) ?? '').split('.');
    if (!signature || !(Number(expires) > Date.now())) return false;
    return safeEqual(signature, sign(expires));
  }

  function requireTeacher(req, res, next) {
    if (isTeacher(req)) return next();
    res.status(401).json({ error: 'Please sign in again.' });
  }

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.get('/api/topics', (req, res) => {
    res.json(TOPIC_GROUPS);
  });

  // Students: send a question. The reply includes the student's question
  // code; sending it back with later questions keeps them all together.
  app.post('/api/questions', (req, res) => {
    if (submitLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many questions were sent from this connection. Please wait a few minutes and try again.' });
    }
    const body = req.body ?? {};
    // Bots fill in every field, but students never see this hidden one.
    // Pretend it worked so the bot doesn't try again.
    if (body.website) return res.status(201).json({ ok: true });

    const { value, error } = parseSubmission(body);
    if (error) return res.status(400).json({ error });

    const code = normalizeCode(body.code) ?? newCode();
    submitLimiter.hit(req.ip);
    store.add({ ...value, ...UNANSWERED, codeHash: hashCode(code) });
    res.status(201).json({ ok: true, code: formatCode(code) });
  });

  // Students: see the questions sent with a code, and any answers.
  // POST keeps the code out of URLs and server logs.
  app.post('/api/my-questions', (req, res) => {
    if (lookupLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many codes were tried from this connection. Please wait 15 minutes and try again.' });
    }
    const code = normalizeCode(req.body?.code);
    if (!code) {
      lookupLimiter.hit(req.ip);
      return res.status(400).json({ error: "That isn't a question code. Codes have 12 letters and numbers, like K7QF-2MXP-9TQA." });
    }
    const codeHash = hashCode(code);
    const questions = store.list().filter((q) => q.codeHash === codeHash).map(forStudent);
    if (!questions.length) lookupLimiter.hit(req.ip);
    res.json({ code: formatCode(code), questions });
  });

  app.get('/api/session', (req, res) => {
    res.json({ teacher: isTeacher(req) });
  });

  app.post('/api/login', (req, res) => {
    if (loginLimiter.isLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Please wait 15 minutes and try again.' });
    }
    const password = req.body?.password;
    if (typeof password !== 'string' || !safeEqual(password, teacherPassword)) {
      loginLimiter.hit(req.ip);
      return res.status(401).json({ error: 'That password is not correct.' });
    }
    const expires = String(Date.now() + SESSION_MS);
    res.cookie(SESSION_COOKIE, `${expires}.${sign(expires)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: SESSION_MS,
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/questions', requireTeacher, (req, res) => {
    res.json({ questions: store.list().map(forTeacher) });
  });

  // Teachers: write or remove an answer, or change a question's status.
  app.patch('/api/questions/:id', requireTeacher, (req, res) => {
    const { value, error } = parseTeacherUpdate(req.body ?? {});
    if (error) return res.status(400).json({ error });
    const question = store.update(req.params.id, value);
    if (!question) return res.status(404).json({ error: 'That question no longer exists.' });
    res.json({ question: forTeacher(question) });
  });

  app.delete('/api/questions/:id', requireTeacher, (req, res) => {
    if (!store.remove(req.params.id)) return res.status(404).json({ error: 'That question no longer exists.' });
    res.status(204).end();
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  return app;
}

function parseSubmission(body) {
  const value = {};
  for (const [key, { label, max }] of Object.entries(FIELDS)) {
    const raw = body[key] ?? '';
    if (typeof raw !== 'string') return { error: `${label} must be text.` };
    const text = raw.trim();
    if (text.length > max) return { error: `${label} is too long (the limit is ${max} characters).` };
    value[key] = text;
  }
  if (value.question.length < 5) return { error: 'Please write out your question.' };
  if (!isTopic(body.topic)) return { error: 'Please choose a topic.' };
  value.topic = body.topic;
  return { value };
}

// A teacher can send { answer, answeredBy } to answer (an empty answer removes
// it), or { status } to mark a question answered without writing anything,
// for example when they answered in class.
function parseTeacherUpdate(body) {
  if ('answer' in body) {
    const { answer, answeredBy = '' } = body;
    if (typeof answer !== 'string' || typeof answeredBy !== 'string') return { error: 'The answer must be text.' };
    const text = answer.trim();
    const by = answeredBy.trim();
    if (text.length > ANSWER_MAX) return { error: `The answer is too long (the limit is ${ANSWER_MAX} characters).` };
    if (by.length > ANSWERED_BY_MAX) return { error: `The name is too long (the limit is ${ANSWERED_BY_MAX} characters).` };
    if (!text) return { value: UNANSWERED };
    return { value: { status: 'answered', answer: text, answeredBy: by, answeredAt: new Date().toISOString() } };
  }
  if (body.status === 'answered') return { value: { status: 'answered', answeredAt: new Date().toISOString() } };
  if (body.status === 'new') return { value: UNANSWERED };
  return { error: 'Unknown status.' };
}

// Teachers see everything except the hashed student code.
function forTeacher({ codeHash, ...question }) {
  return { answer: '', answeredBy: '', answeredAt: null, ...question };
}

// Students see their own question and the answer, nothing else.
function forStudent(q) {
  return {
    id: q.id,
    createdAt: q.createdAt,
    topic: q.topic,
    question: q.question,
    source: q.source,
    status: q.status,
    answer: q.answer ?? '',
    answeredBy: q.answeredBy ?? '',
    answeredAt: q.answeredAt ?? null,
  };
}

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// Compares secrets in constant time so response timing can't leak them.
function safeEqual(a, b) {
  const hash = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Counts requests per IP address in fixed time windows. The limits are loose
// on purpose: a whole class on the school wifi shares one address.
function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    isLimited(key) {
      const entry = hits.get(key);
      return Boolean(entry && entry.resetAt > Date.now() && entry.count >= max);
    },
    hit(key) {
      const now = Date.now();
      if (hits.size > 10_000) {
        for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
      }
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
    },
  };
}
