import React from "react";

import type { AssistanceState, OrbKind } from "../game/assistance.js";
import { ORB_KINDS } from "../game/assistance.js";
import { useOrbInteraction } from "./OrbInteractionContext.js";
import { ORB_LABELS, OrbVisual } from "./OrbVisual.js";

export interface OrbTrayProps {
  assistance: AssistanceState;
  disabled: boolean;
}

function isAvailable(assistance: AssistanceState, orb: OrbKind) {
  return assistance[orb] === null;
}

export function OrbTray({ assistance, disabled }: OrbTrayProps) {
  const { draggingOrb, getOrbButtonProps, poof } = useOrbInteraction();

  return <section className="orb-tray" aria-label="Orb inventory">
    <div className="orb-tray__slots">
      {ORB_KINDS.map((orb) => {
        const available = isAvailable(assistance, orb);
        const buttonProps = getOrbButtonProps(orb, available);
        const dragging = draggingOrb === orb;

        return <div className="orb-tray__slot" data-orb-slot={orb} key={orb}>
          <div className={`orb-tray__well${dragging ? " orb-tray__well--dragging" : ""}`}>
            {available
              ? <>
                <button
                  {...buttonProps}
                  aria-hidden={dragging || undefined}
                  className={`${buttonProps.className ?? ""}${dragging ? " orb-button--drag-source" : ""}`}
                  disabled={disabled || buttonProps.disabled}
                  style={buttonProps.style}
                  tabIndex={dragging ? -1 : buttonProps.tabIndex}
                >
                  <OrbVisual kind={orb} />
                </button>
                {dragging && <span className="orb-tray__empty" aria-hidden="true" />}
              </>
              : <span className="orb-remnant" aria-label={`${ORB_LABELS[orb]} Orb, used`}>
                <OrbVisual compact kind={orb} />
              </span>}
          </div>
          <span className="orb-tray__label">{ORB_LABELS[orb]}</span>
        </div>;
      })}
    </div>
    {poof && <span
      className={`orb-poof orb-poof--${poof.orb}`}
      data-poof-id={poof.id}
      aria-hidden="true"
      style={{ left: poof.x, top: poof.y }}
    >
      <i className="orb-poof__burst" />
      <i className="orb-poof__particle orb-poof__particle--one" />
      <i className="orb-poof__particle orb-poof__particle--two" />
      <i className="orb-poof__particle orb-poof__particle--three" />
      <i className="orb-poof__particle orb-poof__particle--four" />
    </span>}
  </section>;
}
