import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './store.js';
import { TOPIC_GROUPS, isTopic } from './topics.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SESSION_COOKIE = 'tt_teacher';
const SESSION_MS = 12 * 60 * 60 * 1000;
const STATUSES = ['new', 'answered'];

// Longest allowed value for each text field a student can fill in.
const FIELDS = {
  question: { label: 'Question', max: 4000 },
  source: { label: 'Source', max: 150 },
  name: { label: 'Name', max: 80 },
  className: { label: 'Class', max: 40 },
};

export function createApp({ dataFile, teacherPassword, sessionSecret, trustProxy = false }) {
  if (!teacherPassword) throw new Error('A teacher password is required.');
  sessionSecret ||= crypto.randomBytes(32).toString('hex');

  const store = createStore(dataFile);
  const submitLimiter = createRateLimiter({ max: 60, windowMs: 5 * 60 * 1000 });
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

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
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.get('/api/topics', (req, res) => {
    res.json(TOPIC_GROUPS);
  });

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

    submitLimiter.hit(req.ip);
    store.add(value);
    res.status(201).json({ ok: true });
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
    res.json({ questions: store.list() });
  });

  app.patch('/api/questions/:id', requireTeacher, (req, res) => {
    const status = req.body?.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    const question = store.update(req.params.id, { status });
    if (!question) return res.status(404).json({ error: 'That question no longer exists.' });
    res.json({ question });
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
