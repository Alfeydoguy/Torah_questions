import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

const PASSWORD = 'test-password';
const CODE_FORMAT = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

let server;
let baseUrl;
let dataDir;
let dataFile;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torah-questions-'));
  dataFile = path.join(dataDir, 'questions.json');
  const app = createApp({ dataFile, teacherPassword: PASSWORD, sessionSecret: 'test-secret' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return fetch(baseUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn() {
  const res = await request('/api/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function ask(body) {
  const res = await request('/api/questions', { method: 'POST', body });
  assert.equal(res.status, 201);
  return (await res.json()).code;
}

async function myQuestions(code) {
  const res = await request('/api/my-questions', { method: 'POST', body: { code } });
  return { status: res.status, body: await res.json() };
}

async function teacherQuestions(cookie) {
  return (await (await request('/api/questions', { cookie })).json()).questions;
}

const validQuestion = {
  topic: 'shabbos',
  question: 'Can you open an umbrella on Shabbos?',
  source: 'Shulchan Aruch 315',
  name: 'Moshe',
  className: '10th grade',
};

// Shared between tests that run in order below.
let moshesCode;
let anonymousCode;

describe('students', () => {
  test('pages and topics load', async () => {
    for (const page of ['/', '/my-questions', '/teachers']) {
      const res = await request(page);
      assert.equal(res.status, 200, page);
      assert.match(res.headers.get('content-type'), /text\/html/);
    }
    const topics = await (await request('/api/topics')).json();
    assert.ok(topics.some((group) => group.topics.some((t) => t.id === 'gemara')));
  });

  test('sending a question gives back a question code', async () => {
    moshesCode = await ask(validQuestion);
    assert.match(moshesCode, CODE_FORMAT);
  });

  test('sending another question with the code keeps the same code', async () => {
    const code = await ask({ ...validQuestion, topic: 'kashrus', question: 'How long do I wait after meat?', code: moshesCode });
    assert.equal(code, moshesCode);
  });

  test('can ask anonymously, and gets a different code', async () => {
    anonymousCode = await ask({ topic: 'gemara', question: 'מה פירוש המילה "תיקו"?' });
    assert.match(anonymousCode, CODE_FORMAT);
    assert.notEqual(anonymousCode, moshesCode);
  });

  test('an invalid code on a new question is replaced with a fresh one', async () => {
    const code = await ask({ ...validQuestion, code: 'not a code' });
    assert.match(code, CODE_FORMAT);
    assert.notEqual(code, moshesCode);
  });

  test('my questions shows only the questions sent with that code', async () => {
    const { status, body } = await myQuestions(moshesCode);
    assert.equal(status, 200);
    assert.equal(body.code, moshesCode);
    assert.deepEqual(body.questions.map((q) => q.topic), ['kashrus', 'shabbos']);
    for (const q of body.questions) {
      assert.equal(q.status, 'new');
      assert.equal(q.answer, '');
      assert.equal(q.name, undefined);
      assert.equal(q.codeHash, undefined);
    }
  });

  test('codes work typed in lowercase without dashes', async () => {
    const { body } = await myQuestions(moshesCode.toLowerCase().replaceAll('-', ''));
    assert.equal(body.questions.length, 2);
  });

  test('an unknown code finds nothing, and a malformed one is rejected', async () => {
    const unknown = await myQuestions('AAAA-AAAA-AAAA');
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body.questions, []);

    for (const code of ['', 'ABC', 'IIII-OOOO-LLLL', 12, null]) {
      const { status, body } = await myQuestions(code);
      assert.equal(status, 400, String(code));
      assert.ok(body.error);
    }
  });

  test('bad submissions are rejected', async () => {
    const cases = [
      { ...validQuestion, topic: 'not-a-topic' },
      { ...validQuestion, topic: undefined },
      { ...validQuestion, question: '   ' },
      { ...validQuestion, question: 'x'.repeat(4001) },
      { ...validQuestion, name: { $ne: '' } },
    ];
    for (const body of cases) {
      const res = await request('/api/questions', { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.ok((await res.json()).error);
    }
  });

  test('cannot read, answer, or delete questions on the teacher board', async () => {
    assert.equal((await request('/api/questions')).status, 401);
    assert.equal((await request('/api/questions/abc', { method: 'PATCH', body: { answer: 'hi' } })).status, 401);
    assert.equal((await request('/api/questions/abc', { method: 'DELETE' })).status, 401);
  });

  test('a forged session cookie is rejected', async () => {
    const forged = `tt_teacher=${Date.now() + 100000}.not-a-real-signature`;
    assert.equal((await request('/api/questions', { cookie: forged })).status, 401);
  });
});

describe('teachers', () => {
  test('a wrong password is rejected', async () => {
    const res = await request('/api/login', { method: 'POST', body: { password: 'nope' } });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  test('see every question newest first, without student codes', async () => {
    const cookie = await signIn();
    assert.deepEqual(await (await request('/api/session', { cookie })).json(), { teacher: true });

    const questions = await teacherQuestions(cookie);
    assert.equal(questions.length, 4);
    assert.equal(questions[1].topic, 'gemara');
    assert.equal(questions[1].name, '');
    assert.equal(questions[3].name, 'Moshe');
    for (const q of questions) {
      assert.equal(q.codeHash, undefined);
      assert.equal(q.status, 'new');
    }
  });

  test('a written answer shows up for the student who asked', async () => {
    const cookie = await signIn();
    const gemara = (await teacherQuestions(cookie)).find((q) => q.topic === 'gemara');

    const res = await request(`/api/questions/${gemara.id}`, {
      method: 'PATCH',
      cookie,
      body: { answer: '  תיקו means the question stands unresolved.  ', answeredBy: 'Rabbi Levi' },
    });
    assert.equal(res.status, 200);
    const { question } = await res.json();
    assert.equal(question.status, 'answered');
    assert.equal(question.answer, 'תיקו means the question stands unresolved.');
    assert.equal(question.answeredBy, 'Rabbi Levi');
    assert.ok(question.answeredAt);

    const [mine] = (await myQuestions(anonymousCode)).body.questions;
    assert.equal(mine.status, 'answered');
    assert.equal(mine.answer, question.answer);
    assert.equal(mine.answeredBy, 'Rabbi Levi');

    // Moshe's questions are untouched.
    assert.ok((await myQuestions(moshesCode)).body.questions.every((q) => q.status === 'new'));
  });

  test('removing an answer, or moving a question back to new, clears the answer', async () => {
    const cookie = await signIn();
    const gemara = (await teacherQuestions(cookie)).find((q) => q.topic === 'gemara');
    const patch = (body) => request(`/api/questions/${gemara.id}`, { method: 'PATCH', cookie, body });

    let question = (await (await patch({ answer: '   ' })).json()).question;
    assert.deepEqual([question.status, question.answer, question.answeredAt], ['new', '', null]);

    await patch({ answer: 'An answer', answeredBy: '' });
    question = (await (await patch({ status: 'new' })).json()).question;
    assert.deepEqual([question.status, question.answer], ['new', '']);
  });

  test('can mark a question answered without writing an answer', async () => {
    const cookie = await signIn();
    const shabbos = (await myQuestions(moshesCode)).body.questions.find((q) => q.topic === 'shabbos');
    const res = await request(`/api/questions/${shabbos.id}`, { method: 'PATCH', cookie, body: { status: 'answered' } });
    assert.equal(res.status, 200);
    const mine = (await myQuestions(moshesCode)).body.questions.find((q) => q.id === shabbos.id);
    assert.deepEqual([mine.status, mine.answer], ['answered', '']);
  });

  test('bad updates are rejected', async () => {
    const cookie = await signIn();
    const [first] = await teacherQuestions(cookie);
    const patch = (body) => request(`/api/questions/${first.id}`, { method: 'PATCH', cookie, body });
    assert.equal((await patch({ status: 'deleted' })).status, 400);
    assert.equal((await patch({ answer: 42 })).status, 400);
    assert.equal((await patch({ answer: 'x'.repeat(6001) })).status, 400);
    assert.equal((await patch({ answer: 'ok', answeredBy: 'x'.repeat(81) })).status, 400);
    assert.equal((await request('/api/questions/missing', { method: 'PATCH', cookie, body: { status: 'new' } })).status, 404);
  });

  test('can delete a question', async () => {
    const cookie = await signIn();
    const before = await teacherQuestions(cookie);
    const target = before.find((q) => q.topic === 'kashrus');
    assert.equal((await request(`/api/questions/${target.id}`, { method: 'DELETE', cookie })).status, 204);
    assert.equal((await request(`/api/questions/${target.id}`, { method: 'DELETE', cookie })).status, 404);
    assert.equal((await teacherQuestions(cookie)).length, before.length - 1);
    assert.equal((await myQuestions(moshesCode)).body.questions.length, 1);
  });

  test('questions and answers are saved to disk', () => {
    const saved = createStore(dataFile).list();
    assert.equal(saved.length, 3);
    assert.ok(saved.every((q) => /^[0-9a-f]{64}$/.test(q.codeHash)));
    assert.ok(!JSON.stringify(saved).includes(moshesCode));
  });
});

test('the hidden bot trap field drops the submission', async () => {
  const before = createStore(dataFile).list().length;
  const res = await request('/api/questions', { method: 'POST', body: { ...validQuestion, website: 'http://spam.example' } });
  assert.equal(res.status, 201);
  assert.equal(createStore(dataFile).list().length, before);
});
