import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { expect, test } from "vitest";

const assetPath = fileURLToPath(new URL("../../src/client/assets/map_unknown.png", import.meta.url));

test("preserves the approved Slay the Spire unknown-map artwork", async () => {
  const bytes = await readFile(assetPath);
  expect(createHash("sha256").update(bytes).digest("hex"))
    .toBe("015f662a6dc840ea7f01f8c86216abbd9b3e102022b1da18be26a4bbda4d038d");
  await expect(sharp(bytes).metadata()).resolves.toMatchObject({
    format: "png",
    width: 73,
    height: 72,
    hasAlpha: true,
  });
});
