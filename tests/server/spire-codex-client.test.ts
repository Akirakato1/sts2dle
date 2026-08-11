import { createHash } from "node:crypto";
import fixture from "../fixtures/spire-cards.json";
import { describe, expect, it } from "vitest";
import {
  SpireCodexClient,
  SpireCodexRequestError,
} from "../../src/server/spire-codex/client.js";
import { loadConfig } from "../../src/server/config.js";

describe("SpireCodexClient", () => {
  it("fetches the stable English card endpoint and hashes its exact response body", async () => {
    const rawBody = JSON.stringify(fixture);
    let requestedUrl: string | undefined;
    const client = new SpireCodexClient({
      baseUrl: "https://example.test/",
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(rawBody, {
          headers: { "Last-Modified": "Tue, 11 Aug 2026 15:34:42 GMT" },
        });
      },
    });

    const result = await client.fetchCards();

    expect(requestedUrl).toBe("https://example.test/api/cards?lang=eng");
    expect(result.cards).toHaveLength(fixture.length);
    expect(result.rawBody).toBe(rawBody);
    expect(result.sourceRevision).toBe(
      createHash("sha256").update(rawBody, "utf8").digest("hex"),
    );
    expect(result.lastModified).toBe("Tue, 11 Aug 2026 15:34:42 GMT");
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a response that does not match the card schema", async () => {
    const client = new SpireCodexClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => new Response('[{"id":"missing-fields"}]'),
    });

    await expect(client.fetchCards()).rejects.toThrow("invalid cards response");
  });

  it("includes HTTP and rate-limit context when the server rejects the request", async () => {
    const client = new SpireCodexClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => new Response("not included in errors", {
        status: 429,
        headers: { "retry-after": "60", "x-ratelimit-remaining": "0" },
      }),
    });

    await expect(client.fetchCards()).rejects.toMatchObject({
      context: {
        url: "https://example.test/api/cards?lang=eng",
        status: 429,
        retryAfter: "60",
        rateLimitRemaining: "0",
      },
    } satisfies Partial<SpireCodexRequestError>);
  });

  it("uses the configured timeout signal for the injected fetch", async () => {
    let signal: AbortSignal | undefined;
    const client = new SpireCodexClient({
      baseUrl: "https://example.test",
      requestTimeoutMs: 1,
      fetchImpl: async (_url, init) => {
        signal = init?.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason));
        });
      },
    });

    await expect(client.fetchCards()).rejects.toBeDefined();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps request metadata when the response body stream fails", async () => {
    const client = new SpireCodexClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error("stream body must not leak"));
        },
      }), {
        headers: { "retry-after": "60", "x-ratelimit-remaining": "0" },
      }),
    });

    await expect(client.fetchCards()).rejects.toMatchObject({
      name: "SpireCodexRequestError",
      context: {
        url: "https://example.test/api/cards?lang=eng",
        status: 200,
        retryAfter: "60",
        rateLimitRemaining: "0",
      },
    });
  });

  it("does not retain response content as the cause of invalid JSON", async () => {
    const client = new SpireCodexClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => new Response('{"secret":"response content"'),
    });

    await expect(client.fetchCards()).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({
        name: "SpireCodexRequestError",
        message: "Spire Codex returned invalid JSON",
      });
      expect(error).not.toHaveProperty("cause");
      return true;
    });
  });
});

describe("loadConfig", () => {
  it("uses server defaults and reserves offline startup for an explicit opt-in", () => {
    expect(loadConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      dataDir: "./var",
      spireCodexBaseUrl: "https://spire-codex.com",
      requestTimeoutMs: 30_000,
      artworkConcurrency: 4,
      skipSync: false,
    });
    expect(loadConfig({ STSDLE_SKIP_SYNC: "1" }).skipSync).toBe(true);
    expect(loadConfig({ STSDLE_SKIP_SYNC: "true" }).skipSync).toBe(false);
  });

  it("rejects artwork concurrency above four", () => {
    expect(() => loadConfig({ STSDLE_ARTWORK_CONCURRENCY: "5" })).toThrow(
      "artwork concurrency",
    );
  });
});
