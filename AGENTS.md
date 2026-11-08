React

To write Storybook stories, always use Next Story Format (NSF).

Code and reviews follow [CODING_STANDARDS.md](CODING_STANDARDS.md).

UI work in `apps/web` follows the Astryx rules in [apps/web/AGENTS.md](apps/web/AGENTS.md).

In the store runtime (`packages/react-utils/src/store/store/`), do not handle exceptions thrown by user-supplied functions (getters, setters, `onMount`, effects, cleanups, subscriber callbacks, etc.), and do not add code to keep such a throw from disrupting the process. This is deliberately left for later.

## Mutation testing the store runtime

Mutation testing is task-level validation, not a per-commit requirement. Run it for tasks that change store runtime behavior, tests in Stryker's unit suite, or mutation-testing configuration. Skip unrelated tasks and documentation-only or formatting-only changes. Prefer an incremental run on the final reviewed state, and reuse passing evidence across commits while the relevant source, tests, and runner settings remain unchanged. Rerun when later changes invalidate that evidence.

Run `pnpm --filter @prncss-xyz/react-utils mutate` to mutate `packages/react-utils/src/store/store/` with Stryker. It runs the whole `unit` vitest project of `packages/react-utils` (settings shared through `packages/react-utils/unit.testing.ts`; `vp test` and the pre-commit hook run the projects defined in the root `vite.config.ts`, which spreads the same settings) with a fixed fast-check seed (`packages/react-utils/stryker.setup.testing.ts`, loaded only by `packages/react-utils/stryker.vitest.config.ts`), writes `packages/react-utils/reports/mutation/index.html`, and keeps incremental state in `packages/react-utils/reports/stryker-incremental.json`, so a rerun on unchanged code finishes in seconds. After a config-only change, the incremental run is enough: compare its `mutation.json` with the previous one using the store task notes' `cmp.mjs`. Pass `--force` for a full rerun only when the test set or the runner settings change.

Store tasks use it as evidence that the suite still catches bugs: compare the survivors with those recorded in the previous store task's notes (the latest baseline is the Stryker task's `mutation-results.md`); a survivor on unchanged code is a regression in test strength, a survivor on code the task added is missing coverage to record in the task notes. Do not add the run to the pre-commit hook or `vp run verify`. Broad or repeated exclusions belong in `packages/react-utils/stryker.config.mjs`. An inline comment is allowed only for a mutant proven equivalent by code evidence: `// Stryker disable next-line <mutator>: <reason>`, naming one mutator (never `all`), with a reason, and recorded in the task notes. After a run, `pgrep -af '[v]itest|[s]tryker-mutator|[s]tryker run'` must print nothing.
