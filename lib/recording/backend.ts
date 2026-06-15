/**
 * The recording backend.
 *
 * After trialling several engines (our own Chromium + JPEG/SSE viewer, a
 * self-hosted Steel/Selkies/noVNC remote CDP), we settled on managed
 * **Browserbase**: no infra to run, a smooth interactive Live View, and reliable
 * CDP-based capture. Routes and UI import `recordingBackend` from here and never
 * reference a concrete backend, so swapping engines later stays a one-file change.
 *
 * Requires BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID (see browserbase-backend.ts).
 */
import type { RecordingBackend } from './types';
import { BrowserbaseBackend } from './browserbase-backend';

// Cache on globalThis so Next.js hot-reload / multiple imports share one instance
// (and therefore one in-memory map of live recordings).
declare global {
  // eslint-disable-next-line no-var
  var __tp_recordingBackend: RecordingBackend | undefined;
}

export const recordingBackend: RecordingBackend =
  globalThis.__tp_recordingBackend ?? (globalThis.__tp_recordingBackend = new BrowserbaseBackend());
