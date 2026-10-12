import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || fileURLToPath(new URL('./data/questions.json', import.meta.url));

let teacherPassword = process.env.TEACHER_PASSWORD;
if (!teacherPassword) {
  teacherPassword = crypto.randomBytes(6).toString('base64url');
  console.warn(`No TEACHER_PASSWORD is set, so this run uses a temporary one: ${teacherPassword}`);
  console.warn('Set TEACHER_PASSWORD in your .env file to choose a permanent password.');
}

const app = createApp({
  dataFile,
  teacherPassword,
  sessionSecret: process.env.SESSION_SECRET,
  trustProxy: Boolean(process.env.TRUST_PROXY),
});

app.listen(port, () => {
  console.log(`Torah Tech questions is running at http://localhost:${port}`);
  console.log(`Teachers sign in at http://localhost:${port}/teachers`);
});
