import * as crypto from 'crypto';

import * as Sentry from '@sentry/node';

const { transport } = await import('./test-transport.js');

// close both processes after 5 seconds
setTimeout(() => {
  process.exit();
}, 5000);

Sentry.init({
  dsn: 'https://public@dsn.ingest.sentry.io/1337',
  release: '1.0',
  debug: true,
  autoSessionTracking: false,
  transport,
});

await Sentry.enableAnrDetection({ captureStackTrace: true, anrThreshold: 200 });

function longWork() {
  for (let i = 0; i < 100; i++) {
    const salt = crypto.randomBytes(128).toString('base64');
    // eslint-disable-next-line no-unused-vars
    const hash = crypto.pbkdf2Sync('myPassword', salt, 10000, 512, 'sha512');
  }
}

setTimeout(() => {
  longWork();
}, 1000);
