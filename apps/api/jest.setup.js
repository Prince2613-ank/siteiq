// Minimal .env loader for the test process — no dotenv dependency needed.
// Integration tests (matching.service.spec.ts, candidate-confirmation.service.spec.ts)
// need DATABASE_URL to reach the same dev Postgres the API/worker use, seeded
// with the parcel mirror fixture (npm run mirror:load) before running.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}
