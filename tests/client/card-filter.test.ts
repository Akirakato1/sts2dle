import { describe, expect, it } from "vitest";

import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import {
  KEYWORD_FILTER_NONE,
  POWER_FILTER_NONE,
  classifyCardCandidate,
  collectCardFilterOptions,
  createDefaultCardFilter,
  updateCardFilterGroupDisabled,
  updateCardFilterGroupValue,
  validCardFilter,
  type CardFilterState,
} from "../../src/client/game/card-filter.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 0, rarity: "Basic",
  target: "Self", powers: [], keywords: [],
};

function card(id: string, baseChanges: Partial<FeatureVector> = {}, upgradedChanges: Partial<FeatureVector> = {}): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base: { ...vector, ...baseChanges }, upgraded: { ...vector, ...upgradedChanges },
  };
}

describe("card filter defaults and snapshot options", () => {
  it("creates an independent all-disabled default filter", () => {
    expect(createDefaultCardFilter()).toEqual({
      cardClass: { disabled: true, selected: [] }, cardType: { disabled: true, selected: [] },
      mana: { disabled: true, selected: [] }, rarity: { disabled: true, selected: [] },
      target: { disabled: true, selected: [] }, powers: { disabled: true, selected: [] },
      keywords: { disabled: true, selected: [] },
    });
    const first = createDefaultCardFilter();
    first.powers.selected.push("Strength");
    expect(createDefaultCardFilter().powers.selected).toEqual([]);
  });

  it("collects only present base and upgraded values in canonical snapshot order", () => {
    const cards = [
      card("first", { mana: 2, rarity: "Rare", target: "AllEnemies", powers: ["Dexterity", "Strength", "Unique Buff"], keywords: ["Exhaust", "Retain"] }, { mana: "X", cardClass: "Silent", cardType: "Skill", target: "AnyEnemy", powers: ["Strength"], keywords: ["Eternal"] }),
      card("second", { mana: 0, cardType: "Skill", target: "Self", powers: ["Artifact"], keywords: ["Retain"] }, { mana: "None", rarity: "Basic", target: "None", powers: [], keywords: [] }),
    ];
    expect(collectCardFilterOptions(cards)).toEqual({
      cardClass: ["Ironclad", "Silent"], cardType: ["Attack", "Skill"], mana: [0, 2, "X", "None"],
      rarity: ["Basic", "Rare"], target: ["Self", "AnyEnemy", "AllEnemies", "None"],
      powers: ["Artifact", "Dexterity", "Strength", "Unique Buff", POWER_FILTER_NONE],
      keywords: ["Eternal", "Exhaust", "Retain", KEYWORD_FILTER_NONE],
    });
  });
});

describe("card filter form classification", () => {
  const bothCard = card("both", { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] });
  const baseCard = card("base", { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { mana: 3, target: "Self", powers: [], keywords: [] });
  const upgradeCard = card("upgrade", { mana: 3, target: "Self", powers: [], keywords: [] }, { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] });
  const hiddenCard = card("hidden", { mana: 3, target: "Self", powers: [], keywords: [] }, { mana: 4, target: "Self", powers: [], keywords: [] });
  function activeFilter() { const filter = createDefaultCardFilter(); filter.target = { disabled: false, selected: ["Self", "AnyEnemy"] }; filter.powers = { disabled: false, selected: ["Strength", "Dexterity"] }; filter.keywords = { disabled: false, selected: ["Exhaust", "Unplayable"] }; return filter; }

  it("reports which complete card form matches scalar and set groups", () => {
    const filter = activeFilter();
    expect(classifyCardCandidate(bothCard, filter)).toBe("both");
    expect(classifyCardCandidate(baseCard, filter)).toBe("base-only");
    expect(classifyCardCandidate(upgradeCard, filter)).toBe("upgrade-only");
    expect(classifyCardCandidate(hiddenCard, filter)).toBeNull();
  });
  it("uses OR within scalar groups and AND across enabled groups", () => {
    const filter = createDefaultCardFilter(); filter.mana = { disabled: false, selected: [2, 3] }; filter.rarity = { disabled: false, selected: ["Rare"] };
    expect(classifyCardCandidate(card("either-mana", { mana: 2, rarity: "Rare" }, { mana: 3, rarity: "Rare" }), filter)).toBe("both");
    expect(classifyCardCandidate(card("wrong-rarity", { mana: 2, rarity: "Basic" }, { mana: 3, rarity: "Basic" }), filter)).toBeNull();
  });
  it("requires every selected power and keyword on the same form", () => {
    const filter = createDefaultCardFilter(); filter.powers = { disabled: false, selected: ["Strength", "Dexterity"] }; filter.keywords = { disabled: false, selected: ["Exhaust", "Unplayable"] };
    expect(classifyCardCandidate(card("all-sets", { powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }), filter)).toBe("both");
    expect(classifyCardCandidate(card("split-sets", { powers: ["Strength", "Dexterity"], keywords: ["Exhaust"] }), filter)).toBeNull();
  });
  it("matches each None sentinel only when a complete form has an empty corresponding set", () => {
    const powersNone = createDefaultCardFilter(); powersNone.powers = { disabled: false, selected: [POWER_FILTER_NONE] };
    expect(classifyCardCandidate(card("power-free"), powersNone)).toBe("both");
    expect(classifyCardCandidate(card("gains-power", {}, { powers: ["Strength"] }), powersNone)).toBe("base-only");
    const keywordsNone = createDefaultCardFilter(); keywordsNone.keywords = { disabled: false, selected: [KEYWORD_FILTER_NONE] };
    expect(classifyCardCandidate(card("keyword-free"), keywordsNone)).toBe("both");
    expect(classifyCardCandidate(card("gains-keyword", {}, { keywords: ["Innate"] }), keywordsNone)).toBe("base-only");
  });
  it("treats disabled groups as passing and enabled empty groups as failing", () => {
    expect(classifyCardCandidate(hiddenCard, createDefaultCardFilter())).toBe("both");
    const empty = createDefaultCardFilter(); empty.target = { disabled: false, selected: [] };
    expect(classifyCardCandidate(hiddenCard, empty)).toBeNull();
  });
  it("does not combine matching values from different forms", () => {
    const filter = createDefaultCardFilter(); filter.target = { disabled: false, selected: ["AnyEnemy"] }; filter.keywords = { disabled: false, selected: ["Retain"] };
    expect(classifyCardCandidate(card("split", { target: "AnyEnemy", keywords: [] }, { target: "Self", keywords: ["Retain"] }), filter)).toBeNull();
  });
});

describe("card filter immutable updates and validation", () => {
  it("updates group disabled state and values immutably", () => {
    const filter = createDefaultCardFilter(); filter.powers.selected = ["Strength"];
    const updated = updateCardFilterGroupDisabled(filter, "powers", false);
    const selected = updateCardFilterGroupValue(updated, "mana", 2, true);
    const duplicate = updateCardFilterGroupValue(selected, "mana", 2, true);
    const removed = updateCardFilterGroupValue(duplicate, "mana", 2, false);
    expect(updated).toEqual({ ...filter, powers: { disabled: false, selected: ["Strength"] } });
    expect(updated).not.toBe(filter); expect(duplicate).toBe(selected); expect(removed.mana.selected).toEqual([]);
  });
  it("keeps None mutually exclusive and rejects a value from another group", () => {
    const filter = createDefaultCardFilter(); filter.powers = { disabled: false, selected: ["Strength"] }; filter.keywords = { disabled: false, selected: ["Retain"] };
    const noPowers = updateCardFilterGroupValue(filter, "powers", POWER_FILTER_NONE, true);
    const noKeywords = updateCardFilterGroupValue(noPowers, "keywords", KEYWORD_FILTER_NONE, true);
    const strength = updateCardFilterGroupValue(noKeywords, "powers", "Strength", true);
    expect(noPowers.powers.selected).toEqual([POWER_FILTER_NONE]); expect(strength.powers.selected).toEqual(["Strength"]);
    expect(strength.keywords.selected).toEqual([KEYWORD_FILTER_NONE]);
    expect(updateCardFilterGroupValue(filter, "powers", "Rare", true)).toBe(filter);
  });
  it("validates every group only against the supplied snapshot options", () => {
    const options = collectCardFilterOptions([card("options", { cardClass: "Silent", cardType: "Skill", mana: 2, rarity: "Rare", target: "AnyEnemy", powers: ["Strength"], keywords: ["Retain"] })]);
    const valid: CardFilterState = { ...createDefaultCardFilter(), cardClass: { disabled: false, selected: ["Silent"] }, cardType: { disabled: false, selected: ["Skill"] }, mana: { disabled: false, selected: [2] }, rarity: { disabled: false, selected: ["Rare"] }, target: { disabled: false, selected: ["AnyEnemy"] }, powers: { disabled: false, selected: ["Strength"] }, keywords: { disabled: false, selected: ["Retain"] } };
    expect(validCardFilter(valid, options)).toBe(true);
    for (const group of ["cardClass", "cardType", "mana", "rarity", "target", "powers", "keywords"] as const) {
      expect(validCardFilter({ ...valid, [group]: { disabled: false, selected: ["unknown"] } } as typeof valid, options)).toBe(false);
    }
    expect(validCardFilter({ ...valid, powers: { disabled: false, selected: [POWER_FILTER_NONE, "Strength"] } }, options)).toBe(false);
    expect(validCardFilter({ ...valid, keywords: { disabled: false, selected: [KEYWORD_FILTER_NONE, "Retain"] } }, options)).toBe(false);
  });
});
