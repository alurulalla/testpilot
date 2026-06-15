/**
 * Recording — the "session service" seam.
 *
 * The app talks ONLY to the RecordingBackend interface (start / trace / assert /
 * stop). It's backed by managed Browserbase (browserbase-backend.ts); keeping the
 * app behind this interface is what let us swap engines during development without
 * touching routes or UI.
 */

/** A single thing the user did while recording. */
export type RecordedAction =
  | { type: 'navigate'; url: string; at: number }
  | { type: 'click';    selector: string; at: number }
  | { type: 'fill';     selector: string; value: string; at: number }
  | { type: 'select';   selector: string; value: string; at: number }
  | { type: 'check';    selector: string; checked: boolean; at: number }
  | { type: 'press';    selector: string; key: string; at: number }
  | { type: 'assert';   assertion: RecordedAssertion; at: number };

/** A user-marked expectation (the explicit half of "explicit + LLM fill-in"). */
export type RecordedAssertion =
  | { kind: 'visible';  selector: string }
  | { kind: 'text';     selector: string; expected: string }
  | { kind: 'value';    selector: string; expected: string }
  | { kind: 'url';      expected: string };

export interface StartRecordingOptions {
  /** TestPilot session this recording belongs to. */
  sessionId: string;
  orgId: string;
  /** Target app URL to open (started logged-in via the session's fixture). */
  url: string;
}

export interface RecordingHandle {
  recordingId: string;
  /**
   * URL to embed in the UI so the user can SEE and CONTROL the browser —
   * Browserbase's interactive Live View, rendered in an iframe.
   */
  viewUrl: string;
}

/** The one interface the app depends on (implemented by BrowserbaseBackend). */
export interface RecordingBackend {
  /** Provision a browser, navigate (logged in), inject the recorder. */
  start(opts: StartRecordingOptions): Promise<RecordingHandle>;
  /** Actions captured so far (for the live action list). */
  getTrace(recordingId: string): Promise<RecordedAction[]>;
  /** Flip the in-page recorder between "perform" and "assert" modes. */
  setAssertMode(recordingId: string, on: boolean): Promise<void>;
  /** Tear the browser down and return the final trace. */
  stop(recordingId: string): Promise<RecordedAction[]>;
  /** Whether the recording session is still alive (for the SSE heartbeat). */
  isLive(recordingId: string): boolean;
}
