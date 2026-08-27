# Third-party notices

Let's Go Green! includes the following pinned, locally served components for
private package-label recognition. These files are generated into
`public/ocr-runtime/` during installation and are shipped with production
builds; they are never fetched from a CDN at runtime.

## Tesseract.js 7.0.0

- Project: https://github.com/naptha/tesseract.js
- License: Apache License 2.0
- Distributed artifact: browser worker
- Full license: `licenses/APACHE-2.0.txt`

## tesseract.js-core 7.0.0

- Project: https://github.com/naptha/tesseract.js-core
- License: Apache License 2.0
- Distributed artifacts: WebAssembly JavaScript cores
- Full license: `licenses/APACHE-2.0.txt`

## @tesseract.js-data/eng 1.0.0

- Project: https://github.com/naptha/tessdata
- Package-declared license: MIT
- Distributed artifact: English trained-data model
- Full license: `licenses/MIT.txt`

## Code bundled in the Tesseract.js browser worker

The upstream minified worker carries these attribution notices:

- `buffer` browser module, Feross Aboukhadijeh — MIT
- `ieee754`, Feross Aboukhadijeh — BSD-3-Clause
- `regenerator-runtime`, Facebook, Inc. — MIT
- `zlib.js`, imaya — MIT

The exact upstream notice file is committed as
`licenses/tesseract-worker-bundled-notices.txt` and copied beside the minified
runtime worker as `worker.min.js.LICENSE.txt`. The complete MIT and BSD-3-Clause
license texts are included in `licenses/MIT.txt` and
`licenses/BSD-3-Clause.txt`.

No upstream component is modified by the asset-preparation step; it copies the
pinned npm artifacts byte-for-byte and records SHA-256 hashes in the runtime
manifest.
