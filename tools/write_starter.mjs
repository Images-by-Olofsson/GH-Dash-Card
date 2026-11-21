// Writes examples/card.yaml = the clean starter (no devices), from the card's own starterConfig.
import fs from 'fs';
import { starterConfig } from '../dist/gh-dash.js';

const c = starterConfig('/local/community/GH-Dash/plan.png');
const q = (v) => (typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v));
const rect = (r) => `x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h}`;
const lines = [
  '# GH-Dash starting configuration: the example plan, its rooms and the Console/Terminal',
  '# info button. NO devices: add your own lamps/TV with the pencil (edit) button on the card.',
  '# This is what you get when you add the "GH-Dash floor plan" card in Home Assistant.',
  '# image: the plan installed with the card (Marketplace) - change it if your path differs.',
  `type: ${c.type}`,
  `image: ${c.image}`,
  'fit: true',
  'buttons:',
];
c.buttons.forEach((b) => {
  lines.push(`  - label: ${q(b.label)}`);
  Object.entries(b).filter(([k]) => k !== 'label').forEach(([k, v]) => lines.push(`    ${k}: ${q(v)}`));
});
lines.push('rooms:');
c.rooms.forEach((r) => {
  lines.push(`  - name: ${q(r.name)}`);
  if (r.parts) {
    lines.push('    parts:');
    r.parts.forEach((p) => lines.push(`      - { ${rect(p)} }`));
  } else {
    lines.push(`    ${rect(r).split(', ').join('\n    ')}`);
  }
});
fs.writeFileSync('examples/card.yaml', lines.join('\n') + '\n');
console.log('wrote examples/card.yaml:', c.rooms.length, 'rooms,', c.buttons.length, 'button');
