/**
 * Shared TypeScript types for the TestPilot Pilot engine.
 */

/**
 * A single content block inside a message — either plain text or an inline image.
 * Images are sent as base64-encoded PNG/JPEG/WEBP so no external hosting is needed.
 */
export type ContentBlock =
  | { type: 'text';  text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };

/**
 * A message can be a plain string (backward-compatible) or an array of content
 * blocks that may include inline images (for vision-capable models).
 */
export type MessageContent = string | ContentBlock[];

export interface ChatMessage {
  role: string;
  content: MessageContent;
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
  /**
   * Sampling temperature (0–1). Lower = more deterministic/repeatable output.
   * Left undefined → provider default (Anthropic 1.0). Test GENERATION passes a
   * low value so the same app yields a consistent suite run to run.
   */
  temperature?: number;
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
