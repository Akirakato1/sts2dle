export interface NameHintCharacter {
  value: string;
  revealed: boolean;
  position: number;
}

export interface NameHintWord {
  characters: NameHintCharacter[];
  length: number;
}

export interface NameHintView {
  words: NameHintWord[];
  complete: boolean;
}

interface NamePosition {
  wordIndex: number;
  characterIndex: number;
}

function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = fnv1a(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function shuffledPositions(positions: NamePosition[], seed: string): NamePosition[] {
  const shuffled = [...positions];
  const nextUint32 = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = nextUint32() % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function deriveNameHint(name: string, wrongGuessCount: number, seed: string): NameHintView | null {
  if (wrongGuessCount < 5) return null;

  const words = [...name.matchAll(/[^ ]+/gu)].map((match) => Array.from(match[0]));
  const initialRevealCount = Math.min(words.length, Math.max(0, wrongGuessCount - 6));
  const randomRevealCount = Math.max(0, wrongGuessCount - (6 + words.length));
  const revealed = new Set<string>();
  const remaining: NamePosition[] = [];

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const characters = words[wordIndex]!;
    if (wordIndex < initialRevealCount) revealed.add(`${wordIndex}:0`);
    for (let characterIndex = 1; characterIndex < characters.length; characterIndex += 1) {
      remaining.push({ wordIndex, characterIndex });
    }
  }

  for (const position of shuffledPositions(remaining, `${seed}\u0000${name}`).slice(0, randomRevealCount)) {
    revealed.add(`${position.wordIndex}:${position.characterIndex}`);
  }

  const hintWords = words.map((characters, wordIndex) => ({
    characters: characters.map((value, position) => ({
      value,
      position,
      revealed: revealed.has(`${wordIndex}:${position}`),
    })),
    length: characters.length,
  }));
  const complete = hintWords.every((word) => word.characters.every((character) => character.revealed));

  return { words: hintWords, complete };
}
