import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Keeps every question in one JSON file. Writes go to a temp file first and
// are then renamed into place, so a crash mid-write can't corrupt the data.
export function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const questions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(questions, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    // Newest first. Questions are only ever appended, so file order is age order.
    list() {
      return questions.toReversed();
    },

    add(fields) {
      const question = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'new',
        ...fields,
      };
      questions.push(question);
      save();
      return question;
    },

    update(id, changes) {
      const question = questions.find((q) => q.id === id);
      if (!question) return null;
      Object.assign(question, changes);
      save();
      return question;
    },

    remove(id) {
      const index = questions.findIndex((q) => q.id === id);
      if (index === -1) return false;
      questions.splice(index, 1);
      save();
      return true;
    },
  };
}
