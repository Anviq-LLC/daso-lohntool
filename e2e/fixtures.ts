import { test as base, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { header } from './token.ts';

// Every page request and every API call carries a freshly signed Access token for the owner.
export const test = base.extend<{ api: APIRequestContext }>({
  page: async ({ page }, use) => {
    await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), ...header() } }));
    await use(page);
  },
  api: async ({}, use) => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://127.0.0.1:8788', extraHTTPHeaders: header() });
    await use(ctx);
    await ctx.dispose();
  },
});
export { expect } from '@playwright/test';
