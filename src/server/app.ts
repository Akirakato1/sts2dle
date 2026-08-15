import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerConfig } from "./config.js";

export interface CreateAppOptions {
  snapshotRoot: string;
  clientRoot?: string;
  config?: ServerConfig;
  logger?: boolean;
}

interface HealthManifest {
  sourceRevision: string;
  generatedAt: string;
}

const MAX_PATH_DECODE_PASSES = 4;

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const snapshotRoot = resolve(options.snapshotRoot);
  const clientRoot = resolve(options.clientRoot ?? "dist/client");
  const indexPath = join(clientRoot, "index.html");
  const health = await readHealthManifest(join(snapshotRoot, "manifest.json"));
  const app = Fastify({ logger: options.logger ?? true });

  app.addHook("onRequest", async (request, reply) => {
    if (hasUnsafeStaticPath(request.raw.url ?? request.url)) {
      return reply.code(404).type("application/json").send({ error: "Not Found" });
    }
    if (isRuntimeJsonPath(request.raw.url ?? request.url)) {
      delete request.headers["if-none-match"];
      delete request.headers["if-modified-since"];
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (isRuntimeJsonPath(request.raw.url ?? request.url)) {
      reply.header("Cache-Control", "no-store");
      reply.removeHeader("etag");
      reply.removeHeader("last-modified");
    }
    return payload;
  });

  await app.register(fastifyStatic, {
    root: snapshotRoot,
    prefix: "/runtime/",
  });
  await app.register(fastifyStatic, {
    root: clientRoot,
    prefix: "/",
    decorateReply: false,
  });

  app.get("/health", async () => health);
  app.setNotFoundHandler(async (request, reply) => {
    if (isRuntimeNamespace(request.url)) {
      return reply.code(404).type("application/json").send({ error: "Not Found" });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.code(404).type("application/json").send({ error: "Not Found" });
    }
    const index = await readFile(indexPath);
    return reply.type("text/html; charset=utf-8").send(index);
  });

  await app.ready();
  return app;
}

function hasUnsafeStaticPath(rawUrl: string): boolean {
  const pathname = rawUrl.split("?", 1)[0] ?? rawUrl;
  const decoded = decodePathLayers(pathname);
  if (!decoded.complete) return true;
  return decoded.layers.some((layer) => (
    layer.includes("\\") ||
    layer.includes("//") ||
    /%2f|%5c/i.test(layer) ||
    layer.split("/").some((segment) => segment.startsWith("."))
  ));
}

function isRuntimeNamespace(rawUrl: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://stsdle.invalid").pathname;
  } catch {
    return rawUrl === "/runtime" || rawUrl.startsWith("/runtime/") || rawUrl.startsWith("/runtime%");
  }
  const decoded = decodePathLayers(pathname);
  if (!decoded.complete) return true;
  return decoded.layers.some((layer) => {
    const normalized = layer.replaceAll("\\", "/");
    return normalized === "/runtime" || normalized.startsWith("/runtime/");
  });
}

function isRuntimeJsonPath(rawUrl: string): boolean {
  const pathname = rawUrl.split("?", 1)[0] ?? rawUrl;
  return pathname.startsWith("/runtime/") && pathname.endsWith(".json");
}

function decodePathLayers(pathname: string): { layers: string[]; complete: boolean } {
  const layers = [pathname];
  let current = pathname;
  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return { layers, complete: true };
      layers.push(decoded);
      current = decoded;
    } catch {
      return { layers, complete: false };
    }
  }
  return { layers, complete: false };
}

async function readHealthManifest(path: string): Promise<HealthManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    typeof parsed !== "object" || parsed === null ||
    !("sourceRevision" in parsed) || typeof parsed.sourceRevision !== "string" ||
    !("generatedAt" in parsed) || typeof parsed.generatedAt !== "string"
  ) {
    throw new Error("Active snapshot manifest is missing health metadata");
  }
  return { sourceRevision: parsed.sourceRevision, generatedAt: parsed.generatedAt };
}
