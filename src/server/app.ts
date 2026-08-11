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

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const snapshotRoot = resolve(options.snapshotRoot);
  const clientRoot = resolve(options.clientRoot ?? "dist/client");
  const indexPath = join(clientRoot, "index.html");
  const health = await readHealthManifest(join(snapshotRoot, "manifest.json"));
  const app = Fastify({ logger: options.logger ?? true });

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
    if (request.url === "/runtime" || request.url.startsWith("/runtime/")) {
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
