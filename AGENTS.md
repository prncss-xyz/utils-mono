React

To write Storybook stories, always use Next Story Format (NSF).

UI work in `apps/web` follows the Astryx rules in [apps/web/AGENTS.md](apps/web/AGENTS.md).

In the store runtime (`packages/react-utils/src/store/runtime/`), do not handle exceptions thrown by user-supplied functions (getters, setters, `onMount`, effects, cleanups, subscriber callbacks, etc.), and do not add code to keep such a throw from disrupting the process. This is deliberately left for later.
