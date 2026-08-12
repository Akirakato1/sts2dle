import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
let fallbackImage: Buffer;
const VALIDATION_OPTIONS = {
  allowedArtworkOrigins: ["https://spire-codex.test"],
  allowedFullCardOrigins: ["https://cdn.test"],
} as const;

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
  fallbackImage = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "orange" },
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
          sourceRevision: "cd".repeat(32),
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
        await writeFile(destination, fallbackImage);
      },
    },
    artworkConcurrency: 2,
    allowedArtworkOrigins: ["https://spire-codex.test"],
    allowedFullCardOrigins: ["https://cdn.test"],
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

async function writeBytesAndRehash(path: string, filename: string, bytes: Buffer): Promise<void> {
  await writeFile(join(path, ...filename.split("/")), bytes);
  const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
  manifest.files[filename] = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
}

function corruptWebpPayload(bytes: Buffer): Buffer {
  const corrupted = Buffer.from(bytes);
  corrupted.fill(0, 40);
  return corrupted;
}

async function expectIssues(path: string, patterns: readonly RegExp[]): Promise<void> {
  await expect(validateSnapshot(path, VALIDATION_OPTIONS)).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(SnapshotValidationError);
    const issues = (error as SnapshotValidationError).issues;
    for (const pattern of patterns) expect(issues.some((issue) => pattern.test(issue))).toBe(true);
    return true;
  });
}

describe("validateSnapshot", () => {
  it("returns the complete acceptance report for a valid snapshot", async () => {
    const path = await createValidSnapshot();

    await expect(validateSnapshot(path, VALIDATION_OPTIONS)).resolves.toMatchObject({
      cardCount: 6,
      upgradeCount: 5,
      baseGroupCount: 6,
      pairGroupCount: 6,
      missingRawArtCardIds: [],
      fallbackCardIds: ["MAD_SCIENCE"],
      candidateSprite: { width: 192, height: 128 },
      guessSprite: { width: 480, height: 320 },
    });
    const report = await validateSnapshot(path, VALIDATION_OPTIONS);
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
    ["sourceRevision", "ABC", /sourceRevision/i],
    ["sourceRevision", "AB".repeat(32), /sourceRevision/i],
    ["fetchedAt", "2026-08-12T00:00:00Z", /fetchedAt/i],
    ["generatedAt", "2026-08-12T09:00:01.000+09:00", /generatedAt/i],
    ["generatedAt", "not-a-date", /generatedAt/i],
  ] as const)("rejects corrupt recovery manifest metadata %s=%s", async (field, value, pattern) => {
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
    ["cell width", (map: Record<string, any>) => { map.cards.AFTERIMAGE.candidate.width = 63; }, /candidate sprite rectangle.*AFTERIMAGE.*expected/i],
    ["display scale", (map: Record<string, any>) => { map.candidate.displayScale = 1; }, /candidate display scale.*0\.5/i],
    ["overlap", (map: Record<string, any>) => { map.cards.ALCHEMIZE.candidate = { ...map.cards.AFTERIMAGE.candidate }; }, /candidate sprite rectangle.*ALCHEMIZE.*expected/i],
    ["atlas geometry", (map: Record<string, any>) => { map.candidate.width += 64; }, /candidate atlas geometry/i],
    ["guess cell width", (map: Record<string, any>) => { map.cards.AFTERIMAGE.guess.width = 159; }, /guess sprite rectangle.*AFTERIMAGE.*expected/i],
    ["guess display scale", (map: Record<string, any>) => { map.guess.displayScale = 1; }, /guess display scale.*0\.45/i],
    ["guess overlap", (map: Record<string, any>) => { map.cards.ALCHEMIZE.guess = { ...map.cards.AFTERIMAGE.guess }; }, /guess sprite rectangle.*ALCHEMIZE.*expected/i],
    ["guess atlas geometry", (map: Record<string, any>) => { map.guess.height += 160; }, /guess atlas geometry/i],
  ] as const)("rejects wrong sprite %s", async (_label, mutate, pattern) => {
    const path = await createValidSnapshot();
    const spriteMap = await readJson<Record<string, any>>(path, "sprite-map.json");
    mutate(spriteMap);
    await writeJsonAndRehash(path, "sprite-map.json", spriteMap);

    await expectIssues(path, [pattern]);
  });

  it.each([
    ["one-pixel WebP", async () => sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).webp().toBuffer(), /candidate\.webp dimensions/i],
    ["PNG atlas", async () => sharp({ create: { width: 192, height: 128, channels: 3, background: "red" } }).png().toBuffer(), /candidate\.webp.*WebP/i],
  ] as const)("rejects a rehashed %s", async (_label, makeBytes, pattern) => {
    const path = await createValidSnapshot();
    await writeBytesAndRehash(path, "candidate.webp", await makeBytes());

    await expectIssues(path, [pattern]);
  });

  it.each(["candidate.webp", "guess.webp"] as const)(
    "rejects rehashed %s payload corruption that preserves readable metadata",
    async (filename) => {
      const path = await createValidSnapshot();
      const corrupted = corruptWebpPayload(await readFile(join(path, filename)));
      await expect(sharp(corrupted).metadata()).resolves.toMatchObject({ format: "webp" });
      await expect(sharp(corrupted).raw().toBuffer()).rejects.toThrow();
      await writeBytesAndRehash(path, filename, corrupted);

      await expectIssues(path, [new RegExp(`invalid sprite file ${filename.replace(".", "\\.")}`, "i")]);
    },
  );

  it("passes trusted exact pixel limits to the full-decode seam", async () => {
    const path = await createValidSnapshot();
    const imageDecodeObserver = vi.fn((
      _request: { label: string; limitInputPixels: number },
    ) => undefined);

    await expect(validateSnapshot(path, {
      ...VALIDATION_OPTIONS,
      imageDecodeObserver,
    })).resolves.toMatchObject({ cardCount: 6 });

    const requests = imageDecodeObserver.mock.calls.map(([request]) => request);
    expect(requests).toEqual(expect.arrayContaining([
      { label: "candidate.webp", limitInputPixels: 192 * 128 },
      { label: "guess.webp", limitInputPixels: 480 * 320 },
    ]));
    expect(requests.filter(({ label }) => label.startsWith("fallback/"))).toHaveLength(2);
    expect(requests.filter(({ label }) => label.startsWith("fallback/")).every(
      ({ limitInputPixels }) => limitInputPixels === 400 * 520,
    )).toBe(true);
  });

  it.each([
    ["wrong dimensions", async () => sharp({ create: { width: 191, height: 128, channels: 3, background: "red" } }).webp().toBuffer()],
    ["wrong format", async () => sharp({ create: { width: 192, height: 128, channels: 3, background: "red" } }).png().toBuffer()],
    ["oversized metadata", async () => sharp({ create: { width: 256, height: 128, channels: 3, background: "red" } }).webp().toBuffer()],
  ] as const)("does not enter full decode for candidate atlas %s", async (_label, makeBytes) => {
    const path = await createValidSnapshot();
    const bytes = await makeBytes();
    await expect(sharp(bytes, { limitInputPixels: false }).metadata()).resolves.toMatchObject({ width: expect.any(Number) });
    await writeBytesAndRehash(path, "candidate.webp", bytes);
    const imageDecodeObserver = vi.fn((
      _request: { label: string; limitInputPixels: number },
    ) => undefined);

    await expect(validateSnapshot(path, {
      ...VALIDATION_OPTIONS,
      imageDecodeObserver,
    })).rejects.toBeInstanceOf(SnapshotValidationError);
    const labels = imageDecodeObserver.mock.calls.map(([request]) => request.label);
    expect(labels).not.toContain("candidate.webp");
    expect(labels).toContain("guess.webp");
  });

  it("inspects and rejects an unreferenced emitted fallback image", async () => {
    const path = await createValidSnapshot();
    await writeBytesAndRehash(path, "fallback/unreferenced.webp", Buffer.from("not an image"));

    await expectIssues(path, [/unreferenced fallback file/i, /invalid fallback WebP.*unreferenced/i]);
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

  it("binds each fallback URL to the exact card and variant mapping", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    const madScience = cards.find(({ id }) => id === "MAD_SCIENCE")!;
    [madScience.baseCardUrl, madScience.upgradedCardUrl] = [
      madScience.upgradedCardUrl,
      madScience.baseCardUrl,
    ];
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/fallback URL mapping.*MAD_SCIENCE.*base/i, /fallback URL mapping.*MAD_SCIENCE.*upgraded/i]);
  });

  it.each([
    ["one-pixel fallback", async () => sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).webp().toBuffer(), /fallback.*400x520/i],
    ["invalid fallback", async () => Buffer.from("not an image"), /invalid fallback WebP/i],
  ] as const)("rejects a rehashed %s", async (_label, makeBytes, pattern) => {
    const path = await createValidSnapshot();
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    const fallbackFile = Object.keys(manifest.files).find((filename) => filename.startsWith("fallback/"))!;
    await writeBytesAndRehash(path, fallbackFile, await makeBytes());

    await expectIssues(path, [pattern]);
  });

  it("rejects rehashed fallback payload corruption that preserves readable metadata", async () => {
    const path = await createValidSnapshot();
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    const fallbackFile = Object.keys(manifest.files).find((filename) => filename.startsWith("fallback/"))!;
    const corrupted = corruptWebpPayload(await readFile(join(path, ...fallbackFile.split("/"))));
    await expect(sharp(corrupted).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 400,
      height: 520,
    });
    await expect(sharp(corrupted).raw().toBuffer()).rejects.toThrow();
    await writeBytesAndRehash(path, fallbackFile, corrupted);

    await expectIssues(path, [/invalid fallback WebP/i]);
  });

  it("does not enter full decode for an oversized metadata-readable fallback", async () => {
    const path = await createValidSnapshot();
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    const fallbackFile = Object.keys(manifest.files).find((filename) => filename.startsWith("fallback/"))!;
    const bytes = await sharp({
      create: { width: 401, height: 520, channels: 3, background: "red" },
    }).webp().toBuffer();
    await expect(sharp(bytes, { limitInputPixels: false }).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 401,
      height: 520,
    });
    await writeBytesAndRehash(path, fallbackFile, bytes);
    const imageDecodeObserver = vi.fn((
      _request: { label: string; limitInputPixels: number },
    ) => undefined);

    await expect(validateSnapshot(path, {
      ...VALIDATION_OPTIONS,
      imageDecodeObserver,
    })).rejects.toBeInstanceOf(SnapshotValidationError);
    const labels = imageDecodeObserver.mock.calls.map(([request]) => request.label);
    expect(labels).not.toContain(fallbackFile);
    expect(labels).toContain("candidate.webp");
  });

  it("rejects a rehashed reveal URL outside the configured origin allowlist", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "AFTERIMAGE")!.baseCardUrl = "https://unapproved.example/card.webp";
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/full-card base.*AFTERIMAGE.*not allowed/i]);
  });

  it("rejects rehashed artwork outside the configured origin allowlist", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "AFTERIMAGE")!.artUrl = "https://unapproved.example/art.webp";
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/artwork.*AFTERIMAGE.*not allowed/i]);
  });

  it("rejects an unsafe supplied upgraded reveal URL on a non-upgradable card", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "DAZED")!.upgradedCardUrl = "https://127.0.0.1/unused.webp";
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/full-card upgraded.*DAZED.*not allowed/i]);
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

  it.each([
    ["base", "unplayable", true, /invalid base feature keys.*DAZED.*unplayable/i],
    ["upgraded", "unplayable", false, /invalid upgraded feature keys.*DAZED.*unplayable/i],
    ["base", "mana", "–", /unknown mana value.*DAZED/i],
  ] as const)("rejects rehashed legacy %s feature %s", async (variant, field, value, pattern) => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === "DAZED")![variant][field] = value;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [pattern]);
  });

  it.each([
    ["upgradable base", "AFTERIMAGE", "base"],
    ["upgradable upgraded", "AFTERIMAGE", "upgraded"],
    ["non-upgradable base", "DAZED", "base"],
    ["non-upgradable upgraded", "DAZED", "upgraded"],
  ] as const)("rejects an extra feature key in %s features", async (_label, cardId, variant) => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards.find(({ id }) => id === cardId)![variant].futureKeyword = false;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [new RegExp(`invalid ${variant} feature keys.*${cardId}.*futureKeyword`, "i")]);
  });

  it("accepts semantically equal non-upgradable features with different property order", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    const dazed = cards.find(({ id }) => id === "DAZED")!;
    dazed.upgraded = Object.fromEntries(Object.entries(dazed.upgraded).reverse());
    await writeJsonAndRehash(path, "cards.json", cards);

    await expect(validateSnapshot(path, VALIDATION_OPTIONS)).resolves.toMatchObject({ cardCount: 6 });
  });

  it("still rejects a changed feature on a non-upgradable card", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    const dazed = cards.find(({ id }) => id === "DAZED")!;
    dazed.upgraded.innate = !dazed.base.innate;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [/non-upgradable card has different effective upgraded features.*DAZED/i]);
  });

  it.each([
    ["null", null, /invalid card at index 0.*object/i],
    ["array", [], /invalid card at index 0.*object/i],
    ["malformed object", { id: "BROKEN" }, /missing card name.*BROKEN/i],
  ] as const)("aggregates a %s card entry without leaking a raw runtime error", async (_label, entry, pattern) => {
    const path = await createValidSnapshot();
    const cards = await readJson<unknown[]>(path, "cards.json");
    cards[0] = entry;
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

  it.each(["base", "pair"] as const)("rejects an extra empty %s group", async (kind) => {
    const path = await createValidSnapshot();
    const filename = `${kind}-groups.json`;
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, filename);
    groups.push({ key: "arbitrary", cardIds: [] });
    groups.sort((left, right) => left.key.localeCompare(right.key));
    await writeJsonAndRehash(path, filename, groups);
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    manifest[kind === "base" ? "baseGroupCount" : "pairGroupCount"] = groups.length;
    await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");

    await expectIssues(path, [new RegExp(`${kind} groups do not exactly match`, "i")]);
  });

  it.each(["base", "pair"] as const)("rejects a renamed %s group key", async (kind) => {
    const path = await createValidSnapshot();
    const filename = `${kind}-groups.json`;
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, filename);
    groups[0]!.key = `wrong-${kind}-key`;
    groups.sort((left, right) => left.key.localeCompare(right.key));
    await writeJsonAndRehash(path, filename, groups);

    await expectIssues(path, [new RegExp(`${kind} groups do not exactly match`, "i")]);
  });

  it.each(["base", "pair"] as const)("rejects a missing complete %s group", async (kind) => {
    const path = await createValidSnapshot();
    const filename = `${kind}-groups.json`;
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, filename);
    groups.shift();
    await writeJsonAndRehash(path, filename, groups);
    const manifest = await readJson<SnapshotManifest>(path, "manifest.json");
    manifest[kind === "base" ? "baseGroupCount" : "pairGroupCount"] = groups.length;
    await writeFile(join(path, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");

    await expectIssues(path, [new RegExp(`${kind} groups do not exactly match`, "i")]);
  });

  it.each(["base", "pair"] as const)("rejects wrong card membership in %s groups", async (kind) => {
    const path = await createValidSnapshot();
    const filename = `${kind}-groups.json`;
    const groups = await readJson<Array<{ key: string; cardIds: string[] }>>(path, filename);
    const source = groups.find((group) => group.cardIds.length > 0)!;
    const target = groups.find((group) => group !== source && group.cardIds.length > 0)!;
    const movedCard = source.cardIds.shift()!;
    target.cardIds.push(movedCard);
    target.cardIds.sort();
    await writeJsonAndRehash(path, filename, groups);

    await expectIssues(path, [new RegExp(`${kind} groups do not exactly match`, "i")]);
  });

  it("rejects missing and spurious normalized duplicate-name markers", async () => {
    const path = await createValidSnapshot();
    const cards = await readJson<Array<Record<string, any>>>(path, "cards.json");
    cards[0]!.name = "  Shared Name  ";
    cards[1]!.name = "shared name";
    cards[2]!.duplicateName = true;
    await writeJsonAndRehash(path, "cards.json", cards);

    await expectIssues(path, [
      /duplicate-name marker.*AFTERIMAGE.*expected true/i,
      /duplicate-name marker.*ALCHEMIZE.*expected true/i,
      /duplicate-name marker.*APPARITION.*expected absent/i,
    ]);
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
