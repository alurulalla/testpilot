/**
 * Test Report Generator
 *
 * Produces professional QA test reports from a TestPilot session in five formats:
 *   html     – fully self-contained, styled HTML (primary format)
 *   pdf      – rendered from the HTML via Playwright's page.pdf()
 *   markdown – clean Markdown suitable for wikis and PRs
 *   json     – structured data for CI integration
 *   csv      – flat table of individual test results
 */
import type { Session, FailureAnalysis } from '@/types/session';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function pct(n: number, total: number): string {
  if (total === 0) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Report data model ──────────────────────────────────────────────────────────

export interface ReportData {
  sessionId:    string;
  url:          string;
  generatedAt:  number;
  status:       'PASS' | 'FAIL' | 'IN PROGRESS';
  stats: {
    total:   number;
    passed:  number;
    failed:  number;
    errors:  number;
    passRate: number;   // 0–100
  };
  duration:       number;   // ms
  pagesExplored:  number;
  testFilesCount: number;
  testFiles:      string[];
  iterations:     number;
  triage: {
    testBugCount:    number;
    appBugCount:     number;
    ambiguousCount:  number;
    setupErrorCount: number;
    analyses:        FailureAnalysis[];
  } | null;
  contextDocName: string | null;
  rawOutput:      string;
}

export function buildReportData(session: Session): ReportData {
  const stats = session.testResult?.stats ?? { total: 0, passed: 0, failed: 0, errors: 0 };
  const passRate = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;

  return {
    sessionId:   session.id,
    url:         session.url,
    generatedAt: Date.now(),
    status:
      session.testResult == null ? 'IN PROGRESS'
        : stats.failed === 0 && stats.errors === 0 ? 'PASS'
        : 'FAIL',
    stats: { ...stats, passRate },
    duration:      session.testResult?.duration ?? 0,
    pagesExplored: session.siteMap?.total_pages ?? 0,
    testFilesCount: session.testFiles.length,
    testFiles:     session.testFiles.map(f => f.split('/').pop() ?? f),
    iterations:    session.iteration,
    triage:        session.triageResult ? {
      testBugCount:    session.triageResult.testBugCount,
      appBugCount:     session.triageResult.appBugCount,
      ambiguousCount:  session.triageResult.ambiguousCount,
      setupErrorCount: session.triageResult.setupErrorCount ?? 0,
      analyses:        session.triageResult.analyses,
    } : null,
    contextDocName: session.contextDocName,
    rawOutput:      session.testResult?.output ?? '',
  };
}

// ── HTML report ────────────────────────────────────────────────────────────────

export function generateHtmlReport(d: ReportData): string {
  const statusColor =
    d.status === 'PASS' ? '#22c55e'
    : d.status === 'FAIL' ? '#ef4444'
    : '#f59e0b';

  const passColor  = '#22c55e';
  const failColor  = '#ef4444';
  const warnColor  = '#f59e0b';
  const infoColor  = '#8b5cf6';

  const gaugeCircumference = 2 * Math.PI * 40; // radius 40
  const gaugeOffset = gaugeCircumference * (1 - d.stats.passRate / 100);

  // Per-file pass/fail counts parsed from raw output
  const fileStats = parseFileStats(d.rawOutput, d.testFiles);

  const failureRows = d.triage?.analyses
    .filter(a => a.verdict !== 'test_bug' || true) // show all
    .map(a => {
      const badgeColor =
        a.verdict === 'app_bug'  ? warnColor
        : a.verdict === 'test_bug' ? infoColor
        : a.verdict === 'setup_error' ? '#38bdf8'
        : '#a1a1aa';
      const badgeLabel =
        a.verdict === 'app_bug'  ? '⚠ App Bug'
        : a.verdict === 'test_bug' ? '🔧 Test Bug'
        : a.verdict === 'setup_error' ? '🔑 Setup'
        : '❓ Ambiguous';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#e4e4e7;max-width:200px;word-break:break-word">${escHtml(a.testName)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#a1a1aa;font-family:monospace">${escHtml(a.file.split('/').pop() ?? a.file)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a">
            <span style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}44;border-radius:4px;padding:2px 7px;font-size:11px;white-space:nowrap">${badgeLabel}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#a1a1aa;max-width:300px;word-break:break-word">${escHtml(a.error.slice(0, 200))}${a.error.length > 200 ? '…' : ''}</td>
        </tr>`;
    }).join('') ?? '';

  const fileRows = fileStats.map(f => {
    const filePct = f.total > 0 ? ((f.passed / f.total) * 100).toFixed(0) : '—';
    const statusIcon = f.failed === 0 ? '✅' : '❌';
    return `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #27272a;font-size:12px;font-family:monospace;color:#e4e4e7">${statusIcon} ${escHtml(f.file)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#a1a1aa;text-align:center">${f.total}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #27272a;font-size:12px;color:${passColor};text-align:center">${f.passed}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #27272a;font-size:12px;color:${f.failed > 0 ? failColor : '#a1a1aa'};text-align:center">${f.failed}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #27272a;font-size:12px;color:${infoColor};text-align:center">${filePct}%</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Test Report — ${escHtml(d.url)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  a{color:#a78bfa;text-decoration:none}
  /* Print the report EXACTLY as designed (dark, high-contrast). Previously the
     background was flipped to white while inline light-grey text stayed, making
     PDFs/printouts unreadable. */
  @media print{
    .no-print{display:none}
    .page-break{page-break-before:always}
    table{page-break-inside:auto}
    tr{page-break-inside:avoid}
  }
</style>
</head>
<body>

<!-- ── Cover / Header ─────────────────────────────────────────── -->
<div style="background:linear-gradient(135deg,#1e1b4b 0%,#0f0f1a 60%);padding:40px 48px 32px;border-bottom:1px solid #27272a">
  <div style="max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="background:#7c3aed;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div>
      <div>
        <div style="font-size:11px;color:#7c3aed;font-weight:600;letter-spacing:.08em;text-transform:uppercase">TestPilot</div>
        <div style="font-size:20px;font-weight:700;color:#f4f4f5">Automated Test Execution Report</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:11px;color:#a1a1aa">Generated</div>
        <div style="font-size:13px;color:#a1a1aa">${fmtDate(d.generatedAt)}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:4px 12px;font-size:12px;font-family:monospace;color:#a1a1aa">${escHtml(d.url)}</span>
      <span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:4px 12px;font-size:12px;font-family:monospace;color:#a1a1aa">ID: ${d.sessionId.slice(0, 8)}</span>
      ${d.contextDocName ? `<span style="background:#1c1917;border:1px solid #44403c;border-radius:6px;padding:4px 12px;font-size:12px;color:#a8a29e">📄 ${escHtml(d.contextDocName)}</span>` : ''}
    </div>
  </div>
</div>

<!-- ── Executive Summary ──────────────────────────────────────── -->
<div style="max-width:900px;margin:32px auto;padding:0 48px">
  <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:28px 32px;display:flex;gap:32px;align-items:center;flex-wrap:wrap">

    <!-- Donut gauge -->
    <div style="flex-shrink:0;text-align:center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" stroke-width="12"/>
        <circle cx="50" cy="50" r="40" fill="none"
          stroke="${d.stats.passRate >= 80 ? passColor : d.stats.passRate >= 50 ? warnColor : failColor}"
          stroke-width="12"
          stroke-dasharray="${gaugeCircumference}"
          stroke-dashoffset="${gaugeOffset}"
          stroke-linecap="round"
          transform="rotate(-90 50 50)"/>
        <text x="50" y="46" text-anchor="middle" fill="#f4f4f5" font-size="16" font-weight="700" font-family="sans-serif">${d.stats.passRate.toFixed(0)}%</text>
        <text x="50" y="60" text-anchor="middle" fill="#a1a1aa" font-size="9" font-family="sans-serif">PASS RATE</text>
      </svg>
      <div style="margin-top:4px;font-size:13px;font-weight:700;color:${statusColor};letter-spacing:.05em">${d.status}</div>
    </div>

    <!-- Big numbers -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;flex:1;min-width:320px">
      ${metricCard('Tests Written', d.stats.total, '#8b5cf6')}
      ${metricCard('Passed', d.stats.passed, passColor)}
      ${metricCard('Failed', d.stats.failed + d.stats.errors, failColor)}
      ${metricCard('Accuracy', d.stats.passRate.toFixed(1) + '%', d.stats.passRate >= 80 ? passColor : warnColor)}
    </div>
  </div>

  <!-- ── Session metadata strip ─────────────────────────────────── -->
  <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap">
    ${metaChip('⏱ Duration', fmtDuration(d.duration))}
    ${metaChip('🔍 Pages Explored', String(d.pagesExplored))}
    ${metaChip('📁 Test Files', String(d.testFilesCount))}
    ${metaChip('🔄 Iterations', String(d.iterations))}
    ${d.triage ? metaChip('🐛 App Issues', String(d.triage.appBugCount)) : ''}
  </div>
</div>

<!-- ── Per-File Breakdown ─────────────────────────────────────── -->
${fileStats.length > 0 ? `
<div style="max-width:900px;margin:0 auto 28px;padding:0 48px">
  <h2 style="font-size:14px;font-weight:600;color:#f4f4f5;margin-bottom:12px;display:flex;align-items:center;gap:8px">
    <span style="color:#8b5cf6">📋</span> Test File Breakdown
  </h2>
  <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#1f1f23">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">File</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Total</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Passed</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Failed</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Pass Rate</th>
        </tr>
      </thead>
      <tbody>${fileRows}</tbody>
    </table>
  </div>
</div>` : ''}

<!-- ── Failure Analysis ───────────────────────────────────────── -->
${d.triage && d.triage.analyses.length > 0 ? `
<div style="max-width:900px;margin:0 auto 28px;padding:0 48px">
  <h2 style="font-size:14px;font-weight:600;color:#f4f4f5;margin-bottom:12px;display:flex;align-items:center;gap:8px">
    <span style="color:#ef4444">🔬</span> Failure Analysis
    <span style="background:#27272a;border-radius:5px;padding:1px 8px;font-size:11px;color:#a1a1aa;margin-left:4px">${d.triage.analyses.length} failure(s)</span>
  </h2>

  <!-- Category summary -->
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    ${triageChip('🔧 Test Bugs', d.triage.testBugCount, infoColor, 'Fixable test code issues — wrong selector, incorrect URL, timing')}
    ${triageChip('⚠ App Bugs', d.triage.appBugCount, warnColor, 'Real defects found in the application under test')}
    ${d.triage.setupErrorCount > 0 ? triageChip('🔑 Setup', d.triage.setupErrorCount, '#38bdf8', 'Login/auth/environment failures — fix credentials or selectors') : ''}
    ${triageChip('❓ Ambiguous', d.triage.ambiguousCount, '#a1a1aa', 'Root cause unclear — needs manual review')}
  </div>

  <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#1f1f23">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Test Name</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">File</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Verdict</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em">Error</th>
        </tr>
      </thead>
      <tbody>${failureRows}</tbody>
    </table>
  </div>

  ${d.triage.appBugCount > 0 ? `
  <div style="margin-top:12px;background:#431407;border:1px solid #92400e;border-radius:8px;padding:12px 16px">
    <div style="font-size:12px;color:#fbbf24;font-weight:600">⚠ ${d.triage.appBugCount} Application Bug(s) Detected</div>
    <div style="font-size:11px;color:#d97706;margin-top:4px">The application under test is not behaving as documented. These failures represent real defects and should be logged as bug reports.</div>
  </div>` : ''}
</div>` : d.stats.failed === 0 && d.stats.total > 0 ? `
<div style="max-width:900px;margin:0 auto 28px;padding:0 48px">
  <div style="background:#14532d;border:1px solid #166534;border-radius:10px;padding:20px 24px;display:flex;align-items:center;gap:12px">
    <div style="font-size:24px">🎉</div>
    <div>
      <div style="font-size:14px;font-weight:600;color:#4ade80">All Tests Passed</div>
      <div style="font-size:12px;color:#86efac;margin-top:2px">No failures detected. The application is behaving as expected across all ${d.stats.total} test case(s).</div>
    </div>
  </div>
</div>` : ''}

<!-- ── Quality Assessment ─────────────────────────────────────── -->
<div style="max-width:900px;margin:0 auto 28px;padding:0 48px">
  <h2 style="font-size:14px;font-weight:600;color:#f4f4f5;margin-bottom:12px;display:flex;align-items:center;gap:8px">
    <span style="color:#8b5cf6">📊</span> Quality Assessment
  </h2>
  <div style="background:#18181b;border:1px solid #27272a;border-radius:10px;padding:20px 24px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
    ${qualityRow('Test Pass Rate', `${pct(d.stats.passed, d.stats.total)}%`, d.stats.passRate >= 80 ? passColor : warnColor,
      'Percentage of test cases that executed successfully')}
    ${qualityRow('Application Defect Rate',
      d.triage ? `${pct(d.triage.appBugCount, d.stats.total)}%` : 'N/A',
      d.triage && d.triage.appBugCount > 0 ? warnColor : passColor,
      'Percentage of failures attributed to application bugs')}
    ${qualityRow('Test Script Quality',
      d.triage ? `${pct(d.stats.total - d.triage.testBugCount, d.stats.total)}%` : `${pct(d.stats.passed, d.stats.total)}%`,
      '#8b5cf6',
      'Test scripts free of code-level issues (wrong selectors, bad assertions)')}
    ${qualityRow('Coverage',
      `${d.pagesExplored} page${d.pagesExplored !== 1 ? 's' : ''}, ${d.testFilesCount} file${d.testFilesCount !== 1 ? 's' : ''}`,
      '#8b5cf6',
      'Pages explored during crawl and test files generated')}
  </div>
</div>

<!-- ── Raw Output (collapsible) ──────────────────────────────── -->
${d.rawOutput ? `
<div style="max-width:900px;margin:0 auto 40px;padding:0 48px" class="no-print">
  <details>
    <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#a1a1aa;padding:8px 0;list-style:none;display:flex;align-items:center;gap:6px">
      <span style="color:#3f3f46">▶</span> Raw Test Output
    </summary>
    <pre style="margin-top:10px;background:#09090b;border:1px solid #27272a;border-radius:8px;padding:16px;font-size:11px;color:#a1a1aa;font-family:monospace;overflow-x:auto;white-space:pre-wrap;max-height:400px;overflow-y:auto">${escHtml(d.rawOutput.slice(0, 20_000))}${d.rawOutput.length > 20_000 ? '\n\n[truncated…]' : ''}</pre>
  </details>
</div>` : ''}

<!-- ── Footer ─────────────────────────────────────────────────── -->
<div style="border-top:1px solid #18181b;padding:20px 48px;text-align:center">
  <div style="font-size:11px;color:#3f3f46">Generated by <strong style="color:#7c3aed">TestPilot</strong> · ${fmtDate(d.generatedAt)} · Session ${d.sessionId.slice(0, 8)}</div>
</div>

</body>
</html>`;
}

// ── HTML helpers ───────────────────────────────────────────────────────────────

function metricCard(label: string, value: string | number, color: string): string {
  return `
    <div style="background:#09090b;border:1px solid #27272a;border-radius:8px;padding:14px 16px;text-align:center">
      <div style="font-size:26px;font-weight:800;color:${color};line-height:1">${value}</div>
      <div style="font-size:10px;color:#a1a1aa;margin-top:4px;text-transform:uppercase;letter-spacing:.06em">${label}</div>
    </div>`;
}

function metaChip(label: string, value: string): string {
  return `
    <div style="background:#18181b;border:1px solid #27272a;border-radius:7px;padding:6px 12px;display:flex;gap:8px;align-items:center">
      <span style="font-size:12px;color:#a1a1aa">${label}</span>
      <span style="font-size:12px;font-weight:600;color:#e4e4e7">${value}</span>
    </div>`;
}

function triageChip(label: string, count: number, color: string, desc: string): string {
  return `
    <div style="background:${color}11;border:1px solid ${color}33;border-radius:8px;padding:10px 14px;flex:1;min-width:150px" title="${escHtml(desc)}">
      <div style="font-size:20px;font-weight:800;color:${color}">${count}</div>
      <div style="font-size:11px;color:${color}cc;margin-top:2px">${label}</div>
    </div>`;
}

function qualityRow(label: string, value: string, color: string, desc: string): string {
  return `
    <div>
      <div style="font-size:11px;color:#a1a1aa;margin-bottom:4px">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:11px;color:#52525b;margin-top:2px">${desc}</div>
    </div>`;
}

// ── Per-file stats parser ──────────────────────────────────────────────────────

interface FileStatRow { file: string; total: number; passed: number; failed: number }

function parseFileStats(output: string, testFiles: string[]): FileStatRow[] {
  // Playwright output format:
  //   [chromium] › tests/foo.spec.ts:4:5 › …
  if (!output) return testFiles.map(f => ({ file: f, total: 0, passed: 0, failed: 0 }));

  const fileCounts: Record<string, { total: number; passed: number; failed: number }> = {};

  // Count lines like "[chromium] › tests/foo.spec.ts:…" (each = 1 test attempt)
  const testLineRe = /›\s+(tests\/[^\s:]+\.spec\.ts)/g;
  let m: RegExpExecArray | null;
  while ((m = testLineRe.exec(output)) !== null) {
    const file = m[1].split('/').pop() ?? m[1];
    fileCounts[file] ??= { total: 0, passed: 0, failed: 0 };
    fileCounts[file].total++;
  }

  // Count "✓" (passed) vs "✗" / "×" (failed) per file from output lines
  const passRe  = /✓.*?([\w-]+\.spec\.ts)/g;
  const failRe  = /[✗×✘].*?([\w-]+\.spec\.ts)/g;
  while ((m = passRe.exec(output)) !== null) {
    const file = m[1];
    fileCounts[file] ??= { total: 0, passed: 0, failed: 0 };
    fileCounts[file].passed++;
  }
  while ((m = failRe.exec(output)) !== null) {
    const file = m[1];
    fileCounts[file] ??= { total: 0, passed: 0, failed: 0 };
    fileCounts[file].failed++;
  }

  // Return all known test files (even if no output lines matched)
  return testFiles.map(f => {
    const base = f.split('/').pop() ?? f;
    const counts = fileCounts[base] ?? { total: 0, passed: 0, failed: 0 };
    return { file: base, ...counts };
  });
}

// ── Markdown report ────────────────────────────────────────────────────────────

export function generateMarkdownReport(d: ReportData): string {
  const lines: string[] = [];

  lines.push(`# QA Test Execution Report`);
  lines.push(``);
  lines.push(`> **Generated by TestPilot** · ${fmtDate(d.generatedAt)}`);
  lines.push(``);
  lines.push(`| Property | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Target URL | \`${d.url}\` |`);
  lines.push(`| Session ID | \`${d.sessionId}\` |`);
  lines.push(`| Status | **${d.status}** |`);
  lines.push(`| Generated | ${fmtDate(d.generatedAt)} |`);
  if (d.contextDocName) lines.push(`| Documentation | ${d.contextDocName} |`);
  lines.push(``);

  lines.push(`## Executive Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| ✅ Tests Passed | **${d.stats.passed}** |`);
  lines.push(`| ❌ Tests Failed | **${d.stats.failed + d.stats.errors}** |`);
  lines.push(`| 📝 Total Written | **${d.stats.total}** |`);
  lines.push(`| 🎯 Pass Rate | **${d.stats.passRate.toFixed(1)}%** |`);
  lines.push(`| ⏱ Duration | ${fmtDuration(d.duration)} |`);
  lines.push(`| 🔍 Pages Explored | ${d.pagesExplored} |`);
  lines.push(`| 📁 Test Files | ${d.testFilesCount} |`);
  lines.push(`| 🔄 Iterations | ${d.iterations} |`);
  lines.push(``);

  if (d.testFiles.length > 0) {
    lines.push(`## Test Files`);
    lines.push(``);
    d.testFiles.forEach(f => lines.push(`- \`${f}\``));
    lines.push(``);
  }

  if (d.triage) {
    lines.push(`## Failure Analysis`);
    lines.push(``);
    lines.push(`| Category | Count |`);
    lines.push(`|---|---|`);
    lines.push(`| 🔧 Test Bugs (fixable test code issues) | ${d.triage.testBugCount} |`);
    lines.push(`| ⚠ App Bugs (real application defects) | ${d.triage.appBugCount} |`);
    lines.push(`| 🔑 Setup/Auth Errors | ${d.triage.setupErrorCount} |`);
    lines.push(`| ❓ Ambiguous | ${d.triage.ambiguousCount} |`);
    lines.push(``);

    if (d.triage.analyses.length > 0) {
      lines.push(`### Failure Details`);
      lines.push(``);
      d.triage.analyses.forEach((a, i) => {
        const verdict =
          a.verdict === 'app_bug'  ? '⚠ App Bug'
          : a.verdict === 'test_bug' ? '🔧 Test Bug'
          : a.verdict === 'setup_error' ? '🔑 Setup'
          : '❓ Ambiguous';
        lines.push(`#### ${i + 1}. ${a.testName}`);
        lines.push(``);
        lines.push(`- **File:** \`${a.file.split('/').pop()}\``);
        lines.push(`- **Verdict:** ${verdict}`);
        lines.push(`- **Error:** \`${a.error.slice(0, 300)}\``);
        lines.push(`- **Reasoning:** ${a.reasoning}`);
        lines.push(``);
      });
    }

    if (d.triage.appBugCount > 0) {
      lines.push(`> ⚠ **${d.triage.appBugCount} application bug(s) detected.** These failures represent real defects in the application under test and should be logged as bug reports.`);
      lines.push(``);
    }
  }

  lines.push(`## Quality Metrics`);
  lines.push(``);
  lines.push(`| Metric | Score |`);
  lines.push(`|---|---|`);
  lines.push(`| Test Pass Rate | **${pct(d.stats.passed, d.stats.total)}%** |`);
  if (d.triage) {
    lines.push(`| Application Defect Rate | **${pct(d.triage.appBugCount, d.stats.total)}%** |`);
    lines.push(`| Script Quality | **${pct(d.stats.total - d.triage.testBugCount, d.stats.total)}%** |`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Report generated by [TestPilot](https://github.com) · Session \`${d.sessionId}\`*`);

  return lines.join('\n');
}

// ── JSON report ────────────────────────────────────────────────────────────────

export function generateJsonReport(d: ReportData): string {
  return JSON.stringify({
    meta: {
      tool:        'TestPilot',
      version:     '1.0',
      generatedAt: new Date(d.generatedAt).toISOString(),
      sessionId:   d.sessionId,
    },
    target: {
      url:          d.url,
      pagesExplored: d.pagesExplored,
      documentation: d.contextDocName,
    },
    execution: {
      status:    d.status,
      duration:  d.duration,
      iterations: d.iterations,
      testFiles: d.testFiles,
    },
    results: {
      total:    d.stats.total,
      passed:   d.stats.passed,
      failed:   d.stats.failed,
      errors:   d.stats.errors,
      passRate: parseFloat(d.stats.passRate.toFixed(2)),
    },
    triage: d.triage ? {
      testBugCount:    d.triage.testBugCount,
      appBugCount:     d.triage.appBugCount,
      ambiguousCount:  d.triage.ambiguousCount,
      setupErrorCount: d.triage.setupErrorCount,
      failures:       d.triage.analyses.map(a => ({
        testName: a.testName,
        file:     a.file.split('/').pop(),
        verdict:  a.verdict,
        error:    a.error,
        reasoning: a.reasoning,
      })),
    } : null,
    qualityMetrics: {
      passRate:          parseFloat(pct(d.stats.passed, d.stats.total)),
      appDefectRate:     d.triage ? parseFloat(pct(d.triage.appBugCount, d.stats.total)) : null,
      scriptQualityRate: d.triage ? parseFloat(pct(d.stats.total - d.triage.testBugCount, d.stats.total)) : null,
    },
  }, null, 2);
}

// ── CSV report ─────────────────────────────────────────────────────────────────

export function generateCsvReport(d: ReportData): string {
  const rows: string[] = [];
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

  // Summary section
  rows.push('SUMMARY');
  rows.push(['URL', 'Status', 'Total', 'Passed', 'Failed', 'Errors', 'Pass Rate %', 'Duration', 'Pages', 'Files', 'Iterations'].map(q).join(','));
  rows.push([
    d.url, d.status, d.stats.total, d.stats.passed,
    d.stats.failed, d.stats.errors,
    d.stats.passRate.toFixed(1),
    fmtDuration(d.duration), d.pagesExplored,
    d.testFilesCount, d.iterations,
  ].map(q).join(','));
  rows.push('');

  // Failure detail section
  if (d.triage && d.triage.analyses.length > 0) {
    rows.push('FAILURES');
    rows.push(['Test Name', 'File', 'Verdict', 'Error', 'Reasoning'].map(q).join(','));
    d.triage.analyses.forEach(a => {
      rows.push([
        a.testName,
        a.file.split('/').pop() ?? a.file,
        a.verdict,
        a.error.replace(/\n/g, ' ').slice(0, 500),
        a.reasoning,
      ].map(q).join(','));
    });
  }

  return rows.join('\n');
}
