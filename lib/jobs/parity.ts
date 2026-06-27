import type { FigmaResult, SiteMap, TestResult, TriageResult } from '@/types/session';

export interface ParitySnapshot {
  pages: string[];
  files: string[];
  features: string[];
  testResult: TestResult | null;
  triageResult: TriageResult | null;
  figmaResult: FigmaResult | null;
  status: string;
}

export interface ParityMetric {
  name: string;
  legacy: number | string;
  pipeline: number | string;
  score: number;
  passed: boolean;
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean));
}

function overlap(left: string[], right: string[]): number {
  const a = normalizedSet(left);
  const b = normalizedSet(right);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter(value => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

function ratioScore(left: number, right: number): number {
  if (left === 0 && right === 0) return 1;
  return Math.min(left, right) / Math.max(left, right, 1);
}

export function siteMapPages(siteMap: SiteMap | null): string[] {
  return (siteMap?.pages ?? []).map(page => {
    try {
      const url = new URL(page.url);
      return `${url.pathname}${url.search}`;
    } catch {
      return page.url;
    }
  });
}

export function comparePipelineParity(legacy: ParitySnapshot, pipeline: ParitySnapshot) {
  const legacyTriage = legacy.triageResult;
  const pipelineTriage = pipeline.triageResult;
  const legacyFrames = legacy.figmaResult?.comparisons.map(item => item.frameName) ?? [];
  const pipelineFrames = pipeline.figmaResult?.comparisons.map(item => item.frameName) ?? [];
  const metrics: ParityMetric[] = [
    { name: 'sitemap', legacy: legacy.pages.length, pipeline: pipeline.pages.length, score: overlap(legacy.pages, pipeline.pages), passed: false },
    { name: 'test-files', legacy: legacy.files.length, pipeline: pipeline.files.length, score: overlap(legacy.files, pipeline.files), passed: false },
    { name: 'profile-features', legacy: legacy.features.length, pipeline: pipeline.features.length, score: overlap(legacy.features, pipeline.features), passed: false },
    { name: 'test-count', legacy: legacy.testResult?.stats.total ?? 0, pipeline: pipeline.testResult?.stats.total ?? 0, score: ratioScore(legacy.testResult?.stats.total ?? 0, pipeline.testResult?.stats.total ?? 0), passed: false },
    { name: 'triage-app-bugs', legacy: legacyTriage?.appBugCount ?? 0, pipeline: pipelineTriage?.appBugCount ?? 0, score: ratioScore(legacyTriage?.appBugCount ?? 0, pipelineTriage?.appBugCount ?? 0), passed: false },
    { name: 'figma-frames', legacy: legacyFrames.length, pipeline: pipelineFrames.length, score: overlap(legacyFrames, pipelineFrames), passed: false },
  ];
  for (const metric of metrics) {
    const threshold = metric.name === 'sitemap' || metric.name === 'profile-features' ? 0.8 : 0.7;
    metric.passed = metric.score >= threshold;
  }
  return {
    passed: metrics.every(metric => metric.passed),
    metrics,
    statuses: { legacy: legacy.status, pipeline: pipeline.status },
  };
}
