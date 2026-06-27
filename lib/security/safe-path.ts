import { existsSync, realpathSync, statSync } from 'fs';
import path from 'path';

/** Resolve an existing regular file and prove that it remains inside root. */
export function resolveExistingFileWithin(root: string, candidate: string): string | null {
  if (!candidate || candidate.includes('\0')) return null;

  try {
    const realRoot = realpathSync(root);
    const requested = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(realRoot, candidate);

    if (!existsSync(requested)) return null;
    const realRequested = realpathSync(requested);
    const relative = path.relative(realRoot, realRequested);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      return null;
    }
    if (!statSync(realRequested).isFile()) return null;
    return realRequested;
  } catch {
    return null;
  }
}
