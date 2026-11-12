React

To write Storybook stories, always use Next Story Format (NSF).

Code and reviews follow [CODING_STANDARDS.md](CODING_STANDARDS.md).

UI work in `apps/web` follows the Astryx rules in [apps/web/AGENTS.md](apps/web/AGENTS.md).

In the store runtime (`packages/react-utils/src/store/store/`), do not handle exceptions thrown by user-supplied functions (getters, setters, `onMount`, effects, cleanups, subscriber callbacks, etc.), and do not add code to keep such a throw from disrupting the process. This is deliberately left for later.

## Mutation testing the store runtime

Read [docs/mutation-testing.md](docs/mutation-testing.md) when a task changes store runtime behavior, changes any test in `packages/react-utils`, changes mutation-testing configuration, or touches a Stryker suppression, and before running Stryker or quoting mutation results. It says whether a run is required.
