export const PIPELINE_STAGES = [
  'initial', 'discovered', 'profiled', 'generated', 'reviewed', 'executed', 'healed',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

export interface PipelinePayload {
  maxIterations: number;
}

export interface PipelineCheckpoint {
  stage: PipelineStage;
  iteration: number;
  lastFailureSignature?: string;
  stopReason?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parsePipelinePayload(value: unknown): PipelinePayload {
  const maxIterations = record(value).maxIterations ?? 3;
  if (!Number.isInteger(maxIterations) || Number(maxIterations) < 1 || Number(maxIterations) > 10) {
    throw new Error('maxIterations must be an integer between 1 and 10');
  }
  return { maxIterations: Number(maxIterations) };
}

export function parsePipelineCheckpoint(value: unknown): PipelineCheckpoint {
  const input = record(value);
  const stage = typeof input.stage === 'string' && PIPELINE_STAGES.includes(input.stage as PipelineStage)
    ? input.stage as PipelineStage
    : 'initial';
  const iteration = Number.isInteger(input.iteration) && Number(input.iteration) >= 1
    ? Number(input.iteration)
    : 1;
  return {
    stage,
    iteration,
    ...(typeof input.lastFailureSignature === 'string'
      ? { lastFailureSignature: input.lastFailureSignature }
      : {}),
    ...(typeof input.stopReason === 'string' ? { stopReason: input.stopReason } : {}),
  };
}

export function failureSignature(cases: unknown): string {
  if (!cases || typeof cases !== 'object' || Array.isArray(cases)) return '';
  return Object.entries(cases as Record<string, unknown>)
    .filter(([, status]) => status === 'failed')
    .map(([name]) => name)
    .sort()
    .join('|');
}
