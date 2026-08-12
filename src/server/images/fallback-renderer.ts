import { mkdir, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import sharp from "sharp";
import type { RawSpireCard } from "../spire-codex/schema.js";
import { buildRendererConfig } from "./renderer-adapter.js";
import { fetchImageWithRetry, ImageFetchRejectedError } from "./fetch-image.js";

const VENDOR_ROOT = fileURLToPath(new URL("../../../vendor/card-renderer/", import.meta.url));
const ASSET_ROOT = resolve(VENDOR_ROOT, "assets");
const FONT_ROOT = resolve(VENDOR_ROOT, "fonts");
const RENDERER_PATH = resolve(VENDOR_ROOT, "renderer.js");
const ASSET_BASE_URL = "https://stsdle.local/assets/";
const FONT_BASE_URL = "https://stsdle.local/fonts/";
const PORTRAIT_URL = "https://stsdle.local/portrait.webp";
const DEFAULT_PORTRAIT_BASE_URL = "https://spire-codex.com/";

export interface FallbackRendererOptions {
  fetchImpl?: typeof fetch;
  launchImpl?: () => Promise<Browser>;
  portraitBaseUrl?: string;
  allowedPortraitOrigins?: readonly string[];
  requestTimeoutMs?: number;
}

export interface FallbackRenderRequest {
  raw: RawSpireCard;
  upgraded: boolean;
  destination: string;
}

export class FallbackRenderer {
  readonly #fetchImpl: typeof fetch;
  readonly #launchImpl: () => Promise<Browser>;
  readonly #portraitBaseUrl: URL;
  readonly #allowedPortraitOrigins: ReadonlySet<string>;
  readonly #requestTimeoutMs: number;

  constructor(options: FallbackRendererOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#launchImpl = options.launchImpl ?? (() => chromium.launch({ headless: true }));
    this.#portraitBaseUrl = parsePortraitBaseUrl(
      options.portraitBaseUrl ?? DEFAULT_PORTRAIT_BASE_URL,
    );
    this.#allowedPortraitOrigins = new Set([
      this.#portraitBaseUrl.origin,
      ...(options.allowedPortraitOrigins ?? []).map(parseAllowedPortraitOrigin),
    ]);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async render(raw: RawSpireCard, upgraded: boolean, destination: string): Promise<void> {
    await this.renderBatch([{ raw, upgraded, destination }]);
  }

  async renderBatch(requests: readonly FallbackRenderRequest[]): Promise<void> {
    if (requests.length === 0) return;
    const prepared = [] as Array<{
      request: FallbackRenderRequest;
      config: ReturnType<typeof buildRendererConfig>;
      portraitBytes: Buffer;
      portraitContentType: string;
      localPortraitUrl: string;
    }>;
    for (const [index, request] of requests.entries()) {
      const config = buildRendererConfig(request.raw, request.upgraded);
      const portraitUrl = validatePortraitUrl(
        config.portrait_url,
        request.raw.id,
        this.#portraitBaseUrl,
        this.#allowedPortraitOrigins,
      );
      const portrait = await fetchImageWithRetry({
        url: portraitUrl,
        fetchImpl: this.#fetchImpl,
        requestTimeoutMs: this.#requestTimeoutMs,
        redirect: "manual",
        validateResponse(response) {
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400) ||
            (response.url !== "" && response.url !== portraitUrl)
          ) {
            throw new ImageFetchRejectedError(
              new Error(`Portrait redirects are not allowed for card ${request.raw.id}`),
            );
          }
        },
        httpError: (status) => new Error(
          `Failed to fetch portrait for card ${request.raw.id}: HTTP ${status}`,
        ),
        emptyError: () => new Error(`Empty portrait for card ${request.raw.id}`),
        networkError: () => new Error(`Failed to fetch portrait for card ${request.raw.id}`),
      });
      prepared.push({
        request,
        config,
        portraitBytes: portrait.bytes,
        portraitContentType: portrait.contentType ?? "image/webp",
        localPortraitUrl: `${PORTRAIT_URL}?render=${index}`,
      });
    }
    const rendererScript = await readFile(RENDERER_PATH, "utf8");

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      browser = await this.#launchImpl();
      context = await browser.newContext();
      page = await context.newPage();
      await page.route(`${ASSET_BASE_URL}**`, async (route) => fulfillVendorFile(
        route,
        ASSET_ROOT,
        "/assets/",
        "image/png",
      ));
      await page.route(`${FONT_BASE_URL}**`, async (route) => fulfillVendorFile(
        route,
        FONT_ROOT,
        "/fonts/",
        "font/ttf",
      ));
      const portraits = new Map(prepared.map((item) => [item.localPortraitUrl, item]));
      await page.route(`${PORTRAIT_URL}**`, async (route) => {
        const portrait = portraits.get(route.request().url());
        if (!portrait) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.fulfill({
          body: portrait.portraitBytes,
          contentType: portrait.portraitContentType,
          status: 200,
        });
      });
      await page.route("https://stsdle.local/", async (route) => route.fulfill({
        body: "<!doctype html><html></html>",
        contentType: "text/html",
        status: 200,
      }));

      await page.goto("https://stsdle.local/");
      await page.setContent(rendererDocument(rendererScript));
      await page.evaluate(async () => {
        const renderer = window.cardRender?.renderer;
        if (!renderer) throw new Error("Vendored card renderer did not load");
        await renderer.preload();
      });
      for (const item of prepared) {
        const pngDataUrl = await page.evaluate(async ({ rendererConfig, portraitUrl }) => {
          const portrait = new Image();
          portrait.decoding = "async";
          await new Promise<void>((resolveImage, rejectImage) => {
            portrait.onload = () => resolveImage();
            portrait.onerror = () => rejectImage(new Error("Failed to decode card portrait"));
            portrait.src = portraitUrl;
          });
          const renderer = window.cardRender?.renderer;
          if (!renderer) throw new Error("Vendored card renderer did not load");
          const canvas = renderer.renderCard({
            ...rendererConfig,
            portrait_image: portrait,
          });
          const dataUrl = canvas.toDataURL("image/png");
          canvas.remove();
          return dataUrl;
        }, { rendererConfig: item.config, portraitUrl: item.localPortraitUrl });

        const prefix = "data:image/png;base64,";
        if (!pngDataUrl.startsWith(prefix)) {
          throw new Error(`Card renderer returned invalid PNG data for card ${item.request.raw.id}`);
        }
        const pngBytes = Buffer.from(pngDataUrl.slice(prefix.length), "base64");
        await mkdir(dirname(item.request.destination), { recursive: true });
        await sharp(pngBytes)
          .resize(400, 520, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp()
          .toFile(item.request.destination);
      }
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }
}

function parsePortraitBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Portrait source configuration is invalid");
  }
  if (!isSafePortraitUrl(url) || url.hash) {
    throw new Error("Portrait source configuration is invalid");
  }
  return url;
}

function parseAllowedPortraitOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Allowed portrait origin configuration is invalid");
  }
  if (
    !isSafePortraitUrl(url) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Allowed portrait origin configuration is invalid");
  }
  return url.origin;
}

function validatePortraitUrl(
  value: string,
  cardId: string,
  baseUrl: URL,
  allowedOrigins: ReadonlySet<string>,
): string {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new Error(`Portrait source is not allowed for card ${cardId}`);
  }
  if (!isSafePortraitUrl(url) || url.hash || !allowedOrigins.has(url.origin)) {
    throw new Error(`Portrait source is not allowed for card ${cardId}`);
  }
  return url.toString();
}

function isSafePortraitUrl(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return false;
  }
  let hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  return (
    isIP(hostname) === 0 &&
    hostname.includes(".") &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local")
  );
}

async function fulfillVendorFile(
  route: Route,
  root: string,
  urlPrefix: string,
  contentType: string,
): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  const relativePath = decodeURIComponent(pathname.slice(urlPrefix.length));
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    await route.abort("blockedbyclient");
    return;
  }
  await route.fulfill({ path: filePath, contentType });
}

function rendererDocument(rendererScript: string): string {
  const safeRendererScript = rendererScript.replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @font-face {
        font-family: "STS Card Name";
        src: url("${FONT_BASE_URL}kreon_bold.ttf") format("truetype");
        font-style: normal;
        font-weight: 700;
      }
      @font-face {
        font-family: "Kreon";
        src: url("${FONT_BASE_URL}kreon_regular.ttf") format("truetype");
        font-style: normal;
        font-weight: 400;
      }
      html, body { margin: 0; background: transparent; }
    </style>
    <script>globalThis.STSDLE_CARD_ASSET_BASE = ${JSON.stringify(ASSET_BASE_URL)};</script>
    <script>${safeRendererScript}</script>
  </head>
  <body><div id="canvas-host"></div></body>
</html>`;
}

declare global {
  interface Window {
    cardRender?: {
      renderer?: {
        preload(): Promise<unknown>;
        renderCard(config: Record<string, unknown>): HTMLCanvasElement;
      };
    };
  }
}
