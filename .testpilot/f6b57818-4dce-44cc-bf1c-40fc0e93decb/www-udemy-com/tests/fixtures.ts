import { test as base } from '@playwright/test';

export const TARGET_URL = "https://www.udemy.com/";

export const test = base.extend<{ targetUrl: string }>({
  targetUrl: async ({}, use) => {
    await use(TARGET_URL);
  },
});

export { expect } from '@playwright/test';
