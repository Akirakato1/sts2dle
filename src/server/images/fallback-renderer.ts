import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page, type Route } from "playwright";
import sharp from "sharp";
import type { RawSpireCard } from "../spire-codex/schema.js";
import { buildRendererConfig } from "./renderer-adapter.js";

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
}

export class FallbackRenderer {
  readonly #fetchImpl: typeof fetch;
  readonly #launchImpl: () => Promise<Browser>;
  readonly #portraitBaseUrl: string;

  constructor(options: FallbackRendererOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#launchImpl = options.launchImpl ?? (() => chromium.launch({ headless: true }));
    this.#portraitBaseUrl = options.portraitBaseUrl ?? DEFAULT_PORTRAIT_BASE_URL;
  }

  async render(raw: RawSpireCard, upgraded: boolean, destination: string): Promise<void> {
    const config = buildRendererConfig(raw, upgraded);
    const browser = await this.#launchImpl();
    let page: Page | undefined;
    try {
      const portraitUrl = new URL(config.portrait_url, this.#portraitBaseUrl).toString();
      const portraitResponse = await this.#fetchImpl(portraitUrl);
      if (!portraitResponse.ok) {
        throw new Error(
          `Failed to fetch portrait for card ${raw.id}: HTTP ${portraitResponse.status}`,
        );
      }
      const portraitBytes = Buffer.from(await portraitResponse.arrayBuffer());
      if (portraitBytes.length === 0) throw new Error(`Empty portrait for card ${raw.id}`);
      const portraitContentType = portraitResponse.headers.get("content-type") ?? "image/webp";
      const rendererScript = await readFile(RENDERER_PATH, "utf8");

      page = await browser.newPage();
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
      await page.route(PORTRAIT_URL, async (route) => route.fulfill({
        body: portraitBytes,
        contentType: portraitContentType,
        status: 200,
      }));
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
        document.querySelector("#canvas-host")?.append(canvas);
        return canvas.toDataURL("image/png");
      }, { rendererConfig: config, portraitUrl: PORTRAIT_URL });

      const prefix = "data:image/png;base64,";
      if (!pngDataUrl.startsWith(prefix)) {
        throw new Error(`Card renderer returned invalid PNG data for card ${raw.id}`);
      }
      const pngBytes = Buffer.from(pngDataUrl.slice(prefix.length), "base64");
      await mkdir(dirname(destination), { recursive: true });
      await sharp(pngBytes)
        .resize(400, 520, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp()
        .toFile(destination);
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close();
    }
  }
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
