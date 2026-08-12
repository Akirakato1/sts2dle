import React from "react";
import { createRoot } from "react-dom/client";

import {
  OrbInteractionProvider,
  useOrbInteraction,
  type OrbTargetDescriptor,
} from "../../../src/client/components/OrbInteractionContext.js";
import { OrbTray } from "../../../src/client/components/OrbTray.js";
import type { AssistanceState } from "../../../src/client/game/assistance.js";
import "../../../src/client/styles/assistance.css";

declare global {
  interface Window {
    orbHarness: { lostCaptures: number; uses: number };
  }
}

const assistance: AssistanceState = {
  reveal: null,
  filter: null,
  negation: null,
  visibility: { neutral: true, green: true, red: true },
};

const greenTarget: OrbTargetDescriptor = {
  kind: "tile",
  guessIndex: 0,
  cardId: "green-card",
  feature: "mana",
  color: "green",
  revealed: true,
};

window.orbHarness = { lostCaptures: 0, uses: 0 };
document.addEventListener("lostpointercapture", () => {
  window.orbHarness.lostCaptures += 1;
}, true);

function GreenTarget() {
  const binding = useOrbInteraction().bindTarget(greenTarget, ["filter"], "Green mana tile");
  return <div
    {...binding.targetProps}
    className="orb-harness-target"
    data-active={binding.active}
    data-valid={binding.valid}
  >Green mana tile</div>;
}

function Harness() {
  return <OrbInteractionProvider
    assistance={assistance}
    disabled={false}
    onUse={() => {
      window.orbHarness.uses += 1;
      return { accepted: true, announcement: "Filter consumed." };
    }}
    roundKey="browser-round"
  >
    <OrbTray assistance={assistance} disabled={false} />
    <GreenTarget />
  </OrbInteractionProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing harness root");
createRoot(root).render(<Harness />);
