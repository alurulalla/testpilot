export const JOB_STATUSES = [
  'queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled',
] as const;

export type JobStatus = typeof JOB_STATUSES[number];

export const JOB_TYPES = [
  'pipeline', 'discover', 'generate', 'execute', 'triage', 'heal', 'figma', 'report',
] as const;

export type JobType = typeof JOB_TYPES[number];

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'retrying', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}
