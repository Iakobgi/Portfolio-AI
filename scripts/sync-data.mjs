import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] || resolve(root, '../Portfolio2'));
// Validate both languages before updating either backend file.
const files = ['data-english.json', 'data-francais.json'].map(name => {
  const text = readFileSync(resolve(source, name), 'utf8');
  const data = JSON.parse(text);
  if (!data.personal || !data.skills?.technical || !data.skills?.learning || !data.apprenticeship) {
    throw new Error(`Missing portfolio facts in ${name}`);
  }
  return { name, text };
});
for (const { name, text } of files) writeFileSync(resolve(root, name), text);
console.log('Both backend knowledge files synchronized from:', source);
