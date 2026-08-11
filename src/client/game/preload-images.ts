import type { CardIdentity } from "../../shared/domain.js";
import type { SelectedAnswer } from "../../shared/selection.js";

export async function preloadAnswerImages(answer: SelectedAnswer, cardsById: ReadonlyMap<string, CardIdentity>): Promise<void> {
  const urls = answer.acceptedCardIds.flatMap((id) => {
    const card = cardsById.get(id);
    return card ? [card.baseCardUrl, card.upgradedCardUrl].filter((url): url is string => url !== null) : [];
  });
  await Promise.allSettled(urls.map(async (url) => {
    const image = new Image();
    image.src = url;
    if (typeof image.decode === "function") await image.decode();
  }));
}
