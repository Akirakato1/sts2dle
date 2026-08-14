import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

import {
  CARD_RARITIES,
  CARD_TYPES,
  type CardIdentity,
} from "../../../src/shared/domain.js";
import { baseKey, pairKey } from "../../../src/shared/feature-keys.js";
import { RawSpireCardsSchema } from "../../../src/server/spire-codex/schema.js";
import { buildSnapshot } from "../../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../../src/server/sync/snapshot-store.js";
import { buildE2eFixtureCards } from "./cards.js";
import { withE2eFixtureDataLock } from "./fixture-data-lock.js";
import { pruneSupersededFixtureSnapshots } from "./prune-test-snapshots.js";

const ART_ORIGIN = "https://fixture.test";
const FULL_CARD_ORIGIN = "https://cdn.test";
const FIXED_TIME = "2026-08-12T00:00:00.000Z";

async function main(): Promise<void> {
  const fixturePath = resolve("tests/fixtures/spire-cards.json");
  const fixtureBody = await readFile(fixturePath, "utf8");
  const originals = RawSpireCardsSchema.parse(JSON.parse(fixtureBody));
  const cards = buildE2eFixtureCards(originals);
  const sourceBody = JSON.stringify(cards);
  const sourceRevision = createHash("sha256").update(sourceBody).digest("hex");
  const portrait = await sharp({
    create: {
      width: 400,
      height: 520,
      channels: 4,
      background: { r: 91, g: 42, b: 28, alpha: 1 },
    },
  }).webp().toBuffer();
  const dataDir = process.env.STSDLE_DATA_DIR ?? ".tmp/e2e-var";
  const active = await withE2eFixtureDataLock(dataDir, async (lockedDataDir) => {
    const store = new SnapshotStore(lockedDataDir);
    const built = await buildSnapshot({
      client: {
        fetchCards: async () => ({
          cards,
          rawBody: sourceBody,
          sourceRevision,
          lastModified: "Tue, 12 Aug 2026 00:00:00 GMT",
          fetchedAt: FIXED_TIME,
        }),
      },
      store,
      baseUrl: ART_ORIGIN,
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (new URL(url).origin !== ART_ORIGIN) {
          throw new Error(`E2E fixture blocked unexpected network request: ${url}`);
        }
        return new Response(Uint8Array.from(portrait).buffer, {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      },
      fallbackRenderer: {
        render: async (_raw, upgraded, destination) => {
          await sharp({
            create: {
              width: 400,
              height: 520,
              channels: 4,
              background: upgraded
                ? { r: 66, g: 103, b: 116, alpha: 1 }
                : { r: 126, g: 55, b: 37, alpha: 1 },
            },
          }).webp().toFile(destination);
        },
      },
      artworkConcurrency: 2,
      allowedArtworkOrigins: [ART_ORIGIN],
      allowedFullCardOrigins: [FULL_CARD_ORIGIN],
      now: () => new Date(FIXED_TIME),
    });
    const builtCards = JSON.parse(
      await readFile(resolve(built.path, "cards.json"), "utf8"),
    ) as CardIdentity[];
    const fallingStar = builtCards.find((card) => card.id === "FALLING_STAR");
    if (fallingStar?.base.rarity !== "Basic" || fallingStar.upgraded.rarity !== "Basic") {
      throw new Error("Falling Star fixture rarity was not preserved");
    }
    for (const card of builtCards) {
      if (!CARD_TYPES.includes(card.base.cardType) || !CARD_TYPES.includes(card.upgraded.cardType)) {
        throw new Error(`Fixture card type is outside the canonical domain: ${card.id}`);
      }
      if (!CARD_RARITIES.includes(card.base.rarity) || !CARD_RARITIES.includes(card.upgraded.rarity)) {
        throw new Error(`Fixture rarity is outside the canonical domain: ${card.id}`);
      }
    }
    const dazed = builtCards.find((card) => card.id === "DAZED");
    const dazedPair = builtCards.find((card) => card.id === "DAZED_PAIR");
    if (!dazed || !dazedPair) throw new Error("Dazed E2E pair was not retained");
    if (!dazed.base.keywords.includes("Unplayable") || !dazedPair.base.keywords.includes("Unplayable")) {
      throw new Error("Raw Unplayable state was not retained in fixture keyword sets");
    }
    if (baseKey(dazed.base) !== baseKey(dazedPair.base) || pairKey(dazed) !== pairKey(dazedPair)) {
      throw new Error("Equivalent Unplayable fixtures generated different feature keys");
    }
    await pruneSupersededFixtureSnapshots(lockedDataDir, built, {
      allowedArtworkOrigins: [ART_ORIGIN],
      allowedFullCardOrigins: [FULL_CARD_ORIGIN],
    });
    return built;
  });

  process.stdout.write(`${JSON.stringify({
    event: "e2e_fixture_snapshot",
    sourceRevision: active.manifest.sourceRevision,
    cardCount: active.report.cardCount,
    fallbackCardCount: active.report.fallbackCardIds.length,
  })}\n`);
}

main().catch(() => {
  process.stderr.write("E2E fixture snapshot build failed\n");
  process.exitCode = 1;
});
