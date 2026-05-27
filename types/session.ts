export type SessionStatus =
  | 'idle'
  | 'exploring'
  | 'generating'
  | 'running'
  | 'fixing'
  | 'complete'
  | 'failed'
  | 'figma-checking';

export interface TestStats {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

export interface TestResult {
  code: number;
  duration: number;
  stats: TestStats;
  output: string;
  /** Relative paths (from workspace dir) to recorded .webm video files */
  videos: string[];
}

export interface FixResult {
  fixed: boolean;
  filesChanged: number;
}

export interface FigmaComparison {
  frameName: string;
  url: string;
  /** Relative path (from workspace dir) to the downloaded Figma frame PNG */
  figmaImagePath: string;
  /** Relative path (from workspace dir) to the live Playwright screenshot */
  screenshotPath: string;
}

export interface FigmaResult {
  comparisons: FigmaComparison[];
  testFile: string; // relative path to generated figma-visual.spec.ts
}

export interface PageInfo {
  url: string;
  depth: number;
  title: string;
  status_code: number | null;
  elements: Record<string, unknown>;
  child_urls: string[];
  screenshot: string;
  error: string | null;
}

export interface SiteMap {
  start_url: string;
  total_pages: number;
  pages: PageInfo[];
}

export interface LogEntry {
  ts: number;
  msg: string;
  level: 'info' | 'error' | 'success';
}

export type ScenarioStatus =
  | 'idle'
  | 'searching'
  | 'found'
  | 'generating'
  | 'ready'
  | 'running'
  | 'done'
  | 'failed';

/** One entry in the "available tests" list shown to the user. */
export interface AvailableTest {
  /** Absolute path on disk */
  testFile: string;
  /** Filename only, e.g. "homepage.spec.ts" */
  fileName: string;
  /** Individual test() names inside the file */
  testNames: string[];
}

export interface ScenarioResult {
  description: string;
  status: ScenarioStatus;
  /** Whether the test was found in existing files (true) or freshly generated (false) */
  wasFound: boolean;
  testFile: string | null;
  testContent: string | null;
  /** Name(s) of the matched / generated test(s) */
  matchedTests: string[];
  /** All spec files discovered in the workspace (shown in the available-tests list) */
  availableTests: AvailableTest[];
  /** Relative path(s) to .webm video files produced by the run */
  videos: string[];
  /** Test stats after execution */
  testResult: TestResult | null;
  error: string | null;
}

export interface Session {
  id: string;
  url: string;
  status: SessionStatus;
  logs: LogEntry[];
  siteMap: SiteMap | null;
  testFiles: string[];
  testResult: TestResult | null;
  fixResult: FixResult | null;
  figmaResult: FigmaResult | null;
  figmaFileUrl: string | null;
  iteration: number;
  error: string | null;
  maxPages: number;
  headedMode: boolean;
  /** Scenario-based test runner state */
  scenarioResult: ScenarioResult | null;
  createdAt: number;
  updatedAt: number;
}
