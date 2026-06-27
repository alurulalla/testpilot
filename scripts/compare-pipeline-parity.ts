import '@/lib/load-env';
import path from 'node:path';
import { hostOf } from '@/lib/app-profile';
import { comparePipelineParity, siteMapPages, type ParitySnapshot } from '@/lib/jobs/parity';
import { disconnectPrisma, prisma } from '@/lib/prisma';
import type { FigmaResult, SiteMap, TestResult, TriageResult } from '@/types/session';

async function loadSnapshot(sessionId: string): Promise<{ orgId: string; host: string; snapshot: ParitySnapshot }> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { files: { where: { deletedAt: null }, select: { path: true } } },
  });
  const host = hostOf(session.url);
  const profile = await prisma.appProfile.findUnique({
    where: { orgId_host: { orgId: session.orgId, host } },
    include: { features: { where: { quarantined: false }, select: { name: true } } },
  });
  return {
    orgId: session.orgId,
    host,
    snapshot: {
      pages: siteMapPages(session.siteMap as unknown as SiteMap | null),
      files: session.files.filter(file => file.path.endsWith('.spec.ts')).map(file => path.basename(file.path)),
      features: profile?.features.map(feature => feature.name) ?? [],
      testResult: session.testResult as unknown as TestResult | null,
      triageResult: session.triageResult as unknown as TriageResult | null,
      figmaResult: session.figmaResult as unknown as FigmaResult | null,
      status: session.status,
    },
  };
}

async function main() {
  const [legacyId, pipelineId] = process.argv.slice(2);
  if (!legacyId || !pipelineId) throw new Error('Usage: npm run compare:pipeline -- <legacy-session-id> <pipeline-session-id>');
  const [legacy, pipeline] = await Promise.all([loadSnapshot(legacyId), loadSnapshot(pipelineId)]);
  if (legacy.orgId !== pipeline.orgId || legacy.host !== pipeline.host) {
    throw new Error('Parity sessions must belong to the same organization and target host');
  }
  const result = comparePipelineParity(legacy.snapshot, pipeline.snapshot);
  console.table(result.metrics.map(metric => ({
    metric: metric.name,
    legacy: metric.legacy,
    pipeline: metric.pipeline,
    score: `${Math.round(metric.score * 100)}%`,
    passed: metric.passed,
  })));
  console.log(`Parity ${result.passed ? 'PASSED' : 'FAILED'}`);
  if (!result.passed) process.exitCode = 2;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(disconnectPrisma);
