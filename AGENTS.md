React

To write Storybook stories, always use Next Story Format (NSF).

Code and reviews follow [CODING_STANDARDS.md](CODING_STANDARDS.md).

UI work in `apps/web` follows the Astryx rules in [apps/web/AGENTS.md](apps/web/AGENTS.md).

In the store runtime (`packages/react-utils/src/store/store/`), do not handle exceptions thrown by user-supplied functions (getters, setters, `onMount`, effects, cleanups, subscriber callbacks, etc.), and do not add code to keep such a throw from disrupting the process. This is deliberately left for later.

## Mutation testing the store runtime

Mutation testing is task-level validation, not a per-commit requirement. Run it for tasks that change store runtime behavior, tests in Stryker's unit suite, or mutation-testing configuration. Skip unrelated tasks and documentation-only or formatting-only changes. Do not add the run to the pre-commit hook or `vp run verify`. Read [docs/mutation-testing.md](docs/mutation-testing.md) before running Stryker or touching a suppression. Quote mutation counts and survivor locations from the generated report (see "Report counts and survivors" there), not from memory.
