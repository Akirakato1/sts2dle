export interface RandomSource {
  nextUint32(): number;
}

export function nextIndex(source: RandomSource, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError("maxExclusive must be a positive integer");
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  let value: number;
  do value = source.nextUint32() >>> 0;
  while (value >= limit);
  return value % maxExclusive;
}

export async function createDailyRandom(date: string, revision: string): Promise<RandomSource> {
  const seed = new TextEncoder().encode(["stsdle", "v1", date, revision].join(":"));
  const digest = await crypto.subtle.digest("SHA-256", seed);
  const words = new DataView(digest);
  let a = words.getUint32(0, false);
  let b = words.getUint32(4, false);
  let c = words.getUint32(8, false);
  let d = words.getUint32(12, false);
  return {
    nextUint32() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      const t = (a + b + d) >>> 0;
      d = (d + 1) >>> 0;
      a = (b ^ (b >>> 9)) >>> 0;
      b = (c + (c << 3)) >>> 0;
      c = ((c << 21) | (c >>> 11)) >>> 0;
      c = (c + t) >>> 0;
      return t;
    },
  };
}

export function createPracticeRandom(): RandomSource {
  return {
    nextUint32() {
      return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    },
  };
}
