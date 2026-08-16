import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import type { CardIdentity } from "../../shared/domain.js";

export interface CardPreviewModalProps {
  card: CardIdentity;
  onClose(): void;
}

type FaceStatus = "loading" | "ready" | "error";

interface CardFaceProps {
  label: "Base" | "Upgraded";
  url: string | null;
}

function CardFace({ label, url }: CardFaceProps): React.JSX.Element {
  const [{ status, attempt }, setFace] = useState<{ status: FaceStatus; attempt: number }>({ status: "loading", attempt: 0 });

  return <section className="card-preview-modal__face-section" aria-label={`${label} card face`} style={{ textAlign: "center" }}>
    <h3>{label}</h3>
    <div className="card-preview-modal__face" data-card-preview-face style={{ position: "relative", width: "400px", height: "520px", overflow: "hidden", background: "#0e0d0b" }}>
      {!url ? <p role="status" aria-label={`${label} image unavailable`}>{label} image unavailable.</p> : <>
        {status === "loading" && <p role="status" aria-label={`${label} image loading`}>Loading {label} image…</p>}
        {status === "error" && <div>
          <p role="status" aria-label={`${label} image failed to load`}>{label} image failed to load.</p>
          <button type="button" onClick={() => setFace(({ attempt: previousAttempt }) => ({ status: "loading", attempt: previousAttempt + 1 }))}>Retry {label} image</button>
        </div>}
        <img
          key={`${label}-${attempt}`}
          src={url}
          alt={`${label} card artwork`}
          onLoad={() => setFace((face) => ({ ...face, status: "ready" }))}
          onError={() => setFace((face) => ({ ...face, status: "error" }))}
          style={{ width: "400px", height: "520px", objectFit: "contain" }}
        />
      </>}
    </div>
  </section>;
}

export function CardPreviewModal({ card, onClose }: CardPreviewModalProps): React.JSX.Element {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      queueMicrotask(() => openerRef.current?.focus());
    };
  }, [close]);

  return <div className="card-preview-modal__backdrop" style={{ position: "fixed", zIndex: 2200, inset: 0, display: "grid", padding: "1rem", placeItems: "center", background: "rgb(4 4 4 / 78%)" }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="card-preview-modal" style={{ width: "min(56rem, 100%)", maxHeight: "88vh", padding: "1rem", overflowY: "auto", border: "1px solid #9d7847", borderRadius: ".75rem", color: "#dfd0ad", background: "#18120f", boxShadow: "0 1.5rem 4rem rgb(0 0 0 / 70%)" }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="card-preview-modal__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <h2 id={titleId}>Preview {card.name}</h2>
        <button ref={closeRef} type="button" aria-label="Close preview" onClick={close}>×</button>
      </header>
      <div className={`card-preview-modal__faces${card.hasUpgrade ? "" : " card-preview-modal__faces--single"}`} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1rem" }}>
        <CardFace label="Base" url={card.baseCardUrl} />
        {card.hasUpgrade && <CardFace label="Upgraded" url={card.upgradedCardUrl} />}
      </div>
    </div>
  </div>;
}
