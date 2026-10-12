import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

const PASSWORD = 'test-password';

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

const validQuestion = {
  topic: 'shabbos',
  question: 'Can you open an umbrella on Shabbos?',
  source: 'Shulchan Aruch 315',
  name: 'Moshe',
  className: '10th grade',
};

describe('students', () => {
  test('pages and topics load', async () => {
    for (const page of ['/', '/teachers']) {
      const res = await request(page);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
    }
    const topics = await (await request('/api/topics')).json();
    assert.ok(topics.some((group) => group.topics.some((t) => t.id === 'gemara')));
  });

  test('can send a question', async () => {
    const res = await request('/api/questions', { method: 'POST', body: validQuestion });
    assert.equal(res.status, 201);
  });

  test('can ask anonymously', async () => {
    const res = await request('/api/questions', {
      method: 'POST',
      body: { topic: 'gemara', question: 'מה פירוש המילה "תיקו"?' },
    });
    assert.equal(res.status, 201);
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

  test('cannot read, change, or delete questions', async () => {
    assert.equal((await request('/api/questions')).status, 401);
    assert.equal((await request('/api/questions/abc', { method: 'PATCH', body: { status: 'answered' } })).status, 401);
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

  test('can read questions newest first, mark them answered, and delete them', async () => {
    const cookie = await signIn();
    assert.deepEqual(await (await request('/api/session', { cookie })).json(), { teacher: true });

    const { questions } = await (await request('/api/questions', { cookie })).json();
    assert.equal(questions.length, 2);
    const [anonymous, named] = questions;
    assert.equal(anonymous.topic, 'gemara');
    assert.equal(anonymous.name, '');
    assert.equal(named.name, 'Moshe');
    assert.equal(named.status, 'new');

    const patched = await request(`/api/questions/${named.id}`, { method: 'PATCH', cookie, body: { status: 'answered' } });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).question.status, 'answered');

    const badStatus = await request(`/api/questions/${named.id}`, { method: 'PATCH', cookie, body: { status: 'deleted' } });
    assert.equal(badStatus.status, 400);

    assert.equal((await request(`/api/questions/${anonymous.id}`, { method: 'DELETE', cookie })).status, 204);
    assert.equal((await request(`/api/questions/${anonymous.id}`, { method: 'DELETE', cookie })).status, 404);

    const remaining = (await (await request('/api/questions', { cookie })).json()).questions;
    assert.deepEqual(remaining.map((q) => [q.id, q.status]), [[named.id, 'answered']]);
  });

  test('questions are saved to disk', () => {
    const reloaded = createStore(dataFile).list();
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].question, validQuestion.question);
  });
});

test('the hidden bot trap field drops the submission', async () => {
  const before = createStore(dataFile).list().length;
  const res = await request('/api/questions', { method: 'POST', body: { ...validQuestion, website: 'http://spam.example' } });
  assert.equal(res.status, 201);
  assert.equal(createStore(dataFile).list().length, before);
});
