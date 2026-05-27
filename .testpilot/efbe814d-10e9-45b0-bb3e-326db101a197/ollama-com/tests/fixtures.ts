import { test as base } from '@playwright/test';

export const TARGET_URL = "https://ollama.com/";

export const test = base.extend<{ targetUrl: string }>({
  targetUrl: async ({}, use) => {
    await use(TARGET_URL);
  },
});

export { expect } from '@playwright/test';
