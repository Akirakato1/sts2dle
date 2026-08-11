import React, { useState } from "react";

type CardFace = "base" | "upgraded";

interface RevealImageProps {
  attempt: number;
  face: CardFace;
  failed: boolean;
  name: string;
  url: string;
  onError(): void;
}

function RevealImage({ attempt, face, failed, name, url, onError }: RevealImageProps) {
  const label = `${name} ${face}`;

  if (failed) {
    return <div className="card-stack__image-error" role="status">
      <span>{name} image could not be loaded.</span>
    </div>;
  }

  return <img
    key={attempt}
    className="card-stack__image"
    src={url}
    alt={`${label} card`}
    width={400}
    height={520}
    onError={onError}
  />;
}

export interface CardStackProps {
  name: string;
  baseUrl: string;
  upgradedUrl: string | null;
}

export function CardStack({ name, baseUrl, upgradedUrl }: CardStackProps) {
  const [front, setFront] = useState<CardFace>("base");
  const [failed, setFailed] = useState<Record<CardFace, boolean>>({
    base: baseUrl.length === 0,
    upgraded: upgradedUrl !== null && upgradedUrl.length === 0,
  });
  const [attempts, setAttempts] = useState<Record<CardFace, number>>({ base: 0, upgraded: 0 });
  const toggle = () => setFront((value) => value === "base" ? "upgraded" : "base");
  const image = (face: CardFace, url: string) => <RevealImage
    attempt={attempts[face]}
    face={face}
    failed={failed[face]}
    name={name}
    url={url}
    onError={() => setFailed((value) => ({ ...value, [face]: true }))}
  />;
  const retry = (face: CardFace, url: string) => failed[face] && <button
    type="button"
    className="card-stack__retry"
    aria-label={`Retry ${name} ${face} image`}
    disabled={url.length === 0}
    onClick={() => {
      setAttempts((value) => ({ ...value, [face]: value[face] + 1 }));
      setFailed((value) => ({ ...value, [face]: false }));
    }}
  >Retry</button>;

  if (!upgradedUrl) {
    return <div className="card-stack-frame">
      <div className="card-stack card-stack--single">
        <div className="card-stack__card card-stack__front">
          {image("base", baseUrl)}
        </div>
      </div>
      {retry("base", baseUrl)}
    </div>;
  }

  const faceClass = (face: CardFace) => face === front
    ? "card-stack__card card-stack__front"
    : "card-stack__card card-stack__back card-stack__masked";

  return <div className="card-stack-frame">
    <button
      type="button"
      className={`card-stack card-stack--interactive card-stack--front-${front}`}
      aria-label={front === "base" ? `Show upgraded ${name}` : `Show base ${name}`}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        toggle();
      }}
    >
      <span className={faceClass("base")}>
        {image("base", baseUrl)}
      </span>
      <span className={faceClass("upgraded")}>
        {image("upgraded", upgradedUrl)}
      </span>
    </button>
    {retry("base", baseUrl)}
    {retry("upgraded", upgradedUrl)}
  </div>;
}
