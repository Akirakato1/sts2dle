import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import { assertAllowedImageUrl, parseAllowedImageOrigins } from "./url-policy.js";
import { fetchImageWithRetry, ImageFetchRejectedError } from "./fetch-image.js";

export interface BuildSpritesOptions {
  cards: readonly CardIdentity[];
  outputDir: string;
  fetchImpl: typeof fetch;
  concurrency: number;
  requestTimeoutMs: number;
  allowedArtworkOrigins: readonly string[];
  transformCellImpl?: TransformCell;
}

export type TransformCell = (source: Buffer, cellSize: 64 | 160) => Promise<Buffer>;

interface AtlasDefinition {
  filename: "candidate.webp" | "guess.webp";
  cellSize: 64 | 160;
  quality: 76 | 82;
}

const ATLAS_DEFINITIONS: readonly AtlasDefinition[] = [
  { filename: "candidate.webp", cellSize: 64, quality: 76 },
  { filename: "guess.webp", cellSize: 160, quality: 82 },
];
const MAX_ATLAS_DIMENSION = 8192;
const MAX_DOWNLOAD_CONCURRENCY = 4;

export async function buildSprites(options: BuildSpritesOptions): Promise<SpriteMap> {
  validateConcurrency(options.concurrency);
  const allowedArtworkOrigins = parseAllowedImageOrigins(
    options.allowedArtworkOrigins,
    "Artwork",
  );
  const cards = [...options.cards].sort(compareCardIds);
  validateCards(cards, allowedArtworkOrigins);
  const columns = Math.ceil(Math.sqrt(cards.length));
  const rows = Math.ceil(cards.length / columns);
  validateAtlasDimensions(columns, rows);
  const artwork = await downloadArtwork(
    cards,
    options.fetchImpl,
    options.concurrency,
    allowedArtworkOrigins,
    options.requestTimeoutMs,
  );
  const spriteMap = createSpriteMap(cards, columns, rows);
  const transformCellImpl = options.transformCellImpl ?? transformCell;
  const encodedAtlases: Array<{ definition: AtlasDefinition; bytes: Buffer }> = [];
  for (const definition of ATLAS_DEFINITIONS) {
    encodedAtlases.push({
      definition,
      bytes: await encodeAtlas(
        definition,
        cards,
        artwork,
        columns,
        rows,
        options.concurrency,
        transformCellImpl,
      ),
    });
  }

  const temporaryPaths = encodedAtlases.map(({ definition }) => join(
    options.outputDir,
    `${definition.filename}.tmp`,
  ));
  const publishedPaths: string[] = [];
  try {
    const writeResults = await Promise.allSettled(encodedAtlases.map(
      ({ bytes }, index) => writeFile(temporaryPaths[index]!, bytes),
    ));
    const failedWrite = writeResults.find((result) => result.status === "rejected");
    if (failedWrite?.status === "rejected") throw failedWrite.reason;
    for (const { definition } of encodedAtlases) {
      const publishedPath = join(options.outputDir, definition.filename);
      await rename(
        join(options.outputDir, `${definition.filename}.tmp`),
        publishedPath,
      );
      publishedPaths.push(publishedPath);
    }
  } catch (error: unknown) {
    await Promise.all([
      ...temporaryPaths.map((path) => rm(path, { force: true })),
      ...publishedPaths.map((path) => rm(path, { force: true })),
    ]);
    throw error;
  }

  return spriteMap;
}

async function downloadArtwork(
  cards: readonly CardIdentity[],
  fetchImpl: typeof fetch,
  concurrency: number,
  allowedArtworkOrigins: readonly string[],
  requestTimeoutMs: number,
): Promise<Map<string, Buffer>> {
  const requests = new Map<string, CardIdentity>();
  for (const card of cards) {
    if (!requests.has(card.artUrl)) requests.set(card.artUrl, card);
  }
  const uniqueArtwork = [...requests.values()];
  const artwork = new Map<string, Buffer>();
  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!stopped && nextIndex < uniqueArtwork.length) {
      const card = uniqueArtwork[nextIndex];
      nextIndex += 1;
      if (!card) return;
      try {
        const { bytes } = await fetchImageWithRetry({
          url: card.artUrl,
          fetchImpl,
          requestTimeoutMs,
          redirect: "manual",
          validateResponse(response) {
            if (
              response.redirected ||
              (response.status >= 300 && response.status < 400) ||
              (response.url !== "" && response.url !== card.artUrl)
            ) {
              throw new ImageFetchRejectedError(
                new Error(`Artwork redirect is not allowed for card ${card.id}`),
              );
            }
            if (response.url !== "") {
              try {
                assertAllowedImageUrl(response.url, allowedArtworkOrigins, `Artwork for card ${card.id}`);
              } catch {
                throw new ImageFetchRejectedError(
                  new Error(`Artwork response URL is not allowed for card ${card.id}`),
                );
              }
            }
          },
          httpError: (status) => new Error(
            `Failed to download artwork for card ${card.id}: HTTP ${status}`,
          ),
          emptyError: () => new Error(`Empty artwork response for card ${card.id}`),
          networkError: () => new Error(`Failed to download artwork for card ${card.id}`),
        });
        try {
          await sharp(bytes).metadata();
        } catch (error: unknown) {
          throw new Error(`Invalid artwork for card ${card.id}`, { cause: error });
        }
        artwork.set(card.artUrl, bytes);
      } catch (error: unknown) {
        if (!stopped) {
          stopped = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, uniqueArtwork.length) },
    async () => worker(),
  ));
  if (stopped) throw firstError;
  return artwork;
}

function compareCardIds(left: CardIdentity, right: CardIdentity): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function validateConcurrency(concurrency: number): void {
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_DOWNLOAD_CONCURRENCY
  ) {
    throw new Error("Artwork concurrency must be an integer from 1 to 4");
  }
}

function validateCards(cards: readonly CardIdentity[], allowedArtworkOrigins: readonly string[]): void {
  if (cards.length === 0) throw new Error("At least one card is required to build sprites");
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (cardIds.has(card.id)) throw new Error(`Duplicate card ID: ${card.id}`);
    cardIds.add(card.id);
    if (card.artUrl.trim().length === 0) {
      throw new Error(`Missing artwork URL for card ${card.id}`);
    }
    assertAllowedImageUrl(card.artUrl, allowedArtworkOrigins, `Artwork for card ${card.id}`);
  }
}

function validateAtlasDimensions(columns: number, rows: number): void {
  for (const definition of ATLAS_DEFINITIONS) {
    const width = columns * definition.cellSize;
    const height = rows * definition.cellSize;
    if (width > MAX_ATLAS_DIMENSION || height > MAX_ATLAS_DIMENSION) {
      throw new Error(
        `${definition.filename} atlas dimension ${width}x${height} exceeds ${MAX_ATLAS_DIMENSION} pixels`,
      );
    }
  }
}

function createSpriteMap(
  cards: readonly CardIdentity[],
  columns: number,
  rows: number,
): SpriteMap {
  const cardMap = Object.create(null) as SpriteMap["cards"];
  for (const [index, card] of cards.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cardMap[card.id] = {
      candidate: { x: column * 64, y: row * 64, width: 64, height: 64 },
      guess: { x: column * 160, y: row * 160, width: 160, height: 160 },
    };
  }
  return {
    candidate: {
      url: "/runtime/candidate.webp",
      width: columns * 64,
      height: rows * 64,
      displayScale: 0.5,
    },
    guess: {
      url: "/runtime/guess.webp",
      width: columns * 160,
      height: rows * 160,
      displayScale: 0.5,
    },
    cards: cardMap,
  };
}

async function encodeAtlas(
  definition: AtlasDefinition,
  cards: readonly CardIdentity[],
  artwork: ReadonlyMap<string, Buffer>,
  columns: number,
  rows: number,
  concurrency: number,
  transformCellImpl: TransformCell,
): Promise<Buffer> {
  const cells: Array<{ input: Buffer; left: number; top: number } | undefined> = new Array(
    cards.length,
  );
  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!stopped && nextIndex < cards.length) {
      const index = nextIndex;
      nextIndex += 1;
      const card = cards[index];
      if (!card) return;
      try {
        cells[index] = {
          input: await transformCellImpl(artwork.get(card.artUrl)!, definition.cellSize),
          left: (index % columns) * definition.cellSize,
          top: Math.floor(index / columns) * definition.cellSize,
        };
      } catch (error: unknown) {
        if (!stopped) {
          stopped = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, cards.length) },
    async () => worker(),
  ));
  if (stopped) throw firstError;
  const completedCells = cells.map((cell) => {
    if (!cell) throw new Error("Sprite cell transform did not complete");
    return cell;
  });

  return sharp({
    create: {
      width: columns * definition.cellSize,
      height: rows * definition.cellSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(completedCells).webp({ quality: definition.quality }).toBuffer();
}

async function transformCell(source: Buffer, cellSize: 64 | 160): Promise<Buffer> {
  return sharp(source)
    .resize(cellSize, cellSize, { fit: "cover", position: "centre" })
    .webp({ quality: cellSize === 64 ? 76 : 82 })
    .toBuffer();
}
