# ContextWatchdog

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/icons/logo-1-dark.svg" />
  <img src="public/icons/logo-1.svg" alt="ContextWatchdog" width="260" />
</picture>

**English** | [简体中文](README.zh-CN.md)

ContextWatchdog is local-first detection and redaction for AI workflows: it finds and replaces sensitive information before the text reaches a model. It ships today as a Chrome / Firefox extension (Manifest V3), with desktop, CLI and proxy clients planned. It covers **two tracks at once**: general-text PII (phone numbers, national IDs, bank cards, email, license plates, IP addresses) and developer secrets (API keys, passwords, connection strings, JWTs, private keys). Everything runs locally.

Two ways to use it:

- **Manual redaction in the side panel** (default): paste into the panel → review the detected list → redact → copy
- **Paste interception** (optional, per-site opt-in): paste on an authorised site and the text is replaced in place with placeholders — no need to open the panel

## Quick start

```bash
npm install
npm run build           # Chrome bundle → dist/        (load via chrome://extensions)
npm run build:firefox   # Firefox bundle → dist-firefox/ (about:debugging → This Firefox → Load Temporary Add-on → pick dist-firefox/manifest.json)
npm run test            # run the suite (420 assertions)
```

## Architecture

Three runtimes, one responsibility each: the side panel (Vue 3), the service worker (paste detection + on-demand injection), and the paste listener injected into authorised sites. Detection runs in two tiers — an always-on regex tier with algorithmic validation (ISO 7064 / Luhn / mod-97 / area segments) and an opt-in local GLiNER tier that only sees spans the regex tier left uncovered — followed by one shared post-pass: dedupe → overlap arbitration → value propagation → same value, same placeholder.

Everything deeper lives in [`docs/spec.md`](docs/spec.md):

| Topic | Where |
|-------|-------|
| Overall architecture, detection pipeline & arbitration | §2–§3 |
| Rule modules and regional validation tables (SSN / EIN / IBAN / VAT) | §4 |
| Profiles and custom-regex ReDoS defence | §5 |
| Replacement engine, model & download mechanics | §6–§7 |
| Paste-interception guards, permissions & CSP, storage keys | §8–§10 |
| Dual-target build, test map, known limits | §11–§13 |
| Project layout, engine boundaries, interface language (i18n) | §15–§16 |

## Verifiable privacy claims

Every row below can be checked in this repository instead of taken on faith:

| Claim | How to verify |
|-------|---------------|
| **The extension never sends your text to a server** | `rg -n '\bfetch\s*\(' packages/extension/src` → only two hits, both in `modelDownload.ts` (each an injectable `fetchImpl` defaulting to `globalThis.fetch`, used solely to download the model). No `XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource` anywhere |
| **The only network activity is the model download** | Same as above. It only happens after you explicitly enable the AI tier, and only against whitelisted model sources |
| **Zero contact with unauthorised sites** | `rg -n 'content_scripts\|all_urls' packages/extension/src/manifest.json` → no match. The manifest declares no `content_scripts` and requests only `optional_host_permissions`, granted per site by the user |
| **No telemetry of any kind** | No analytics SDK, no crash reporting, no behavioural tracking in the repository; inspect the bundle yourself after `npm run build` |
| **Credential fields are never processed** | `password` inputs and hidden fields are skipped at `isTextEditable`, with a guard on both the paste-injection and side-panel paths |
| **Releases are verifiable** | Each Release ships `sha256` sums; licences and third-party notices travel with the bundle (`LICENSE` / `NOTICE` / `THIRD-PARTY-NOTICES.txt`) |

The same content, written as a store-submittable policy page, lives at `/privacy/` and
`/en/privacy/` on the landing page. Keep the two in sync — reviewers do compare them.

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

## Tests

```bash
npm test              # everything (golden + regression + unit + perf)
npm run test:watch    # watch mode
npm run site:check    # landing page: Astro/TS diagnostics
npm run site:build    # landing page: static build → apps/site/dist
npm run check:versions # version/licence/canonical consistency + store pre-flight
```

The directory map lives in [`docs/spec.md`](docs/spec.md) §12; manual verification cases with pass criteria are in [`docs/test-cases.md`](docs/test-cases.md).

## Tech stack

- Vue 3 + Pinia + Tailwind CSS 4 + Reka UI
- @crxjs/vite-plugin (Manifest V3 build)
- gliner + @xenova/transformers + onnxruntime-web (GLiNER model, WASM, optional enhancement)
- Remote model loading (primary source: ModelScope mirror; fallback: huggingface.co; Range-resumable download + exponential-backoff retries + a stall watchdog + Cache Storage persistence, so reopening the panel downloads nothing; on failure it silently degrades to pure regex and the UI shows the degraded state)

## Release

```bash
npm run check:versions              # version consistency, licence files in the bundle, landing-page canonicals
npm run check:versions -- --release # "can we tag yet?" — requires everything to be in place
npm run release:pack                # two store-ready zips + SHA256SUMS → release/
```

The full runbook (tags, Release assets, the AMO reproducible-build source package, store
submission steps, asset checklist) is in [`docs/releasing.md`](docs/releasing.md).
`packages/extension/src/manifest.json` is the single source of truth for the version number;
`check:versions` enforces that everywhere else agrees with it.

## Documentation

| Document | What it is |
|----------|------------|
| [`docs/spec.md`](docs/spec.md) | Technical reference: pipeline, rules, profiles, permissions, storage, build, test map (Chinese) |
| [`docs/test-cases.md`](docs/test-cases.md) | Manual verification cases with pass criteria (Chinese) |
| [`docs/releasing.md`](docs/releasing.md) | Release runbook: tags, store submission, asset checklist (Chinese) |
| [`docs/design/license-patent-and-brand.md`](docs/design/license-patent-and-brand.md) | Why Apache-2.0, patent strategy, trademark and brand policy (Chinese) |
| [`docs/design/site-ai-offscreen-host.md`](docs/design/site-ai-offscreen-host.md) | Design ①: per-site AI enhancement — widget control plane + offscreen single model host (Chinese) |
| [`docs/design/local-sanitize-proxy.md`](docs/design/local-sanitize-proxy.md) | Design ②: local sanitising proxy — outbound interception + whitelist + audit trail (Chinese) |
| [`CHANGELOG.md`](CHANGELOG.md) | Round-by-round implementation record (Chinese) |
| [`TODO.md`](TODO.md) | Current status and open items (Chinese) |
| Landing page `/changelog/` | User-facing release notes, bilingual |

Design documents are **deliberately published with the code**: this project files no patents, so the designs themselves constitute practisable prior art (see [PATENTS.md](PATENTS.md)). `site-ai-offscreen-host.md` and `local-sanitize-proxy.md` describe lines ①/② planned *after* 1.0.0 — published before implementation precisely so there is no gap period.

## Contributing

This project is maintained by a **single author** and **does not accept code contributions** — a deliberate maintenance policy rather than a rejection of the community (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Welcome:

- ✅ Issues reporting false positives / false negatives / crashes
- ✅ Sharing use cases and design discussions
- ✅ Forking and adapting it to your own needs (under your own name and icons)

## Attribution and trademark

- Developed and maintained by **hadesxiong**.
- **The `ContextWatchdog` name and icon are the author's trademark** and are not covered by the Apache-2.0 grant (§6 of that licence explicitly excludes trademark rights and preserves only "describing the origin" fair use).
- Allowed: factual references such as `Based on ContextWatchdog (https://github.com/hadesxiong/context-watchdog)`.
- Not allowed: using `ContextWatchdog` as the name, icon, or package name of your derivative; implying that your work is the official version or endorsed by the original author.

See [NOTICE](NOTICE) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Patents

This project **files no patents** (including all future iterations). Every design document and implementation detail is published openly, constituting prior art that can be practised. See [PATENTS.md](PATENTS.md).

## License

Released under the [Apache License, Version 2.0](LICENSE).

```
Copyright 2026 hadesxiong
```

You are free to use, modify, and redistribute this project, including for closed-source commercial purposes — provided you keep the copyright and `NOTICE` notices, mark your changes, and use your own name and icons.
