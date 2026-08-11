import { isIP } from "node:net";

export function parseAllowedImageOrigins(
  values: readonly string[],
  label: string,
): string[] {
  if (values.length === 0) throw new Error(`${label} origin allowlist must not be empty`);
  return [...new Set(values.map((value) => parseAllowedOrigin(value, label)))].sort();
}

export function assertAllowedImageUrl(
  value: string,
  allowedOrigins: readonly string[],
  label: string,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL is not allowed`);
  }
  if (!isSafePublicHttpsUrl(url)) throw new Error(`${label} URL is not allowed`);
  const allowed = new Set(parseAllowedImageOrigins(allowedOrigins, label));
  if (!allowed.has(url.origin)) throw new Error(`${label} URL is not allowed`);
  return url;
}

function parseAllowedOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} origin is invalid`);
  }
  if (
    !isSafePublicHttpsUrl(url) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} origin is invalid`);
  }
  return url.origin;
}

function isSafePublicHttpsUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return false;
  }
  let hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  return isIP(hostname) === 0 && hostname.includes(".") && hostname !== "localhost" &&
    !hostname.endsWith(".localhost") && !hostname.endsWith(".local") && !hostname.endsWith(".internal");
}
