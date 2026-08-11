import fixture from "../fixtures/spire-cards.json";
import { describe, expect, it } from "vitest";
import { buildRendererConfig } from "../../src/server/images/renderer-adapter.js";
import { RawSpireCardsSchema } from "../../src/server/spire-codex/schema.js";

const cards = RawSpireCardsSchema.parse(fixture);

function card(id: string) {
  const result = cards.find((entry) => entry.id === id);
  if (!result) throw new Error(`Fixture card not found: ${id}`);
  return result;
}

describe("buildRendererConfig", () => {
  it("renders base Alchemize with cost 1 and an Exhaust line", () => {
    expect(buildRendererConfig(card("ALCHEMIZE"), false)).toEqual({
      card_name: "Alchemize",
      description: "Create a potion.\nExhaust.",
      card_type: "skill",
      character: "colorless",
      rarity: "rare",
      cost: "1",
      star_cost: null,
      upgraded: false,
      cost_green: false,
      portrait_url: "/static/images/cards/alchemize.webp",
    });
  });

  it("uses Alchemize's upgraded cost", () => {
    expect(buildRendererConfig(card("ALCHEMIZE"), true).cost).toBe("0");
  });

  it("prepends Innate for upgraded Afterimage without upgrade text", () => {
    expect(buildRendererConfig(card("AFTERIMAGE"), true).description).toBe(
      "Innate.\nWhenever you play a card, gain 1 Block.",
    );
  });

  it("uses the hosted upgraded description when one is present", () => {
    expect(buildRendererConfig(card("MALAISE"), true).description).toBe(
      "Apply X+1 Weak.\nExhaust.",
    );
  });

  it("removes Ethereal from upgraded Apparition", () => {
    expect(buildRendererConfig(card("APPARITION"), true).description).toBe(
      "Gain 1 Intangible.\nExhaust.",
    );
  });

  it("uses Mad Science's canonical Attack and Event variant", () => {
    expect(buildRendererConfig(card("MAD_SCIENCE"), false)).toMatchObject({
      card_type: "attack",
      character: "event",
      rarity: "event",
      description: "Deal 12 damage.",
    });
  });
});
