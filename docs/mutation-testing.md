# Mutation testing

Stryker mutates `packages/react-utils/src/store/store/` to check that the test suite catches bugs. Each surviving mutant is either a test to add or, when provably equivalent, a suppression.

## When to run

Mutation testing is task-level validation, not a per-commit requirement. Do not add it to the pre-commit hook or `vp run verify`.

- Run it when a task changes store runtime behavior or the mutation-testing configuration.
- Run it for a test-only change whose purpose is to kill a survivor or to justify a suppression.
- Do not run it for other test-only changes, including any `**/*.test.ts` file in `packages/react-utils`. A periodic full run covers them.
- Skip unrelated tasks and documentation-only or formatting-only changes.
- Always run incrementally (the default) and never pass `--force` outside the case under "Run". The incremental file limits the work to mutants whose code or covering tests changed, so the cost scales with the diff. Do not narrow the run with `--mutate`: a narrower mutate set drops the other files' results from the incremental file and loses the baseline.

## Run

Run `pnpm --filter @prncss-xyz/react-utils mutate`. It runs the whole `unit` vitest project of `packages/react-utils`: every `**/*.test.ts` file under that package, not only those beside the store runtime (see `packages/react-utils/unit.testing.ts`). A change to any of those files invalidates the incremental results of the mutants those tests cover, even when no mutated source changed. Settings are shared through `packages/react-utils/unit.testing.ts`; `vp test` and the pre-commit hook run the projects defined in the root `vite.config.ts`, which spreads the same settings. The run uses a fixed fast-check seed (`packages/react-utils/stryker.setup.testing.ts`, loaded only by `packages/react-utils/stryker.vitest.config.ts`).

- The HTML report is written to `packages/react-utils/reports/mutation/index.html`.
- A Markdown summary is written to `packages/react-utils/reports/mutation/report.md`: status counts and every surviving or uncovered mutant, with its source text. `scripts/mutation-report.mjs` generates it from `mutation.json`. Run it with `--out <file>` to write a copy, or with `--check <file>` to confirm that a record still contains the generated output. Copy counts and locations from the generated output; do not retype them.
- Start the run detached, for example `nohup pnpm --filter @prncss-xyz/react-utils mutate > /tmp/mutate.log 2>&1 &`, then poll the log and `reports/mutation/mutation.json`. A first full run can exceed a foreground command limit: one run under `timeout 580` stalled at 776/872 mutants and left no report. A detached incremental run after a test-only change finished in 1m41s; expect about that, and treat a run far beyond it as stuck rather than slow.
- Incremental state is kept in `packages/react-utils/reports/stryker-incremental.json`, so a rerun on unchanged code finishes in seconds.
- After a config-only change, the incremental run is enough. Compare its `mutation.json` with the previous one using the store task notes' `cmp.mjs`.
- Pass `--force` for a full rerun only when the test set or the runner settings change.
- `--force` reruns every mutant but does not drop stale test entries. The incremental differ copies forward tests recorded in the incremental file that no longer exist (`@stryker-mutator/core` `incremental-differ.js`, the loop under "Make sure that tests that didn't run this time around aren't forgotten"), and `--force` only affects mutants. Renamed or deleted tests therefore stay in `mutation.json` under their old names, referenced by no mutant. Delete `packages/react-utils/reports/stryker-incremental.json` before the run to clear them.
- After a run, `pgrep -af '[v]itest|[s]tryker-mutator|[s]tryker run'` must print nothing.

## Report counts and survivors

Quote mutation counts and survivor locations from `reports/mutation/report.md`, or from `scripts/mutation-report.mjs` output, copied verbatim. Do not restate them from memory: a handoff once said 807 mutants where the JSON held 813 and 809.

- `node scripts/mutation-report.mjs <mutation.json> --out <file>` writes the table for a run.
- `node scripts/mutation-report.mjs <mutation.json> --check <file>` exits non-zero when a record does not contain the generated table for that run.
- Report the `RuntimeError` count as its own line. Do not count those mutants as killed or covered; a nonzero count on code the task changed means that code is not covered by the score. See "Known limitation: RuntimeError instead of the real status".

Prose that cites source lines is not checked by these commands. Keep such citations to lines the survivor table already lists, or re-verify them after each edit.

## Reuse evidence

Prefer an incremental run on the final reviewed state. Reuse passing evidence across commits while the relevant source, tests, and runner settings remain unchanged. Rerun when later changes invalidate that evidence.

## Review survivors

Compare the survivors with those recorded in the previous store task's notes. The latest baseline is the Stryker task's `mutation-results.md`.

- For a test-only change, a HEAD baseline run is not required. Compare against the latest recorded baseline, and state in the task notes that no mutated source changed, since survivor attribution then rests on that.
- A survivor on unchanged code is a regression in test strength.
- A survivor on code the task added is missing coverage. Record it in the task notes.

## Known limitation: RuntimeError instead of the real status

A mutant whose only effect is an unhandled error outside a test is classified `RuntimeError` (`TypeError: Cannot convert object to primitive value`) instead of its real status, for example `Timeout`. Vitest 5.0.5 serializes the error as a null-prototype object (`@vitest/utils` `serialize.js:85`). `@stryker-mutator/vitest-runner` 10.1.1 passes it to `errorToString` (`vitest-test-runner.js:250`), and `@stryker-mutator/util` `errorToString` ends with `String(error)` (`errors.js:22`), which throws on a null-prototype object.

`RuntimeError` mutants are excluded from the mutation score (`mutation-testing-metrics` `calculateMetrics.js`: only Killed, Timeout, Survived and NoCoverage count as valid). A mutant hidden this way is neither a survivor nor a kill. `report.md` lists only the count; find the locations in `reports/mutation/mutation.json`, where each such mutant has `status: "RuntimeError"` under `files[<path>].mutants` with its `location` and `statusReason`, or filter by status in the HTML report.

Example: `packages/react-utils/src/store/store/flush.ts` `walkMount`, the `return false` in the `node.mountCount === 0` branch mutated to `return true`. With the tooling bug bypassed, its status is `Timeout`.

Re-check this after any lockfile change that affects `@stryker-mutator/*` or `vitest` (`pnpm-workspace.yaml` pins `vitest` and `@vitest/*`, and ranges `@stryker-mutator/*` with `^`). Remove this section and its bullet under "Report counts and survivors" once the example mutant reports `Timeout` instead of `RuntimeError`.

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
