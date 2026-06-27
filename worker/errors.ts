export class JobCancelledError extends Error {
  constructor() {
    super('Job cancellation requested');
    this.name = 'JobCancelledError';
  }
}

export class JobLeaseLostError extends Error {
  constructor() {
    super('Worker no longer owns the job lease');
    this.name = 'JobLeaseLostError';
  }
}
