import { createHash } from "node:crypto";
import { RawSpireCardsSchema, type RawSpireCard } from "./schema.js";

export interface FetchedCards {
  cards: RawSpireCard[];
  rawBody: string;
  sourceRevision: string;
  lastModified: string | null;
  fetchedAt: string;
}

export interface SpireCodexRequestErrorContext {
  url: string;
  status: number | null;
  retryAfter: string | null;
  rateLimitRemaining: string | null;
}

export class SpireCodexRequestError extends Error {
  constructor(
    message: string,
    readonly context: SpireCodexRequestErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SpireCodexRequestError";
  }
}

export interface SpireCodexClientOptions {
  baseUrl: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SpireCodexClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly cardsUrl: string;

  constructor(options: SpireCodexClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.cardsUrl = new URL("/api/cards?lang=eng", options.baseUrl).toString();
  }

  async fetchCards(): Promise<FetchedCards> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.cardsUrl, {
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (cause) {
      throw new SpireCodexRequestError("Spire Codex request failed", this.context(), { cause });
    }

    const context = this.context(response);
    if (!response.ok) {
      throw new SpireCodexRequestError(
        `Spire Codex request failed with HTTP ${response.status}`,
        context,
      );
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch {
      throw new SpireCodexRequestError("Spire Codex response body could not be read", context);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new SpireCodexRequestError("Spire Codex returned invalid JSON", context);
    }

    const validated = RawSpireCardsSchema.safeParse(parsed);
    if (!validated.success) {
      throw new SpireCodexRequestError("Spire Codex returned an invalid cards response", context, {
        cause: validated.error,
      });
    }

    return {
      cards: validated.data,
      rawBody,
      sourceRevision: createHash("sha256").update(rawBody, "utf8").digest("hex"),
      lastModified: response.headers.get("last-modified"),
      fetchedAt: new Date().toISOString(),
    };
  }

  private context(response?: Response): SpireCodexRequestErrorContext {
    return {
      url: this.cardsUrl,
      status: response?.status ?? null,
      retryAfter: response?.headers.get("retry-after") ?? null,
      rateLimitRemaining: response?.headers.get("x-ratelimit-remaining") ?? null,
    };
  }
}
