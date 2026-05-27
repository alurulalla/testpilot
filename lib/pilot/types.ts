/**
 * Shared TypeScript types for the TestPilot Pilot engine.
 */

export interface ChatMessage {
  role: string;
  content: string;
}

/** Minimal chat-completion surface — provider-agnostic. */
export interface ChatModel {
  readonly modelName: string;
  readonly provider: string;
  invoke(messages: ChatMessage[]): Promise<string>;
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
