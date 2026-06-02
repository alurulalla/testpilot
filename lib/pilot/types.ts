/**
 * Shared TypeScript types for the TestPilot Pilot engine.
 */

export interface ChatMessage {
  role: string;
  content: string;
}

/** Options forwarded to the underlying model on a single invoke call. */
export interface InvokeOptions {
  /**
   * Maximum number of output tokens.  Callers should set this to the smallest
   * value that comfortably fits their expected output so the provider doesn't
   * reserve (and bill for) unused capacity.
   *
   * Defaults: generation 16 384, review/fix 8 192, triage 4 096.
   */
  maxTokens?: number;
}

/** Minimal chat-completion surface — provider-agnostic. */
export interface ChatModel {
  readonly modelName: string;
  readonly provider: string;
  invoke(messages: ChatMessage[], options?: InvokeOptions): Promise<string>;
}

export interface TestStats {
  passed: number;
  failed: number;
  errors: number;
  total: number;
}

export interface PageInfo {
  url: string;
  depth: number;
  title: string;
  status_code: number | null;
  elements: Record<string, unknown>;
  accessibility_tree: unknown;
  child_urls: string[];
  screenshot: string;
  error: string | null;
}

export interface SiteMap {
  start_url: string;
  total_pages: number;
  pages: PageInfo[];
}
