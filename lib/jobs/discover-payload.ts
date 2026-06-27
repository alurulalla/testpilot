export interface DiscoverPayload {
  depth: number;
  maxPages: number;
}

export function parseDiscoverPayload(value: unknown): DiscoverPayload {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const depth = typeof payload.depth === 'number' ? payload.depth : 2;
  const maxPages = typeof payload.maxPages === 'number' ? payload.maxPages : 10;
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) throw new Error('Invalid discover depth');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('Invalid discover maxPages');
  return { depth, maxPages };
}
