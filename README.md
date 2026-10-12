# Torah Tech Questions

A question box for Torah Tech. Students send questions on halacha and Torah,
and teachers read them on a private question board.

- **Students** (`/`): pick a topic, type a question in English or Hebrew, and
  optionally add where it came up, their name, and their class. Leaving the
  name blank sends the question anonymously.
- **Teachers** (`/teachers`): sign in with the teacher password to see every
  question, newest first. Filter by topic, search, mark questions answered,
  and delete ones you don't need. The board checks for new questions every
  minute.

## Running it

You need [Node.js](https://nodejs.org) 22.9 or newer.

```sh
npm install
cp .env.example .env    # then open .env and set TEACHER_PASSWORD
npm start
```

Open http://localhost:3000 for the student page and
http://localhost:3000/teachers for the teacher board.

If you don't set `TEACHER_PASSWORD`, a temporary password is printed in the
terminal each time the site starts.

## Settings

Put these in `.env` (or set them in your hosting service's settings):

| Setting            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `TEACHER_PASSWORD` | The password teachers use to sign in.                                        |
| `SESSION_SECRET`   | Any long random string. Keeps teachers signed in when the site restarts.     |
| `PORT`             | The port to run on (default `3000`).                                         |
| `DATA_FILE`        | Where questions are saved (default `data/questions.json`).                   |
| `TRUST_PROXY`      | Set to `1` when hosting behind a proxy such as Render, Railway, or Fly.io.   |

## Changing the topics

Edit `src/topics.js`. The student form and the teacher filter both use that
list. Once students have used a topic, don't change its `id`, or older
questions will lose their label.

## Where the questions are stored

Every question is saved in one file, `data/questions.json`. To back up the
questions, copy that file.

When you put the site online, pick a host with a **persistent disk** (for
example Render with a disk, Railway with a volume, Fly.io with a volume, or a
computer at the yeshiva). Hosts without one, such as Vercel, erase files when
they restart, and the questions would be lost.

## Tests

```sh
npm test
```
