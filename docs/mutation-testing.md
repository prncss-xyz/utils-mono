# Mutation testing

Stryker mutates `packages/react-utils/src/store/store/` to check that the test suite catches bugs. Each surviving mutant is either a test to add or, when provably equivalent, a suppression.

## Run

Run `pnpm --filter @prncss-xyz/react-utils mutate`. It runs the whole `unit` vitest project of `packages/react-utils`. Settings are shared through `packages/react-utils/unit.testing.ts`; `vp test` and the pre-commit hook run the projects defined in the root `vite.config.ts`, which spreads the same settings. The run uses a fixed fast-check seed (`packages/react-utils/stryker.setup.testing.ts`, loaded only by `packages/react-utils/stryker.vitest.config.ts`).

- The HTML report is written to `packages/react-utils/reports/mutation/index.html`.
- Incremental state is kept in `packages/react-utils/reports/stryker-incremental.json`, so a rerun on unchanged code finishes in seconds.
- After a config-only change, the incremental run is enough. Compare its `mutation.json` with the previous one using the store task notes' `cmp.mjs`.
- Pass `--force` for a full rerun only when the test set or the runner settings change.
- After a run, `pgrep -af '[v]itest|[s]tryker-mutator|[s]tryker run'` must print nothing.

## Reuse evidence

Prefer an incremental run on the final reviewed state. Reuse passing evidence across commits while the relevant source, tests, and runner settings remain unchanged. Rerun when later changes invalidate that evidence.

## Review survivors

Compare the survivors with those recorded in the previous store task's notes. The latest baseline is the Stryker task's `mutation-results.md`.

- A survivor on unchanged code is a regression in test strength.
- A survivor on code the task added is missing coverage. Record it in the task notes.

## Exclusions

Broad or repeated exclusions belong in `packages/react-utils/stryker.config.mjs`.

## Suppressing an equivalent mutant

A surviving mutant is first a signal to add or strengthen a test. Suppress it only when no observable behavior can differ.

Suppress only when the mutant is proven equivalent by code evidence. The code path shows the mutated expression yields the same result in every reachable state. "No test fails" is not evidence of equivalence.

Place the comment on the line directly above the mutated code:

```ts
// Stryker disable next-line <mutator>: <reason>
```

- `<mutator>` is one mutator name, as Stryker reports it in the mutation results. Never `all`.
- `<reason>` is one line stating why the mutant is equivalent.

Record each suppression in the task notes with its file, line, mutator, reason, and the code evidence behind the equivalence. Then rerun `pnpm --filter @prncss-xyz/react-utils mutate`; the suppressed mutant must no longer appear as a survivor.
