import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import { buildSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import {
  SnapshotValidationError,
  validateSnapshot,
} from "../../src/server/sync/validate-snapshot.js";
import type { SnapshotManifest } from "../../src/shared/domain.js";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";

const temporaryDirectories: string[] = [];
let artwork: Buffer;

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function createValidSnapshot(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "stsdle-validation-"));
  temporaryDirectories.push(dataDir);
  const activated = await buildSnapshot({
    client: {
      async fetchCards() {
        return {
          cards: fixture as RawSpireCard[],
          rawBody: JSON.stringify(fixture),
          sourceRevision: "validation-revision",
          lastModified: null,
          fetchedAt: "2026-08-12T00:00:00.000Z",
        };
      },
    },
    store: new SnapshotStore(dataDir),
    baseUrl: "https://spire-codex.test",
    fetchImpl: async () => new Response(new Uint8Array(artwork)),
    fallbackRenderer: {
      async render(_raw, _upgraded, destination) {
        await writeFile(destination, artwork);
      },
    },
    artworkConcurrency: 2,
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
  return activated.path;
}

async function readJson<T>(path: string, filename: string): Promise<T> {
  return JSON.parse(await readFile(join(path, filename), "utf8")) as T;
}

async function writeJsonAndRehash(path: string, filename: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  await writeFile(join(path, filename), bytes);
  const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
  manifest.files[filename] = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
}

async function expectIssues(path: string, patterns: readonly RegExp[]): Promise<void> {
  await expect(validateSnapshot(path)).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(SnapshotValidationError);
    const issues = (error as SnapshotValidationError).issues;
    for (const pattern of patterns) expect(issues.some((issue) => pattern.test(issue))).toBe(true);
    return true;
  });
}

describe("validateSnapshot", () => {
  it("returns the complete acceptance report for a valid snapshot", async () => {
    const path = await createValidSnapshot();

    await expect(validateSnapshot(path)).resolves.toMatchObject({
      cardCount: 6,
      upgradeCount: 5,
      baseGroupCount: 6,
      pairGroupCount: 6,
      missingRawArtCardIds: [],
      fallbackCardIds: ["MAD_SCIENCE"],
      candidateSprite: { width: 192, height: 128 },
      guessSprite: { width: 480, height: 320 },
    });
    const report = await validateSnapshot(path);
    expect(Object.values(report.baseGroupHistogram).reduce((sum, value) => sum + value, 0)).toBe(6);
    expect(report.candidateSprite.bytes).toBeGreaterThan(0);
    expect(report.guessSprite.bytes).toBeGreaterThan(0);
  });

  it.each([
    ["cardCount", 99, /card count mismatch/i],
    ["upgradeCount", 99, /upgrade count mismatch/i],
    ["baseGroupCount", 99, /base group count mismatch/i],
    ["pairGroupCount", 99, /pair group count mismatch/i],
  ] as const)("rejects a manifest %s mismatch", async (field, value, pattern) => {
    const path = await createValidSnapshot();
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    manifest[field] = value;
    await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");

    await expectIssues(path, [pattern]);
  });

  it.each([
    ["unknown", (groups: Array<{ key: string; cardIds: string[] }>) => groups[0]!.cardIds.push("UNKNOWN_CARD"), /unknown card ID.*UNKNOWN_CARD/i],
    ["duplicated", (groups: Array<{ key: string; cardIds: string[] }>) => groups[0]!.cardIds.push(groups[0]!.cardIds[0]!), /duplicate group card ID/i],
  ] as const)("rejects an %s group card ID", async (_label, mutate, pattern) => {
    const path = await createValidSnapshot();
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, "base-groups.json");
    mutate(groups);
    await writeJsonAndRehash(path, "base-groups.json", groups);

    await expectIssues(path, [pattern]);
  });

  it.each([
    ["base-groups.json", /missing from expected base group.*AFTERIMAGE/i],
    ["pair-groups.json", /missing from expected pair group.*AFTERIMAGE/i],
  ] as const)("rejects a card missing from %s", async (filename, pattern) => {
    const path = await createValidSnapshot();
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, filename);
    const group = groups.find(({ cardIds }) => cardIds.includes("AFTERIMAGE"))!;
    group.cardIds = group.cardIds.filter((id) => id !== "AFTERIMAGE");
    await writeJsonAndRehash(path, filename, groups);

    await expectIssues(path, [pattern]);
  });

  it("rejects a sprite rectangle outside its atlas", async () => {
    const path = await createValidSnapshot();
    const spriteMap = await readJson<Record<string, any>>(path, "sprite-map.json");
    spriteMap.cards.AFTERIMAGE.candidate.x = spriteMap.candidate.width;
    await writeJsonAndRehash(path, "sprite-map.json", spriteMap);

    await expectIssues(path, [/sprite rectangle outside candidate atlas.*AFTERIMAGE/i]);
  });

  it.each([
    ["candidate.webp", /missing snapshot file.*candidate\.webp/i],
    ["cards.json", /missing snapshot file.*cards\.json/i],
  ] as const)("rejects a missing %s", async (filename, pattern) => {
    const path = await createValidSnapshot();
    await rm(join(path, filename));

    await expectIssues(path, [pattern]);
  });

  it("rejects a card with neither a remote nor fallback full-card URL", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "AFTERIMAGE")!.baseCardUrl = null;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/missing base full-card URL.*AFTERIMAGE/i]);
  });

  it.each([
    ["cardClass", "Watcher", /unknown card class.*AFTERIMAGE/i],
    ["cardType", "Relic", /unknown card type.*AFTERIMAGE/i],
    ["rarity", "Mythic", /unknown card rarity.*AFTERIMAGE/i],
    ["mana", -5, /unknown mana value.*AFTERIMAGE/i],
    ["exhaust", "sometimes", /unknown keyword value.*exhaust.*AFTERIMAGE/i],
  ] as const)("rejects an unknown %s feature value", async (field, value, pattern) => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "AFTERIMAGE")!.base[field] = value;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [pattern]);
  });

  it("rejects duplicate card identities", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.push({ ...cards[0] });
    await writeJsonAndRehash(path, "cards.json", cards);
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    manifest.cardCount = cards.length;
    await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");

    await expectIssues(path, [/duplicate card ID/i]);
  });

  it("rejects a file hash mismatch", async () => {
    const path = await createValidSnapshot();
    await writeFile(join(path, "cards.json"), "[]\n", "utf8");

    await expectIssues(path, [/file hash mismatch.*cards\.json/i]);
  });

  it("does not mistake prototype-named files for manifest hash entries", async () => {
    const path = await createValidSnapshot();
    await writeFile(join(path, "constructor"), "not tracked", "utf8");

    await expectIssues(path, [/snapshot file is not hashed.*constructor/i]);
  });
});
