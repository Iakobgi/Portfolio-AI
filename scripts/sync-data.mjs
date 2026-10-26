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
  if (!data.skills.levels || !data.skills.levelDescriptions || !data.skills.levelPolicy) {
    throw new Error(`Missing skill proficiency data in ${name}; update the Portfolio2 source first`);
  }
  const listedSkills = new Set([...data.skills.technical, ...data.skills.learning]);
  const learningLevels = new Set(['beginner', 'practicing']);
  for (const [skill, level] of Object.entries(data.skills.levels)) {
    if (!listedSkills.has(skill) || !['beginner', 'practicing', 'familiar', 'confident'].includes(level)) {
      throw new Error(`Invalid skill proficiency for ${skill} in ${name}`);
    }
    if (!data.skills.levelDescriptions[level]) throw new Error(`Missing description for ${level} in ${name}`);
    const category = learningLevels.has(level) ? 'learning' : 'technical';
    if (!data.skills[category].includes(skill)) throw new Error(`Skill category contradicts proficiency for ${skill} in ${name}`);
  }
  return { name, text };
});
for (const { name, text } of files) writeFileSync(resolve(root, name), text);
console.log('Both backend knowledge files synchronized from:', source);
