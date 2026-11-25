# Contributing

Issues and pull requests are welcome.

- Keep it dependency-free at runtime: plain ES modules, no bundler.
- New admin features go into an adapter in `src/adapters/`. An adapter exports `binds`, `stats()`, `panel()` and `actions`; look at `drop.js` for a compact example.
- Destructive actions need a `confirm` text and go through the protocol automatically.
- Run `npm test` before you open a PR, and add a case to `test/smoke.test.js` for new actions.
- UI follows the shiftbloom brand book v2: white paper, ink text, Bloom Red for actions only, no gradients outside the mark.

By contributing you agree that your work is licensed under AGPL-3.0-or-later.
