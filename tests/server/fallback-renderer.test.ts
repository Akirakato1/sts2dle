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

function madScienceWithPortrait(imageUrl: string) {
  return { ...card("MAD_SCIENCE"), image_url: imageUrl };
}

function noIoRenderer(): FallbackRenderer {
  return new FallbackRenderer({
    fetchImpl: async () => {
      throw new Error("Unexpected portrait fetch");
    },
    launchImpl: async () => {
      throw new Error("Unexpected browser launch");
    },
  });
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
  it("renders approved relative and absolute Mad Science portraits as distinct WebPs", async () => {
    const outputDir = await createOutputDirectory();
    const basePath = join(outputDir, "mad-science.webp");
    const upgradedPath = join(outputDir, "mad-science-upg.webp");
    const fetchedUrls: string[] = [];
    const renderer = new FallbackRenderer({
      fetchImpl: async (input) => {
        fetchedUrls.push(String(input));
        return imageResponse(portraitBytes);
      },
      allowedPortraitOrigins: ["https://images.spire-codex.test"],
    });

    await renderer.render(card("MAD_SCIENCE"), false, basePath);
    await renderer.render(
      madScienceWithPortrait("https://images.spire-codex.test/cards/mad-science.webp"),
      true,
      upgradedPath,
    );

    const [baseBytes, upgradedBytes] = await Promise.all([
      readFile(basePath),
      readFile(upgradedPath),
    ]);
    expect(fetchedUrls).toEqual([
      "https://spire-codex.com/static/images/cards/mad_science_attack.webp",
      "https://images.spire-codex.test/cards/mad-science.webp",
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

  it.each([
    "https://localhost/card.webp",
    "https://127.0.0.1/latest/meta-data",
  ])("rejects local portrait %s before I/O", async (imageUrl) => {
    await expect(noIoRenderer().render(
      madScienceWithPortrait(imageUrl),
      false,
      join(tmpdir(), "unused-private.webp"),
    )).rejects.toThrow(/portrait source is not allowed.*MAD_SCIENCE/i);
  });

  it("rejects portraits from a disallowed HTTPS origin before I/O", async () => {
    await expect(noIoRenderer().render(
      madScienceWithPortrait("https://images.attacker.example/card.webp"),
      false,
      join(tmpdir(), "unused-origin.webp"),
    )).rejects.toThrow(/portrait source is not allowed.*MAD_SCIENCE/i);
  });

  it("rejects non-HTTPS portraits before I/O", async () => {
    await expect(noIoRenderer().render(
      madScienceWithPortrait("http://spire-codex.com/card.webp"),
      false,
      join(tmpdir(), "unused-http.webp"),
    )).rejects.toThrow(/portrait source is not allowed.*MAD_SCIENCE/i);
  });

  it("rejects credential-bearing portraits without leaking credentials", async () => {
    let message = "";
    try {
      await noIoRenderer().render(
        madScienceWithPortrait("https://api-user:super-secret@spire-codex.com/card.webp"),
        false,
        join(tmpdir(), "unused-credentials.webp"),
      );
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/portrait source is not allowed.*MAD_SCIENCE/i);
    expect(message).not.toContain("api-user");
    expect(message).not.toContain("super-secret");
  });

  it("rejects non-default portrait ports before I/O", async () => {
    await expect(noIoRenderer().render(
      madScienceWithPortrait("https://spire-codex.com:444/card.webp"),
      false,
      join(tmpdir(), "unused-port.webp"),
    )).rejects.toThrow(/portrait source is not allowed.*MAD_SCIENCE/i);
  });

  it("forbids redirects when fetching an approved portrait", async () => {
    const renderer = new FallbackRenderer({
      fetchImpl: async (_input, init) => {
        expect(init?.redirect).toBe("error");
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/latest/meta-data" },
        });
      },
      launchImpl: async () => {
        throw new Error("Unexpected browser launch");
      },
    });

    await expect(renderer.render(
      madScienceWithPortrait("https://spire-codex.com/static/card.webp"),
      false,
      join(tmpdir(), "unused-redirect.webp"),
    )).rejects.toThrow(/portrait redirects are not allowed.*MAD_SCIENCE/i);
  });
});
