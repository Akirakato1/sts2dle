// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { CardPreviewModal } from "../../src/client/components/CardPreviewModal.js";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";

const vector: FeatureVector = { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Common", target: "Self", powers: [], keywords: [] };
const upgradedCard: CardIdentity = { id: "blur", name: "Blur", hasUpgrade: true, artUrl: "", baseCardUrl: "/snapshots/blur.png", upgradedCardUrl: "/snapshots/blur-plus.png", base: vector, upgraded: vector };
const baseOnlyCard: CardIdentity = { ...upgradedCard, id: "defend", name: "Defend", hasUpgrade: false, baseCardUrl: "/snapshots/defend.png", upgradedCardUrl: null };

afterEach(cleanup);

describe("CardPreviewModal", () => {
  test("names the dialog for its card and focuses Close", () => {
    render(<CardPreviewModal card={upgradedCard} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Preview Blur" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();
  });

  test("traps forward and reverse Tab on its close-only unavailable preview", () => {
    render(<CardPreviewModal card={{ ...baseOnlyCard, baseCardUrl: null }} onClose={() => {}} />);
    const close = screen.getByRole("button", { name: "Close preview" });

    const forward = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(close).toHaveFocus();

    const reverse = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true });
    document.dispatchEvent(reverse);
    expect(reverse.defaultPrevented).toBe(true);
    expect(close).toHaveFocus();
  });

  test("closes for Escape and a true backdrop click but ignores an inside click", () => {
    let closeCount = 0;
    const view = render(<CardPreviewModal card={baseOnlyCard} onClose={() => { closeCount++; }} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(dialog);
    expect(closeCount).toBe(0);
    fireEvent.click(view.container.querySelector(".card-preview-modal__backdrop")!);
    expect(closeCount).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(2);
  });

  test("shows upgraded faces side by side in reserved snapshot geometry", () => {
    render(<CardPreviewModal card={upgradedCard} onClose={() => {}} />);

    expect(screen.getByText("Base")).toBeVisible();
    expect(screen.getByText("Upgraded")).toBeVisible();
    expect(screen.getByRole("region", { name: "Blur — Base card face" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Blur — Upgraded card face" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Blur — Base card artwork" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Blur — Upgraded card artwork" })).toBeVisible();
    for (const face of document.querySelectorAll<HTMLElement>("[data-card-preview-face]")) {
      expect(face).toHaveClass("card-preview-modal__face");
    }
  });

  test("adds the validated class discriminator throughout a duplicate-name preview", () => {
    const duplicateCard: CardIdentity = {
      ...upgradedCard,
      id: "strike-silent",
      name: "Strike",
      duplicateName: true,
    };
    render(<CardPreviewModal card={duplicateCard} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Preview Strike (Silent)" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Preview Strike (Silent)" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Strike (Silent) — Base card face" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Strike (Silent) — Upgraded card face" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Strike (Silent) — Base card artwork" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Strike (Silent) — Upgraded card artwork" })).toBeVisible();
  });

  test("shows a centered Base face when a card has no upgrade", () => {
    const view = render(<CardPreviewModal card={baseOnlyCard} onClose={() => {}} />);

    expect(screen.getByText("Base")).toBeVisible();
    expect(screen.queryByText("Upgraded")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Defend — Base card face" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Defend — Base card artwork" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Defend — Upgraded card face" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".card-preview-modal__faces--single")).not.toBeNull();
  });

  test("keeps each image loading until it succeeds and retries only its failed face", async () => {
    render(<CardPreviewModal card={upgradedCard} onClose={() => {}} />);
    const images = screen.getAllByRole("img") as HTMLImageElement[];
    const base = images[0]!;
    const upgraded = images[1]!;

    expect(screen.getAllByRole("status", { name: /loading/i })).toHaveLength(2);
    fireEvent.load(base);
    await waitFor(() => expect(screen.getAllByRole("status", { name: /loading/i })).toHaveLength(1));
    fireEvent.error(upgraded);
    expect(screen.getByRole("status", { name: "Upgraded image failed to load" })).toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry Upgraded image" });
    retry.focus();
    fireEvent.click(retry, { detail: 0 });

    const afterRetry = screen.getAllByRole("img") as HTMLImageElement[];
    expect(afterRetry[0]).toBe(base);
    expect(afterRetry[1]).not.toBe(upgraded);
    expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();

    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    try {
      outside.focus();
      const recover = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
      document.dispatchEvent(recover);
      expect(recover.defaultPrevented).toBe(true);
      expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();

      fireEvent.error(afterRetry[1]!);
      const repeatedRetry = screen.getByRole("button", { name: "Retry Upgraded image" });
      repeatedRetry.focus();
      fireEvent.click(repeatedRetry, { detail: 0 });
      expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  test("locks both scroll roots and restores their exact prior inline styles", () => {
    const htmlStyle = document.documentElement.getAttribute("style");
    const bodyStyle = document.body.getAttribute("style");
    document.documentElement.setAttribute("style", "color: red; overflow: clip !important;");
    document.body.setAttribute("style", "background: blue; overflow: scroll;");

    try {
      const view = render(<CardPreviewModal card={baseOnlyCard} onClose={() => {}} />);
      expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
      expect(document.body.style.getPropertyValue("overflow")).toBe("hidden");
      view.unmount();
      expect(document.documentElement.getAttribute("style")).toBe("color: red; overflow: clip !important;");
      expect(document.body.getAttribute("style")).toBe("background: blue; overflow: scroll;");
    } finally {
      if (htmlStyle === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", htmlStyle);
      if (bodyStyle === null) document.body.removeAttribute("style");
      else document.body.setAttribute("style", bodyStyle);
    }
  });

  test("reports an unavailable snapshot face without creating an image request", () => {
    const view = render(<CardPreviewModal card={{ ...baseOnlyCard, baseCardUrl: null }} onClose={() => {}} />);

    expect(screen.getByRole("status", { name: "Base image unavailable" })).toBeVisible();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
