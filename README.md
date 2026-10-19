# PasteGuard

**English** | [简体中文](README.zh-CN.md)

PasteGuard is a Chrome / Firefox extension (Manifest V3) that detects and replaces sensitive information before you send text to an AI. It covers **two tracks at once**: general-text PII (phone numbers, national IDs, bank cards, email, license plates, IP addresses) and developer secrets (API keys, passwords, connection strings, JWTs, private keys). Everything runs locally.

Two ways to use it:

- **Manual redaction in the side panel** (default): paste into the panel → review the detected list → redact → copy
- **Paste interception** (optional, per-site opt-in): paste on an authorised site and the text is replaced in place with placeholders — no need to open the panel

## Quick start

```bash
npm install
npm run build           # Chrome bundle → dist/        (load via chrome://extensions)
npm run build:firefox   # Firefox bundle → dist-firefox/ (about:debugging → This Firefox → Load Temporary Add-on → pick dist-firefox/manifest.json)
npm run test            # run the suite (288 assertions)
```

## Architecture

### Detection pipeline

```
input text
  │
  ▼
scene heuristics (env/yaml/json/log/code/plain — offline, zero latency)
  │
  ▼
regex rules (categories enabled by the active profile)
  ├─ secret:  ENV/YAML/JSON/connection strings/API keys/JWTs/private keys
  ├─ pii:     phone / national ID (checksum) / bank card (Luhn) / IP / plate / email
  ├─ us:      SSN (area-segment validation) / EIN (labelled) / NANP phone   ← off by default
  ├─ eu:      IBAN (mod-97) / VAT (per-country format)                      ← off by default
  └─ entropy: high-entropy strings (thresholds follow the profile's sensitivity tier)
  │
  ▼ (cascaded — only runs on spans the regex stage did not cover)
GLiNER model (gliner + @xenova/transformers + onnxruntime-web — optional)
  ├─ high confidence (>0.65)     → accepted after validation
  ├─ uncertain (0.35–0.65)       → fed back into the regex stage for a second look
  └─ still unmatched             → kept at low confidence (flag only, by default)
  │
  ▼
dedupe → overlap arbitration → value propagation → placeholders shared per value
  │
  ▼
semantic placeholders (zh_CN: <<手机号>> / en: <<PHONE>> — follows the interface language)
```

### Profiles

| Profile | For | Notes |
|---------|-----|-------|
| Universal (default) | anything | union of all rules + arbitration; medium/low confidence is flag-only |
| General text | chat / docs / tickets | PII-first; entropy `strict` (30 chars) |
| Code | configs / code / logs | all secret rules on; entropy `loose` (20 chars); PII is flag-only |
| US personal data | text containing US data | adds the `us` category on top of Universal (SSN/EIN/phone) |
| EU personal data | text containing European data | adds the `eu` category on top of Universal (IBAN/VAT) |

Adding a scenario = adding one entry in `packages/engine/src/detector/profiles.ts`; there is no new code path. The selected profile is persisted in `chrome.storage.local`.

### Regional rule sets (`us` / `eu`)

Regional rules are **off by default** and only participate when you pick the matching profile (or tick the category in a custom profile). This is not caution for its own sake — it is false-positive control: a shape like `\d{3}-\d{2}-\d{4}` can show up in text from anywhere, and folding it into the general set would make every non-US user pay the false-positive cost.

Every rule carries validation, because bare regex is unusable on real text:

| Rule | Validation |
|------|-----------|
| SSN | area-segment validation: rejects area 000/666/9xx, group 00, serial 0000, and all-same-digit values |
| EIN | **label required** (`EIN`/`FEIN`/`TIN`/`Tax ID`) — a bare `\d{2}-\d{7}` is indistinguishable from a date range; the IRS-assigned prefixes are checked too |
| North-American phone | NANP: area code and exchange must start with 2–9 — this one rule filters out dates like `2024-01-0100` |
| IBAN | ISO 13616 mod-97 (≈1 in 97 pass rate for arbitrary 15–34 char strings); both compact and 4-char-grouped notation |
| VAT | per-country format table (Greece uses `EL`, not `GR` — that is the VIES definition) |

VAT currently has **format validation only** (there is no universal check digit), hence its `medium` confidence; per-country check digits (DE, FR, …) are a follow-up.

### Custom profiles

The «＋» in the profile bar clones the current profile into a user profile (edit with the ⚙ button):

- **Detection categories**: secrets / personal data / high-entropy strings (plus the regional categories)
- **High-entropy sensitivity**: loose (20 chars) / standard (25) / strict (30)
- **Per-type default action**: replace or keep, set individually per detection type
- **Value whitelist**: one exact value per line; matches are neither detected nor replaced (including every propagated occurrence)
- **AI detection targets**: the GLiNER label set (personal-data set / secret set / all / custom)
- **Custom regex rules**: fill the gaps zero-shot labelling leaves, with two layers of ReDoS defence — static rejection of nested quantifiers (star-height check) plus a 50 ms per-rule runtime budget and a match cap; results go through the full pipeline (dedupe / overlap arbitration / value propagation / whitelist)
- **JSON import & export**: all custom profiles via the clipboard; on import, ids are regenerated, duplicate names get a numeric suffix, and dangerous regexes are filtered by the sanitiser

Custom profiles live in `chrome.storage.local` (`pasteguard.userProfiles`); built-in profiles cannot be edited or deleted. Stored data is sanitised, and corrupt entries are silently dropped. Implementation details: `docs/spec.md`; test cases: `docs/test-cases.md`.

### Paste interception (optional, per-site opt-in)

Add a site (e.g. `chat.example.com`) in the "Paste interception" card of the side panel; the browser will ask you to grant access to that site. Once granted:

- Pasting into an input/textarea on that site **inserts the original text normally first** (input is never blocked), then **replaces it in place** with placeholders once detection finishes
- Detection runs the existing regex pipeline inside the service worker (the GLiNER model is never loaded in the SW), so no model download is needed
- The site list is stored in `chrome.storage.local` (`pasteguard.protectedSites`); the SW injects the paste listener on demand via `tabs.onUpdated` — **unauthorised sites are never touched** (the manifest declares no `content_scripts` and does not request `<all_urls>`)
- Safety rails: password fields and hidden inputs are never processed; the rewrite only happens if the inserted text still matches the clipboard character-for-character (if the site rewrote the paste, we back off); if the user keeps typing during detection we back off rather than overwrite new content; if nothing is detected, nothing is touched

v1 limits: only `input[type=text/search]` and `textarea`; `contenteditable` rich-text areas are not handled yet (paste fragments are hard to locate reliably — planned for a later version).

### Firefox compatibility

Bundles are built per target, and both manifests contain only keys valid for that target, so loading produces zero warnings:

```bash
npm run build           # Chrome → dist/
npm run build:firefox   # Firefox 121+ → dist-firefox/
```

- Both targets **share one input manifest** (CRXJS has to discover the entry points through `side_panel` / `service_worker`; forking the input would drop entries from the bundle), and `--mode firefox` only switches the output directory
- All differences are applied after the build by `scripts/postbuild.mjs`: `background.service_worker → scripts`, `side_panel → sidebar_action`, dropping the unknown `sidePanel` permission, and adding `browser_specific_settings.gecko` id
- Opening the side panel: runtime probe for `chrome.sidePanel.open`, falling back to `chrome.sidebarAction.open` — both open the same panel page
- The Chrome bundle therefore has no `sidebar_action`/`scripts`/gecko keys (no "requires manifest version of 2 or lower"), and the Firefox bundle has no `side_panel`/`sidePanel`/`service_worker` (no unknown-key or unknown-permission warnings)

### No-leak guarantees

- **Same value, same placeholder**: a value appearing N times is replaced by the *same* placeholder everywhere (value propagation covers bare occurrences that carry no context)
- **No overlapping spans**: overlapping detections are merged by arbitration (type priority: secrets > PII > high entropy), so replacement output is never cut into itself
- **Validation over false positives**: national IDs go through the ISO 7064 check digit, bank cards through Luhn, and weak-password dictionaries (including digit-suffixed variants) are filtered out

### Verifiable privacy claims

Every row below can be checked in this repository instead of taken on faith:

| Claim | How to verify |
|-------|---------------|
| **The extension never sends your text to a server** | `rg -n '\bfetch\s*\(' packages/extension/src` → only two hits, both in `modelDownload.ts` (each an injectable `fetchImpl` defaulting to `globalThis.fetch`, used solely to download the model). No `XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource` anywhere |
| **The only network activity is the model download** | Same as above. It only happens after you explicitly enable the AI tier, and only against whitelisted model sources |
| **Zero contact with unauthorised sites** | `rg -n 'content_scripts\|all_urls' packages/extension/src/manifest.json` → no match. The manifest declares no `content_scripts` and requests only `optional_host_permissions`, granted per site by the user |
| **No telemetry of any kind** | No analytics SDK, no crash reporting, no behavioural tracking in the repository; inspect the bundle yourself after `npm run build` |
| **Credential fields are never processed** | `password` inputs and hidden fields are skipped at `isTextEditable`, with a guard on both the paste-injection and side-panel paths |
| **Releases are verifiable** | Each Release ships `sha256` sums; licences and third-party notices travel with the bundle (`LICENSE` / `THIRD-PARTY-NOTICES.txt`) |

## Project layout

```
packages/
├── engine/                  # detection & replacement engine (pure logic, host-agnostic)
│   └── src/
│       ├── detector/
│       │   ├── pipeline.ts        # main pipeline (cascade scheduling + arbitration + value propagation)
│       │   ├── backend.ts         # InferenceBackend abstraction + singleton injection + confidence tiers
│       │   ├── profiles.ts        # profile registry (scenario configs)
│       │   ├── sceneDetector.ts   # scene heuristics (pure rules, no model)
│       │   ├── entityShape.ts     # entity shape gate (rejects model hallucinations)
│       │   └── rules/             # rule modules, grouped by category
│       │       ├── envPasswordRules / kvRules / dbPasswordRules
│       │       ├── apiKeyRules / privateKeyRules / emailRules
│       │       ├── piiRules       # phone / national ID / bank card / IP / plate
│       │       ├── usRules        # SSN / EIN / NANP phone
│       │       ├── euRules        # IBAN / VAT
│       │       ├── highEntropyRules / valueFilters / constants
│       │       └── scanner        # scanner (category switches + type merging)
│       ├── replacer/              # replacement engine (pure `apply`)
│       │   ├── placeholder.ts     # semantic placeholders, per locale (generate / parse)
│       │   └── mapping.ts         # mapping table (shared per value)
│       ├── sites.ts               # protected-site normalisation/matching (paste interception)
│       ├── messages.ts            # content ↔ SW message contract
│       ├── types/                 # type definitions (DetectionType/ProfileConfig)
│       └── utils/id.ts            # unified id generation
└── design-tokens/                 # single source of design tokens (extension + landing page)

packages/extension/                # the extension (host layer)
└── src/
    ├── model/                     # model host: GLiNER + onnxruntime-web + downloader
    │   ├── contentDetector.ts     #   GLiNER calls and readiness state
    │   ├── modelDownload.ts       #   resumable download / source fallback / multi-window lock / Cache Storage
    │   ├── localBackend.ts        #   adapts GLiNER to the engine's InferenceBackend
    │   └── index.ts               #   host entry (installModelBackend / preloadModels)
    ├── components/                # Vue components (ProfileSelect/DetectionItem/PasteInterceptionSettings/…)
    ├── content/pasteText.ts       # pure logic for paste-in-place replacement (span derivation + rewrite guards)
    ├── stores/detection.ts        # Pinia (profile persistence + default-action layering)
    ├── i18n/                      # interface copy: a single catalog, shared by the UI and _locales
    │   ├── locales/{en,zh_CN}.json #   flat entries (keys use the Chrome messages.json charset)
    │   └── index.ts               #   t() / useI18n / typeLabel / profileLabel
    ├── sidepanel/                 # Side Panel UI
    ├── background/                # service worker (cross-browser panel entry + paste detection service + site injection)
    ├── shims/                     # build-time stubs (ort GPU subpaths)
    └── style.css                  # imports @tokens/tokens.css + Tailwind theme mapping

public/                            # repo-level shared static assets (icons)
tests/  scripts/  docs/            # tests / build & probe scripts / design docs
docs/design/                       # design decisions and future lines (defensive publication — see its README)
```

The extension references the engine through the `@engine/*` alias (declared in both `tsconfig.json` and `vite.config.ts`). **The engine depends on no host API**: it never statically imports `chrome` / `node:*` / `vue` / `gliner` / `onnxruntime-web` / `@xenova/transformers`; host capabilities are always injected through adapters. That constraint is protected by automated assertions (`tests/unit/engineBoundaries.test.ts`) — it is the precondition for the same code serving both the browser extension and a future Node proxy service.

There is exactly one interface between the model runtime (`packages/extension/src/model/`) and the detection pipeline (`packages/engine/`): `InferenceBackend`. The host registers its implementation at startup via `installModelBackend()`; when nothing is registered, `getInferenceBackend()` returns `null` and the pipeline degrades to pure regex. That is also why every test under `tests/` can run directly on Node.

**Vite's `root` points at `packages/extension`** (not the repo root) so that the manifest entry paths stay package-relative (`src/sidepanel/index.html`), keeping the output layout byte-identical to the pre-refactor layout — no runtime `chrome.runtime.getURL` change needed. A side effect is that Tailwind's scan scope happens to be confined to the extension package; scanning the repo root would treat English words inside `package-lock.json` as class names. `scripts/postbuild.mjs` spot-checks the emitted CSS for utilities and design tokens, and a missing either one makes the build **fail hard**.

Design tokens are referenced from `packages/extension/src/style.css` through the `@tokens/tokens.css` alias, and are **fully inlined into the output** (also verified at build time).

### Interface language (i18n)

There is **one** copy of every string: `packages/extension/src/i18n/locales/{en,zh_CN}.json`. Two consumers read it — the UI through the bundled `t()` (language must switch at runtime, so the dictionary has to be in the bundle), and the manifest's `__MSG_*__` plus the service worker's `chrome.i18n.getMessage` through `_locales/*/messages.json` (the native Chrome mechanism, which also keeps the dictionary out of the SW bundle). The latter is generated from the former at build time by `scripts/generate-locales.mjs` — **never copied by hand**.

Keys are always snake_case: Chrome's `messages.json` only accepts `[a-zA-Z0-9_@]`, so dot-separated hierarchies would make a shared list impossible.

Locale resolution: `pasteguard.locale` (localStorage, explicit choice, synchronously readable) → `chrome.i18n.getUILanguage()` → `navigator.language` → `en`. The switch lives in the side panel's "Detection engine status" panel.

**Placeholders follow the language too**: whether redacted text ends up with `<<手机号>>` or `<<PHONE>>` depends on the current interface language. The engine cannot read browser APIs itself, so the host injects this at startup via `setPlaceholderLocale()`; the parser accepts names from both languages, so mapping tables written before a language switch still round-trip.

`tests/unit/i18n.test.ts` catches the four classes of drift that build green and only show up in the UI: new copy written in one language only, an entry added to one language but not the other, a mistyped `t('xxx')`, and a `__MSG_*__` in the manifest with no matching entry.

## Tests

```bash
npm test              # everything (golden + regression + unit + perf)
npm run test:watch    # watch mode
```

| Directory | Contents |
|-----------|----------|
| `tests/golden/` | end-to-end cases grouped by profile (universal/text/code/whitelist) |
| `tests/regression/` | regressions for Phase 1 fixes (passwords with @, repeated values, overlaps, CJK offsets, swallowed values) |
| `tests/unit/` | scene heuristics / placeholders / validation algorithms / replacement engine / user-profile CRUD / model downloader / detection store state machine / site matching / paste-in-place replacement / i18n drift guards / regional rule sets (US · EU) |
| `tests/perf/` | long-text benchmark (5000 chars < 2 s) |

Manual verification cases: `docs/test-cases.md`; implementation details: `docs/spec.md`.

## Tech stack

- Vue 3 + Pinia + Tailwind CSS 4 + Reka UI
- @crxjs/vite-plugin (Manifest V3 build)
- gliner + @xenova/transformers + onnxruntime-web (GLiNER model, WASM, optional enhancement)
- Remote model loading (primary source: ModelScope mirror; fallback: huggingface.co; Range-resumable download + exponential-backoff retries + a stall watchdog + Cache Storage persistence, so reopening the panel downloads nothing; on failure it silently degrades to pure regex and the UI shows the degraded state)

## Third-party components and model attribution

`THIRD-PARTY-NOTICES.txt` is generated at build time and distributed with the bundle (required by Apache-2.0 §4 and by MIT's copyright/licence notice clause). Here is the human-readable version:

| Component | Purpose | Licence |
|-----------|---------|---------|
| vue / pinia / reka-ui | UI framework and components | MIT |
| @crxjs/vite-plugin / vite / tailwindcss / typescript | build chain | MIT |
| gliner | zero-shot text entity recognition | Apache-2.0 ※ |
| @xenova/transformers | model runtime (transformers.js) | Apache-2.0 |
| onnxruntime-web / onnxruntime-common | ONNX Runtime (WASM backend) | MIT |
| @huggingface/jinja | template engine (transformers dependency) | MIT |
| model `onnx-community/gliner_small-v2` (downloaded at runtime, not redistributed) | AI detection | Apache-2.0 |

> ※ `gliner`'s `package.json` declares MIT, but the `LICENSE` file inside the package is the full Apache-2.0 text. **The `LICENSE` file wins**, so it is treated as Apache-2.0. This discrepancy is recorded in `THIRD-PARTY-NOTICES.txt`.

**One compliance decision worth noting**: GLiNER **v0/v1 are `cc-by-nc-4.0` (non-commercial)**, and the licence changed to Apache-2.0 starting with **v2**. This project **pins v2**, which is itself a licensing decision — had we used v1 by mistake, this project could not have been released under any licence permitting commercial use.

## Data flow and privacy

| Stage | Where the data goes |
|-------|--------------------|
| Text detection and replacement | **on-device** (service worker / side-panel memory); never leaves the machine |
| AI model inference | **on-device** (WASM / ONNX Runtime); never leaves the machine |
| Model download | whitelisted model sources (ModelScope → huggingface.co fallback); **model files only, no user data is ever uploaded** |
| Site authorisation | granted per site, stored in `chrome.storage.local`; unauthorised sites are never touched |
| Telemetry / analytics / crash reporting | **none** |
| Third-party analytics SDKs | **none** |

**No cloud, no backend, no accounts.** This is a fully offline tool — apart from the initial AI model download, it is fully functional with the network unplugged.

## Contributing

This project is maintained by a **single author** and **does not accept code contributions** — a deliberate maintenance policy rather than a rejection of the community (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Welcome:

- ✅ Issues reporting false positives / false negatives / crashes
- ✅ Sharing use cases and design discussions
- ✅ Forking and adapting it to your own needs (under your own name and icons)

## Attribution and trademark

- Developed and maintained by **hadesxiong**.
- **The `PasteGuard` name and icon are the author's trademark** and are not covered by the Apache-2.0 grant (§6 of that licence explicitly excludes trademark rights and preserves only "describing the origin" fair use).
- Allowed: factual references such as `Based on PasteGuard (https://github.com/hadesxiong/paste-guard)`.
- Not allowed: using `PasteGuard` as the name, icon, or package name of your derivative; implying that your work is the official version or endorsed by the original author.

See [NOTICE](NOTICE) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Patents

This project **files no patents** (including all future iterations). Every design document and implementation detail is published openly, constituting prior art that can be practised. See [PATENTS.md](PATENTS.md).

## License

Released under the [Apache License, Version 2.0](LICENSE).

```
Copyright 2026 hadesxiong
```

You are free to use, modify, and redistribute this project, including for closed-source commercial purposes — provided you keep the copyright and `NOTICE` notices, mark your changes, and use your own name and icons.
