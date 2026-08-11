import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSprites } from "../../src/server/images/build-sprites.js";
import type { CardIdentity } from "../../src/shared/domain.js";

const temporaryDirectories: string[] = [];
const artworkByUrl = new Map<string, Buffer>();

function card(id: string): CardIdentity {
  const features = {
    cardClass: "Ironclad",
    cardType: "Attack",
    mana: 1,
    rarity: "Common",
    eternal: false,
    ethereal: false,
    exhaust: false,
    innate: false,
    retain: false,
    sly: false,
    unplayable: false,
  } as const;
  return {
    id,
    name: id,
    hasUpgrade: true,
    artUrl: `https://art.example/${id}.webp`,
    baseCardUrl: null,
    upgradedCardUrl: null,
    base: features,
    upgraded: features,
  };
}

async function createOutputDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-sprites-"));
  temporaryDirectories.push(directory);
  return directory;
}

function imageResponse(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/webp" },
  });
}

async function readRgbPixel(imagePath: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(await readFile(imagePath))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

async function expectNoFinalAtlases(outputDir: string): Promise<void> {
  await expect(readFile(join(outputDir, "candidate.webp"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(outputDir, "guess.webp"))).rejects.toMatchObject({ code: "ENOENT" });
}

beforeAll(async () => {
  artworkByUrl.set(
    card("CARD_A").artUrl,
    await sharp({ create: { width: 12, height: 8, channels: 3, background: "red" } })
      .webp()
      .toBuffer(),
  );
  artworkByUrl.set(
    card("CARD_B").artUrl,
    await sharp({ create: { width: 8, height: 12, channels: 3, background: "green" } })
      .webp()
      .toBuffer(),
  );
  artworkByUrl.set(
    card("CARD_C").artUrl,
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } })
      .webp()
      .toBuffer(),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("buildSprites", () => {
  it("rejects an empty card list without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();

    await expect(buildSprites({
      cards: [],
      outputDir,
      fetchImpl: async () => {
        throw new Error("artwork should not be requested for an empty card list");
      },
      concurrency: 1,
    })).rejects.toThrow(/at least one card/i);
    await expectNoFinalAtlases(outputDir);
  });

  it("downloads each artwork once and packs both atlases by stable card ID", async () => {
    const outputDir = await createOutputDirectory();
    let activeDownloads = 0;
    let maximumActiveDownloads = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      activeDownloads += 1;
      maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDownloads -= 1;
      const bytes = artworkByUrl.get(String(input));
      if (!bytes) return new Response(null, { status: 404 });
      return imageResponse(bytes);
    });

    const map = await buildSprites({
      cards: [card("CARD_C"), card("CARD_A"), card("CARD_B")],
      outputDir,
      fetchImpl,
      concurrency: 2,
    });

    expect(map.cards.CARD_A?.candidate).toEqual({ x: 0, y: 0, width: 64, height: 64 });
    expect(map.cards.CARD_B?.candidate).toEqual({ x: 64, y: 0, width: 64, height: 64 });
    expect(map.cards.CARD_C?.candidate).toEqual({ x: 0, y: 64, width: 64, height: 64 });
    expect(map.cards.CARD_A?.guess).toEqual({ x: 0, y: 0, width: 160, height: 160 });
    expect(map).toMatchObject({
      candidate: { url: "/runtime/candidate.webp", width: 128, height: 128, displayScale: 0.5 },
      guess: { url: "/runtime/guess.webp", width: 320, height: 320, displayScale: 0.5 },
    });
    await expect(sharp(await readFile(join(outputDir, "candidate.webp"))).metadata()).resolves.toMatchObject({
      width: 128,
      height: 128,
    });
    await expect(sharp(await readFile(join(outputDir, "guess.webp"))).metadata()).resolves.toMatchObject({
      width: 320,
      height: 320,
    });
    const redPixel = await readRgbPixel(join(outputDir, "candidate.webp"), 32, 32);
    const greenPixel = await readRgbPixel(join(outputDir, "candidate.webp"), 96, 32);
    const bluePixel = await readRgbPixel(join(outputDir, "candidate.webp"), 32, 96);
    expect(redPixel[0]).toBeGreaterThan(200);
    expect(redPixel[1]).toBeLessThan(30);
    expect(greenPixel[1]).toBeGreaterThan(80);
    expect(greenPixel[0]).toBeLessThan(30);
    expect(bluePixel[2]).toBeGreaterThan(200);
    expect(bluePixel[0]).toBeLessThan(30);
    expect((await readdir(outputDir)).sort()).toEqual(["candidate.webp", "guess.webp"]);
    expect(maximumActiveDownloads).toBe(2);
    for (const artworkUrl of artworkByUrl.keys()) {
      expect(fetchImpl.mock.calls.filter(([input]) => String(input) === artworkUrl)).toHaveLength(1);
    }
  });

  it("bounds cell transforms across both atlases by the configured concurrency", async () => {
    const outputDir = await createOutputDirectory();
    let activeTransforms = 0;
    let maximumActiveTransforms = 0;
    let transformCount = 0;

    await buildSprites({
      cards: [card("CARD_D"), card("CARD_C"), card("CARD_B"), card("CARD_A")],
      outputDir,
      fetchImpl: async () => imageResponse(artworkByUrl.get(card("CARD_A").artUrl)!),
      concurrency: 2,
      transformCellImpl: async (source: Buffer, cellSize: 64 | 160) => {
        activeTransforms += 1;
        transformCount += 1;
        maximumActiveTransforms = Math.max(maximumActiveTransforms, activeTransforms);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await sharp(source)
            .resize(cellSize, cellSize, { fit: "cover", position: "centre" })
            .webp({ quality: cellSize === 64 ? 76 : 82 })
            .toBuffer();
        } finally {
          activeTransforms -= 1;
        }
      },
    });

    expect(transformCount).toBe(8);
    expect(maximumActiveTransforms).toBe(2);
  });

  it("produces identical maps and atlases after input shuffling", async () => {
    const firstOutputDir = await createOutputDirectory();
    const secondOutputDir = await createOutputDirectory();
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const bytes = artworkByUrl.get(String(input));
      return bytes ? imageResponse(bytes) : new Response(null, { status: 404 });
    };

    const first = await buildSprites({
      cards: [card("CARD_A"), card("CARD_B"), card("CARD_C")],
      outputDir: firstOutputDir,
      fetchImpl,
      concurrency: 2,
    });
    const second = await buildSprites({
      cards: [card("CARD_B"), card("CARD_C"), card("CARD_A")],
      outputDir: secondOutputDir,
      fetchImpl,
      concurrency: 2,
    });

    expect(second).toEqual(first);
    await expect(readFile(join(secondOutputDir, "candidate.webp"))).resolves.toEqual(
      await readFile(join(firstOutputDir, "candidate.webp")),
    );
    await expect(readFile(join(secondOutputDir, "guess.webp"))).resolves.toEqual(
      await readFile(join(firstOutputDir, "guess.webp")),
    );
  });

  it("fetches a shared artwork URL only once", async () => {
    const outputDir = await createOutputDirectory();
    const sharedArtworkUrl = card("CARD_A").artUrl;
    const fetchImpl = vi.fn(async () => imageResponse(artworkByUrl.get(sharedArtworkUrl)!));

    const map = await buildSprites({
      cards: [card("CARD_A"), { ...card("CARD_B"), artUrl: sharedArtworkUrl }],
      outputDir,
      fetchImpl,
      concurrency: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.cards.CARD_A?.candidate).toEqual({ x: 0, y: 0, width: 64, height: 64 });
    expect(map.cards.CARD_B?.candidate).toEqual({ x: 64, y: 0, width: 64, height: 64 });
  });

  it("preserves unsafe-looking card IDs as serialized sprite-map keys", async () => {
    const outputDir = await createOutputDirectory();

    const map = await buildSprites({
      cards: [card("__proto__")],
      outputDir,
      fetchImpl: async () => imageResponse(artworkByUrl.get(card("CARD_A").artUrl)!),
      concurrency: 1,
    });
    const serialized = JSON.parse(JSON.stringify(map)) as typeof map;

    expect(Object.hasOwn(map.cards, "__proto__")).toBe(true);
    expect(serialized.cards.__proto__?.candidate).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    });
  });

  it("rejects a missing artwork URL without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();
    const missingArtwork = { ...card("CARD_A"), artUrl: "" };

    await expect(buildSprites({
      cards: [missingArtwork],
      outputDir,
      fetchImpl: async () => imageResponse(artworkByUrl.get(card("CARD_A").artUrl)!),
      concurrency: 1,
    })).rejects.toThrow(/missing artwork URL.*CARD_A/i);
    await expectNoFinalAtlases(outputDir);
  });

  it("rejects an unsuccessful artwork response without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();

    await expect(buildSprites({
      cards: [card("CARD_A")],
      outputDir,
      fetchImpl: async () => new Response(
        new Uint8Array(artworkByUrl.get(card("CARD_A").artUrl)!),
        { status: 503 },
      ),
      concurrency: 1,
    })).rejects.toThrow(/download artwork.*CARD_A.*503/i);
    await expectNoFinalAtlases(outputDir);
  });

  it("settles in-flight workers and stops dequeuing after a download failure", async () => {
    const outputDir = await createOutputDirectory();
    const requestedUrls: string[] = [];
    let releaseSecondDownload = (): void => undefined;
    const secondDownloadGate = new Promise<void>((resolve) => {
      releaseSecondDownload = resolve;
    });
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === card("CARD_A").artUrl) {
        return new Response(new Uint8Array(artworkByUrl.get(url)!), { status: 503 });
      }
      if (url === card("CARD_B").artUrl) await secondDownloadGate;
      return imageResponse(artworkByUrl.get(url)!);
    };

    const buildPromise = buildSprites({
      cards: [card("CARD_A"), card("CARD_B"), card("CARD_C")],
      outputDir,
      fetchImpl,
      concurrency: 2,
    });
    const settledOutcome = buildPromise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const earlyOutcome = await Promise.race([
      settledOutcome,
      new Promise<"pending">((resolve) => {
        timeout = setTimeout(() => resolve("pending"), 20);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    releaseSecondDownload();

    await expect(buildPromise).rejects.toThrow(/download artwork.*CARD_A.*503/i);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(earlyOutcome).toBe("pending");
    expect(requestedUrls).toEqual([card("CARD_A").artUrl, card("CARD_B").artUrl]);
    await expectNoFinalAtlases(outputDir);
  });

  it("rejects empty artwork bytes without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();

    await expect(buildSprites({
      cards: [card("CARD_A")],
      outputDir,
      fetchImpl: async () => new Response(null, { status: 200 }),
      concurrency: 1,
    })).rejects.toThrow(/empty artwork.*CARD_A/i);
    await expectNoFinalAtlases(outputDir);
  });

  it("rejects invalid artwork bytes without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();

    await expect(buildSprites({
      cards: [card("CARD_A")],
      outputDir,
      fetchImpl: async () => imageResponse(Buffer.from("not an image")),
      concurrency: 1,
    })).rejects.toThrow(/invalid artwork.*CARD_A/i);
    await expectNoFinalAtlases(outputDir);
  });

  it("rejects duplicate card IDs without publishing either atlas", async () => {
    const outputDir = await createOutputDirectory();

    await expect(buildSprites({
      cards: [card("CARD_A"), { ...card("CARD_A"), artUrl: card("CARD_B").artUrl }],
      outputDir,
      fetchImpl: async (input) => imageResponse(artworkByUrl.get(String(input))!),
      concurrency: 1,
    })).rejects.toThrow(/duplicate card ID.*CARD_A/i);
    await expectNoFinalAtlases(outputDir);
  });

  it.each([0, 5, 1.5, Number.NaN])(
    "rejects artwork concurrency %s without publishing either atlas",
    async (concurrency) => {
      const outputDir = await createOutputDirectory();

      await expect(buildSprites({
        cards: [card("CARD_A")],
        outputDir,
        fetchImpl: async () => imageResponse(artworkByUrl.get(card("CARD_A").artUrl)!),
        concurrency,
      })).rejects.toThrow(/concurrency must be an integer from 1 to 4/i);
      await expectNoFinalAtlases(outputDir);
    },
  );

  it("rejects an atlas dimension above 8192 pixels before downloading artwork", async () => {
    const outputDir = await createOutputDirectory();
    const cards = Array.from({ length: 2_652 }, (_, index) => (
      card(`CARD_${index.toString().padStart(4, "0")}`)
    ));

    await expect(buildSprites({
      cards,
      outputDir,
      fetchImpl: async () => {
        throw new Error("artwork should not be downloaded for an oversized atlas");
      },
      concurrency: 4,
    })).rejects.toThrow(/atlas dimension.*8192/i);
    await expectNoFinalAtlases(outputDir);
  });
});
