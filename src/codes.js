import crypto from 'node:crypto';

// Question codes let students find their own questions and answers without
// an account. Letters and digits that are easy to mix up (0/O, 1/I/L) are left
// out, and 12 characters from this set are far too many to guess.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

export function newCode() {
  let code = '';
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

// Accepts a code typed with any letter case, spaces, or dashes.
// Returns the bare 12-character code, or null if it isn't a valid code.
export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== LENGTH || [...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

export function formatCode(code) {
  return code.match(/.{4}/g).join('-');
}

// Only a hash of each code is saved, so the data file doesn't reveal them.
export function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}
