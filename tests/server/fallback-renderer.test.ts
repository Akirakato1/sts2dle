import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import { FallbackRenderer } from "../../src/server/images/fallback-renderer.js";
import { RawSpireCardsSchema } from "../../src/server/spire-codex/schema.js";

const cards = RawSpireCardsSchema.parse(fixture);
const temporaryDirectories: string[] = [];
let portraitBytes: Buffer;

function card(id: string) {
  const result = cards.find((entry) => entry.id === id);
  if (!result) throw new Error(`Fixture card not found: ${id}`);
  return result;
}

function imageResponse(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/webp" },
  });
}

async function createOutputDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-fallback-renderer-"));
  temporaryDirectories.push(directory);
  return directory;
}

beforeAll(async () => {
  portraitBytes = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 42, g: 96, b: 130 },
    },
  }).webp().toBuffer();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("FallbackRenderer", () => {
  it("renders distinct 400 by 520 WebP images for base and upgraded Mad Science", async () => {
    const outputDir = await createOutputDirectory();
    const basePath = join(outputDir, "mad-science.webp");
    const upgradedPath = join(outputDir, "mad-science-upg.webp");
    const renderer = new FallbackRenderer({
      fetchImpl: async (input) => {
        expect(String(input)).toBe(
          "https://spire-codex.com/static/images/cards/mad_science_attack.webp",
        );
        return imageResponse(portraitBytes);
      },
    });

    await renderer.render(card("MAD_SCIENCE"), false, basePath);
    await renderer.render(card("MAD_SCIENCE"), true, upgradedPath);

    const [baseBytes, upgradedBytes] = await Promise.all([
      readFile(basePath),
      readFile(upgradedPath),
    ]);
    await expect(sharp(baseBytes).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 400,
      height: 520,
    });
    await expect(sharp(upgradedBytes).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 400,
      height: 520,
    });
    expect(createHash("sha256").update(upgradedBytes).digest("hex")).not.toBe(
      createHash("sha256").update(baseBytes).digest("hex"),
    );
  });

  it("closes Chromium when portrait decoding fails after launch", async () => {
    const outputDir = await createOutputDirectory();
    let launchedBrowser: Browser | undefined;
    const renderer = new FallbackRenderer({
      fetchImpl: async () => imageResponse(Buffer.from("not an image")),
      launchImpl: async () => {
        launchedBrowser = await chromium.launch({ headless: true });
        return launchedBrowser;
      },
    });

    await expect(renderer.render(
      card("MAD_SCIENCE"),
      false,
      join(outputDir, "broken.webp"),
    )).rejects.toThrow(/portrait/i);
    expect(launchedBrowser).toBeDefined();
    expect(launchedBrowser?.isConnected()).toBe(false);
  });
});
