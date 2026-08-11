import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import { buildSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";

const temporaryDirectories: string[] = [];
let artwork: Buffer;

async function createStore(): Promise<SnapshotStore> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-snapshot-"));
  temporaryDirectories.push(directory);
  return new SnapshotStore(directory);
}

function fixtureClient(cards: RawSpireCard[] = fixture as RawSpireCard[]) {
  return {
    async fetchCards() {
      return {
        cards,
        rawBody: JSON.stringify(cards),
        sourceRevision: "abcdef0123456789",
        lastModified: "Tue, 11 Aug 2026 15:34:42 GMT",
        fetchedAt: "2026-08-11T23:59:00.000Z",
      };
    },
  };
}

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "purple" },
  }).webp().toBuffer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("buildSnapshot", () => {
  it("builds, validates, and activates a stable snapshot with only required fallbacks", async () => {
    const store = await createStore();
    const render = vi.fn(async (_raw: RawSpireCard, _upgraded: boolean, destination: string) => {
      await writeFile(destination, artwork);
    });

    const activated = await buildSnapshot({
      client: fixtureClient(),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render },
      artworkConcurrency: 2,
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(activated.manifest).toMatchObject({
      sourceRevision: "abcdef0123456789",
      fetchedAt: "2026-08-11T23:59:00.000Z",
      generatedAt: "2026-08-12T00:00:00.000Z",
      cardCount: fixture.length,
      upgradeCount: 5,
    });
    expect(activated.manifest.baseGroupCount).toBeGreaterThan(0);
    expect(activated.report.cardCount).toBe(fixture.length);
    await expect(readFile(join(activated.path, "candidate.webp"))).resolves.toBeInstanceOf(Buffer);
    await expect(store.loadActive()).resolves.toMatchObject({ buildId: activated.buildId });
    expect(render.mock.calls.map(([raw, upgraded]) => [raw.id, upgraded])).toEqual([
      ["MAD_SCIENCE", false],
      ["MAD_SCIENCE", true],
    ]);

    const cards = JSON.parse(await readFile(join(activated.path, "cards.json"), "utf8")) as Array<{
      id: string;
      baseCardUrl: string;
      upgradedCardUrl: string | null;
    }>;
    expect(cards.map(({ id }) => id)).toEqual([...cards.map(({ id }) => id)].sort());
    expect(cards.find(({ id }) => id === "MAD_SCIENCE")).toMatchObject({
      baseCardUrl: "/runtime/fallback/MAD_SCIENCE.webp",
      upgradedCardUrl: "/runtime/fallback/MAD_SCIENCE_upg.webp",
    });
    expect(Object.keys(activated.manifest.files)).not.toContain("manifest.json");
    expect(Object.keys(activated.manifest.files)).toEqual([...Object.keys(activated.manifest.files)].sort());
    expect((await readFile(join(activated.path, "manifest.json"), "utf8")).endsWith("\n")).toBe(true);
  });

  it("rejects duplicate stable IDs before creating an active snapshot", async () => {
    const store = await createStore();
    const duplicate = { ...(fixture[0] as RawSpireCard), name: "Different name" };

    await expect(buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard, duplicate]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
    })).rejects.toThrow(/duplicate card ID.*ALCHEMIZE/i);
    await expect(store.loadActive()).resolves.toBeNull();
  });

  it("marks every card whose display name needs class disambiguation", async () => {
    const store = await createStore();
    const first = fixture[0] as RawSpireCard;
    const second = {
      ...first,
      id: "ALCHEMIZE_SILENT",
      color: "silent",
      image_url: "/static/images/cards/alchemize_silent.webp",
    };

    const activated = await buildSnapshot({
      client: fixtureClient([first, second]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
    });
    const cards = JSON.parse(await readFile(join(activated.path, "cards.json"), "utf8")) as Array<{
      id: string;
      duplicateName?: boolean;
    }>;

    expect(cards).toMatchObject([
      { id: "ALCHEMIZE", duplicateName: true },
      { id: "ALCHEMIZE_SILENT", duplicateName: true },
    ]);
  });
});
