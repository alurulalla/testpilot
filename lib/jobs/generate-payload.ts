interface GeneratePayload {
  depth: number;
  maxPages: number;
}

export function parseGeneratePayload(value: unknown): GeneratePayload {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const depth = payload.depth ?? 2;
  const maxPages = payload.maxPages ?? 10;
  if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 5) {
    throw new Error('Generate depth must be an integer between 1 and 5');
  }
  if (!Number.isInteger(maxPages) || Number(maxPages) < 1 || Number(maxPages) > 100) {
    throw new Error('Generate maxPages must be an integer between 1 and 100');
  }
  return { depth: Number(depth), maxPages: Number(maxPages) };
}
