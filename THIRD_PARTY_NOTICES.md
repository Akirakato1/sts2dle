# Third-Party Notices

## Spire Codex hosted API

STS-dle uses the hosted [Spire Codex](https://spire-codex.com) API as its
external source for Slay the Spire 2 card data, raw artwork URLs, and ordinary
full-card CDN URLs. The hosted API is available for community use subject to
the published [Spire Codex API Terms of Use](https://github.com/ptrlrd/spire-codex/blob/main/API_TERMS.md),
including its rate limits (currently 60 data requests per minute per IP),
backoff requirements, no-warranty terms, and restrictions against abusive or
game-repackaging use. Spire Codex encourages, but does not require, a visible
link back; this notice provides that requested attribution.

Spire Codex source code has a separate PolyForm Noncommercial license. STS-dle
does **not** copy or port Spire Codex parser source, the STS2 Dashboard parser
ports, `simplifier.js`, parser-derived source files, or extracted card JSON.
The adapter in this repository is an original mapping of the hosted public API
schema.

## Slay the Spire 2

Slay the Spire 2 game data and artwork, including the artwork and extracted
rendering resources referenced below, are owned by Mega Crit Games and their
respective rights holders. They are used here for an unofficial community fan
project. STS-dle is not affiliated with, endorsed by, or sponsored by Mega
Crit Games, and does not claim ownership of that game data or artwork.

## Card renderer and card maker

`vendor/card-renderer/renderer.js` was copied from the local STS2 Dashboard at:

`C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\scripts\render\renderer.js`

The Canvas 2D renderer is a local JavaScript port of `renderer.py` from
[WanderZil/Slay-the-Spire-2-Card-Maker](https://github.com/WanderZil/Slay-the-Spire-2-Card-Maker),
whose code is distributed under the MIT License. The local JavaScript port is
also distributed under the MIT License by its author, copyright (c) 2026
Akirakato1. STS-dle changed only the renderer's asset-base helper so the
vendored assets can be served from an injectable URL; its rendering geometry,
color tables, and drawing code remain unchanged.

MIT License

Copyright (c) 2026 Akirakato1

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Copied rendering assets and fonts

The following 20 rendering assets were copied from:

`C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\card render assets`

- `Ancient/flame.png`
- `Banner/banner.png`
- `Banner/banner_ancient.png`
- `Frame/frame_ancient.png`
- `Frame/frame_attack.png`
- `Frame/frame_power.png`
- `Frame/frame_quest.png`
- `Frame/frame_skill.png`
- `Icons/star_cost.png`
- `Icons/star_icon.png`
- `Mana/energy_colorless.png`
- `Mana/energy_defect.png`
- `Mana/energy_ironclad.png`
- `Mana/energy_necrobinder.png`
- `Mana/energy_regent.png`
- `Mana/energy_silent.png`
- `Portrait/portrait_attack.png`
- `Portrait/portrait_plaque.png`
- `Portrait/portrait_power.png`
- `Portrait/portrait_skill.png`

The dashboard attribution identifies `Icons/star_icon.png` as vendored from
WanderZil's card maker and the other frames, banners, mana orbs, portrait
borders, type plaque, and game font resources as locally extracted game
resources. The card maker's separate
[asset notice](https://github.com/WanderZil/Slay-the-Spire-2-Card-Maker/blob/main/ASSET_LICENSE.md)
applies to its bundled rendering assets and requires preservation of the
notice and respect for third-party game IP.

The following two font files were copied from the installed STS2 Dashboard:

- `C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\fonts\kreon_bold.ttf`
- `C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\fonts\kreon_regular.ttf`

Both binaries identify themselves as Kreon version 2.001 and contain this
embedded copyright notice:

> Copyright 2018 The Kreon Project Authors (https://github.com/googlefonts/kreon)

Their embedded license metadata identifies the SIL Open Font License,
Version 1.1. The complete unmodified license text is tracked at
[`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt). The font metadata does not
declare a Reserved Font Name. It does contain the trademark statement
"Kreon Light is a trademark of Julia Petretta." This distribution preserves
that statement; neither the project authors nor the designers are used to
promote or endorse STS-dle.

No other STS2 Dashboard files were copied.
