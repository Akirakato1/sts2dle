import { setTimeout as delay } from "node:timers/promises";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 25;

export class ImageFetchRejectedError extends Error {
  constructor(readonly publicError: Error) {
    super(publicError.message);
    this.name = "ImageFetchRejectedError";
  }
}

interface FetchImageOptions {
  url: string;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  redirect: RequestRedirect;
  validateResponse(response: Response): void;
  httpError(status: number): Error;
  emptyError(): Error;
  networkError(): Error;
}

export interface FetchedImage {
  bytes: Buffer;
  contentType: string | null;
}

export async function fetchImageWithRetry(options: FetchImageOptions): Promise<FetchedImage> {
  validateTimeout(options.requestTimeoutMs);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let response: Response | undefined;
    let completed = false;
    let retry = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error("Image request deadline exceeded"));
        reject(new Error("Image request deadline exceeded"));
      }, options.requestTimeoutMs);
    });
    try {
      response = await Promise.race([
        options.fetchImpl(options.url, {
          redirect: options.redirect,
          signal: controller.signal,
        }),
        deadline,
      ]);
      options.validateResponse(response);
      if (!response.ok) {
        if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
          throw new ImageFetchRejectedError(options.httpError(response.status));
        }
        retry = true;
      } else {
        const bytes = Buffer.from(await Promise.race([response.arrayBuffer(), deadline]));
        if (bytes.length === 0) {
          throw new ImageFetchRejectedError(options.emptyError());
        }
        completed = true;
        return { bytes, contentType: response.headers.get("content-type") };
      }
    } catch (error: unknown) {
      if (error instanceof ImageFetchRejectedError) throw error.publicError;
      if (attempt === MAX_ATTEMPTS) throw options.networkError();
      retry = true;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (!completed) {
        if (!controller.signal.aborted) controller.abort();
        // Aborting closes a real fetch immediately; cancellation is advisory and
        // must not let a hostile/stuck stream keep startup alive forever.
        try {
          void response?.body?.cancel().catch(() => undefined);
        } catch {
          // The request already failed and its controller is aborted.
        }
      }
    }
    await delay(RETRY_DELAY_MS * attempt);
  }
  throw options.networkError();
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function validateTimeout(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Image request timeout must be a positive integer");
  }
}
