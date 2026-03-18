const fs = require('fs');
const path = require('path');

const pagePath = path.join(process.cwd(), 'app', 'page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

const requiredMarkers = [
  'Fotopunkter',
  'Aktivt moment',
  'Manuell registrering (fallback)',
  'Sparade komponenter'
];

const forbiddenMarkers = [
  'Importera aggregat fran Excel',
  "mode === 'importera'",
  "setMode('importera')",
  'Motorbricka'
];

const missing = requiredMarkers.filter((marker) => !source.includes(marker));
const forbiddenFound = forbiddenMarkers.filter((marker) => source.includes(marker));

if (missing.length || forbiddenFound.length) {
  if (missing.length) {
    console.error(`UI-check misslyckades. Saknade markorer: ${missing.join(', ')}`);
  }
  if (forbiddenFound.length) {
    console.error(
      `UI-check misslyckades. Hittade gamla markorer: ${forbiddenFound.join(', ')}`
    );
  }
  process.exit(1);
}

console.log('UI-check OK: app/page.tsx innehaller forvantad version.');

