# Contributing

Issues and pull requests are welcome.

- Keep it dependency-free at runtime: strict TypeScript with erasable syntax only (no enums or namespaces), bundled by Wrangler on deploy.
- New admin features go into an adapter in `src/adapters/`. An adapter exports `binds`, `stats()`, `panel()` and `actions`; look at `drop.ts` for a compact example (the `Adapter` type in `src/types.ts` describes the shape).
- Destructive actions need a `confirm` text and go through the protocol automatically.
- Run `npm run typecheck` and `npm test` before you open a PR, and add a case to `test/smoke.test.ts` for new actions.
- UI follows the shiftbloom brand book v2: white paper, ink text, Bloom Red for actions only, no gradients outside the mark.

## Working on an issue

Issues labeled `good first issue` or `help wanted` are open to anyone. Before you write code:

1. Comment on the issue and say how you plan to approach it: the files you expect to touch, and anything you would do differently from what the issue suggests. A few sentences are enough.
2. Wait until a maintainer assigns the issue to you. That way two people don't build the same thing, and we can point out a dead end before you spend an evening on it.
3. Open the pull request and link the issue (`Closes #123`).

Typo fixes and other small, obvious changes can go straight to a pull request.

If an assigned issue sees no activity for 14 days, we'll check in and may hand it to someone else. You're welcome to pick it up again later.

## Using AI tools

You're welcome to use AI assistants, the same way you'd use an editor or a linter. We only ask that a person stands behind every contribution:

- You have read and understood every line you submit, and you ran the checks yourself.
- You answer review questions in your own words and can change the code when we ask.
- The pull request description explains what you decided and why. The diff already shows what changed.

Issues, comments and pull requests that an agent wrote and posted on its own, with nobody actually involved, will be closed. This isn't about the tool. We'd like to get to know the people who work on this project.

By contributing you agree that your work is licensed under AGPL-3.0-or-later.
