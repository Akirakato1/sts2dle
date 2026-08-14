import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CardIdentity, SpriteMap } from "../../src/shared/domain.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import { loadActivatedSnapshot } from "../../src/server/sync/validate-snapshot.js";
import { validateDeploymentArchive } from "../../src/server/release/deployment-archive.js";

const archive = fileURLToPath(new URL("../../deploy/snapshot-data.tar.gz", import.meta.url));
const SOURCE_REVISION = "fa908e4c6f77026a93fe5b8fff25f307fade8b6feb698cd5835e3f40107a39b8";
const OFFICIAL_ORIGINS = new Set([
  "https://spire-codex.com",
  "https://cdn.spire-codex.com",
]);
const OFFICIAL_VALIDATION_OPTIONS = {
  allowedArtworkOrigins: [...OFFICIAL_ORIGINS],
  allowedFullCardOrigins: [...OFFICIAL_ORIGINS],
} as const;

describe("committed production snapshot", () => {
  it("contains one valid current snapshot with official full-card URLs and complete sprite mappings", async () => {
    const validated = await validateDeploymentArchive(
      archive,
      SOURCE_REVISION,
      OFFICIAL_VALIDATION_OPTIONS,
    );
    try {
      const root = validated.extractedDataDir;
      const store = new SnapshotStore(root);
      const active = await store.loadActive();
      expect(active).not.toBeNull();
      expect(await readdir(join(root, "snapshots"))).toEqual([active!.buildId]);

      const loaded = await loadActivatedSnapshot(active!.path, OFFICIAL_VALIDATION_OPTIONS);
      expect(loaded.report.cardCount).toBe(577);
      expect(loaded.report.upgradeCount).toBe(541);
      expect(loaded.report.baseGroupCount).toBe(276);
      expect(loaded.report.pairGroupCount).toBe(324);
      expect(loaded.report.fallbackCardIds).toEqual(["MAD_SCIENCE"]);

      const cards = await readJson<CardIdentity[]>(active!.path, "cards.json");
      const spriteMap = await readJson<SpriteMap>(active!.path, "sprite-map.json");
      const madScience = cards.find((card) => card.id === "MAD_SCIENCE");
      expect(madScience?.baseCardUrl).toMatch(/^\/runtime\/fallback\/.*\.webp$/);
      expect(madScience?.upgradedCardUrl).toMatch(/^\/runtime\/fallback\/.*_upg\.webp$/);
      for (const card of cards) {
        for (const url of [card.baseCardUrl, card.upgradedCardUrl]) {
          if (url !== null && !url.startsWith("/runtime/fallback/")) {
            expect(OFFICIAL_ORIGINS).toContain(new URL(url).origin);
          }
        }
        expect(spriteMap.cards[card.id]?.candidate).toBeDefined();
        expect(spriteMap.cards[card.id]?.guess).toBeDefined();
      }
    } finally {
      await validated.cleanup();
    }
  });
});

async function readJson<T>(directory: string, filename: string): Promise<T> {
  return JSON.parse(await readFile(join(directory, filename), "utf8")) as T;
}
