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
  /** Per-test outcomes: "<file> › <title>" → passed | failed | skipped */
  cases?: Record<string, 'passed' | 'failed' | 'skipped'>;
}

export interface FixResult {
  fixed: boolean;
  filesChanged: number;
}

// ── Failure triage ────────────────────────────────────────────────────────────

/**
 * Root-cause verdict for a single failing test.
 * - test_bug    → selector broken, wrong URL, timing issue — fix the test
 * - app_bug     → test matches the docs but the app doesn't deliver — real issue, don't hide it
 * - setup_error → login/auth/env/fixture failure — the test never got to run its
 *                 assertions. NOT the test's fault and NOT an app bug; healing the
 *                 test body won't help. Fix credentials/selectors/config.
 * - ambiguous   → can't tell; heal conservatively
 */
export type FailureVerdict = 'test_bug' | 'app_bug' | 'setup_error' | 'ambiguous';

/** How a verdict was reached — a cheap deterministic rule, or the LLM. */
export type TriageSource = 'rule' | 'llm';

/**
 * Per-test classification. Produced first by a deterministic rule engine; only
 * the genuinely unclear ones are escalated to the LLM.
 */
export interface FailureAnalysis {
  testName: string;
  file: string;
  error: string;
  verdict: FailureVerdict;
  reasoning: string;
  /** How confident the classifier is. */
  confidence?: 'high' | 'medium' | 'low';
  /** Whether a rule or the LLM produced this verdict. */
  source?: TriageSource;
  /** Id of the root-cause cluster this failure belongs to (if any). */
  clusterId?: string;
}

/**
 * A group of failures that share one root cause (same error signature). Lets the
 * UI report "38 tests blocked: not logged in" instead of 38 separate cards.
 */
export interface TriageCluster {
  id: string;
  /** Normalized error signature the cluster is keyed on. */
  signature: string;
  verdict: FailureVerdict;
  count: number;
  /** Human summary of the shared root cause. */
  summary: string;
  /** Test titles in this cluster. */
  testNames: string[];
  /** File the cluster is concentrated in, when it is single-file. */
  file?: string;
  /** All spec files this cluster spans (basename-able), so the UI can name them
   *  even when the failure is spread across several files. */
  files?: string[];
  /** Per-test "spec › title" pairs, so the user can see exactly which test in
   *  which spec failed — not just an aggregate count. */
  tests?: { title: string; file: string }[];
}

export interface TriageResult {
  analyses: FailureAnalysis[];
  testBugCount: number;
  appBugCount: number;
  ambiguousCount: number;
  /** Login/auth/env/fixture failures — surfaced to the user, never auto-healed. */
  setupErrorCount: number;
  /** Root-cause groups (largest first). */
  clusters: TriageCluster[];
  /** true when there are test_bug or ambiguous failures worth auto-healing */
  selfHealRecommended: boolean;
  /** Set when one root cause (usually a setup/login failure) dominates the run. */
  dominantRootCause?: string;
  triageAt: number;
}

export interface FigmaDiscrepancy {
  severity: 'high' | 'medium' | 'low';
  element: string;
  issue: string;
  figmaValue?: string;
  liveValue?: string;
  /** Page region the finding belongs to (header, nav, main, footer, …). */
  region?: string;
  /** Relative path (from workspace dir) to a screenshot of the specific live element */
  screenshotPath?: string;
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
  /** Per-region SSIM scores so the bare number becomes actionable
   *  ("top-right diverges") — see lib/figma-client.ts:summarizeFigmaRegions. */
  regions?: FigmaRegionScore[];
  /** Human-readable, deterministic summary of what differs and where. */
  explanation?: string;
  /** Deterministic semantic check (#11): labels/headings/buttons the design
   *  defines that don't appear on the live page (case-insensitive, exact + near).
   *  Catches "design says 'Place Order' but app says 'Submit'" — which pixels miss. */
  missingDesignText?: FigmaMissingText[];
  /** Feature this frame maps to (visual baseline #9) — links visual regression
   *  back to the feature spine so it can be weighted by criticality. */
  featureId?: string;
  featureName?: string;
  /** sha256 of the downloaded Figma PNG bytes — used by #13 to detect when the
   *  design itself changed between runs (frame edited, not the app). */
  frameHash?: string;
  /** True when this frame's hash changed since the last run — visual baselines
   *  derived from the old design are stale and should be reviewed. */
  designDrifted?: boolean;
}

/** A design text/label the live page doesn't render (semantic mismatch). */
export interface FigmaMissingText {
  kind: 'heading' | 'button' | 'input-label' | 'text';
  expected: string;
  /** The closest text actually rendered (when one was found nearby) — helps
   *  identify renames like "Place Order" → "Submit". */
  closestLive?: string;
}

/** SSIM score for one of nine named regions (3×3 grid). */
export interface FigmaRegionScore {
  /** "top-left" | "top-center" | "top-right" | "middle-left" | ... | "bottom-right" */
  name: string;
  /** Region's mean SSIM 0–1 (higher = closer match). */
  ssim: number;
  /** Percentage of the region's blocks that diverged (SSIM < 0.85). */
  divergedPct: number;
}

export interface FigmaResult {
  comparisons: FigmaComparison[];
  /** Relative paths (from workspace dir) to the per-frame spec files in tests/figma/. */
  testFiles: string[];
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
  /** Organisation that owns this session — used for scoping DB queries server-side. */
  orgId: string;
  /** Clerk user ID of the member who started this session. */
  createdByUserId: string;
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
  /** User-confirmed mapping of Figma frame name → live page URL. */
  figmaFrameMap: Record<string, string> | null;
  /** When true, skip test generation/execution — run Figma design verification only. */
  figmaOnly: boolean;
  /** True while Figma design verification is in progress (independent of the main pipeline status). */
  figmaChecking: boolean;
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
