export type SessionStatus =
  | 'idle'
  | 'exploring'
  | 'analyzing'
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

// ── Failure triage ────────────────────────────────────────────────────────────

/** Root-cause verdict for a single failing test */
export type FailureVerdict = 'test_bug' | 'app_bug' | 'ambiguous';

/**
 * Per-test classification produced by the triage LLM call.
 * - test_bug  → selector broken, wrong URL, timing issue — fix the test
 * - app_bug   → test matches the docs but the app doesn't deliver — real issue, don't hide it
 * - ambiguous → can't tell; heal conservatively
 */
export interface FailureAnalysis {
  testName: string;
  file: string;
  error: string;
  verdict: FailureVerdict;
  reasoning: string;
}

export interface TriageResult {
  analyses: FailureAnalysis[];
  testBugCount: number;
  appBugCount: number;
  ambiguousCount: number;
  /** true when there are test_bug or ambiguous failures worth auto-healing */
  selfHealRecommended: boolean;
  triageAt: number;
}

export interface FigmaDiscrepancy {
  severity: 'high' | 'medium' | 'low';
  element: string;
  issue: string;
  figmaValue?: string;
  liveValue?: string;
}

export interface FigmaComparison {
  frameName: string;
  url: string;
  /** Relative path (from workspace dir) to the downloaded Figma frame PNG */
  figmaImagePath: string;
  /** Relative path (from workspace dir) to the live Playwright screenshot */
  screenshotPath: string;
  /** Relative path (from workspace dir) to the pixel-diff PNG (red highlights on dark base) */
  diffImagePath?: string;
  /** DOM-level discrepancies found by LLM comparison */
  discrepancies?: FigmaDiscrepancy[];
  /** 0-100 match score (100 = no discrepancies found) */
  matchScore?: number;
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

// ── Coverage gap analysis ─────────────────────────────────────────────────────

/** A feature/page that is not covered by the existing imported tests. */
export interface CoverageGap {
  id: string;
  pageUrl: string;
  pageTitle: string;
  feature: string;
  suggestedTestNames: string[];
}

/** Result of comparing existing tests against the crawled site. */
export interface CoverageAnalysis {
  gaps: CoverageGap[];
  /** IDs of gaps the user has selected to generate tests for */
  selectedGapIds: string[];
  coveredCount: number;
  totalFeatures: number;
  analyzedAt: number;
}

// ── Imported Playwright project ───────────────────────────────────────────────

/** One suite (file or describe block) from an imported Playwright project. */
export interface ImportedUseCase {
  file: string;
  suite: string;
  tests: string[];
}

/** Metadata about a Playwright project imported via ZIP upload. */
export interface ImportedProject {
  fileName: string;
  useCases: ImportedUseCase[];
  specFilesCount: number;
  importedAt: number;
}

/** A manually added (or doc-extracted) user flow to be covered by tests. */
export interface UserFlow {
  id: string;
  title: string;
  description: string;
  /** Optional numbered steps */
  steps: string[];
  addedAt: number;
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
  /** Triage classification for the most recent failing test run */
  triageResult: TriageResult | null;
  figmaResult: FigmaResult | null;
  figmaFileUrl: string | null;
  iteration: number;
  error: string | null;
  maxPages: number;
  headedMode: boolean;
  /** Scenario-based test runner state */
  scenarioResult: ScenarioResult | null;
  /** Raw content of the uploaded product-documentation file */
  contextDoc: string | null;
  /** Original filename of the uploaded doc (display only) */
  contextDocName: string | null;
  /** User-defined flows the generator must cover */
  userFlows: UserFlow[];
  /** Playwright project imported via ZIP upload — use cases injected into generation */
  importedProject: ImportedProject | null;
  /** Coverage gap analysis produced after crawling the site against imported tests */
  coverageAnalysis: CoverageAnalysis | null;
  createdAt: number;
  updatedAt: number;
}
