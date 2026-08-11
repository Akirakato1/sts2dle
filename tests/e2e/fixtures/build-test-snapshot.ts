import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

import { RawSpireCardsSchema, type RawSpireCard } from "../../../src/server/spire-codex/schema.js";
import { buildSnapshot } from "../../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../../src/server/sync/snapshot-store.js";
import { withE2eFixtureDataLock } from "./fixture-data-lock.js";
import { pruneSupersededFixtureSnapshots } from "./prune-test-snapshots.js";

const ART_ORIGIN = "https://fixture.test";
const FULL_CARD_ORIGIN = "https://cdn.test";
const FIXED_TIME = "2026-08-12T00:00:00.000Z";

function withE2eUpgrade(card: RawSpireCard): RawSpireCard {
  const copy = structuredClone(card);
  if (!copy.upgrade || Object.keys(copy.upgrade).length === 0) {
    copy.upgrade = { fixture_upgrade: true };
  }
  copy.image_url_card_upg ??= `${FULL_CARD_ORIGIN}/${copy.id.toLowerCase()}_upg.webp`;
  return copy;
}

function pairedCopy(card: RawSpireCard): RawSpireCard {
  return {
    ...structuredClone(card),
    id: `${card.id}_PAIR`,
    name: `${card.name} Pair`,
    image_url: `/fixture-art/${card.id.toLowerCase()}-pair.webp`,
    image_url_card: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair.webp`,
    image_url_card_upg: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair_upg.webp`,
  };
}

async function main(): Promise<void> {
  const fixturePath = resolve("tests/fixtures/spire-cards.json");
  const fixtureBody = await readFile(fixturePath, "utf8");
  const originals = RawSpireCardsSchema.parse(JSON.parse(fixtureBody)).map(withE2eUpgrade);
  const cards = originals.flatMap((card) => [card, pairedCopy(card)]);
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
