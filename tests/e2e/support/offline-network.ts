import type { Page } from "@playwright/test";

export const OFFICIAL_CODEX_ORIGINS = [
  "https://spire-codex.com",
  "https://cdn.spire-codex.com",
] as const;

export interface OfficialCodexNetworkGuard {
  attemptedRequests: string[];
  blockedRequests: string[];
}

export async function installOfficialCodexBlock(page: Page): Promise<OfficialCodexNetworkGuard> {
  const attemptedRequests: string[] = [];
  const blockedRequests: string[] = [];
  const officialOrigins = new Set<string>(OFFICIAL_CODEX_ORIGINS);

  page.on("request", (request) => {
    if (officialOrigins.has(new URL(request.url()).origin)) {
      attemptedRequests.push(request.url());
    }
  });

  for (const origin of OFFICIAL_CODEX_ORIGINS) {
    await page.route(`${origin}/**`, (route) => {
      blockedRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
  }

  return { attemptedRequests, blockedRequests };
}
