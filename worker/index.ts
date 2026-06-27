import '@/lib/load-env';
import { runWorker } from './runner';

runWorker({ once: process.argv.includes('--once') }).catch(err => {
  console.error('[worker] fatal:', err);
  process.exitCode = 1;
});
