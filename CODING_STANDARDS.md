# Coding standards

Judgement rules that lint cannot check. Reviewers apply them; cite the rule when raising a finding.

## Tests

### Parameterised tests

`it.each` rows supply data: inputs and expected results, such as expected events.

- The test body may branch on a row value only to build inputs. Every row runs the same steps and makes the same assertions.
- If rows need different steps or assert different contracts, split them into separate named tests.
- Never loop over a case table inside one `it`. A loop stops at the first failure and hides the later cases. Use `it.each` instead.

### Naming

Name test helpers, handles and `describe` blocks by their role in the runtime, never by the task or survivor that motivated them: a factory is named for what it creates, a handle that undoes a mount is `unmount*`, one that undoes a subscription is `unsubscribe*`, and one that undoes either is `dispose*` (never an ordinal or `again`). Collections of such handles and helpers that call them also use `dispose*` (`disposers`, `disposeAll`), and a spy that records a cleanup is `cleanup*`, and a `describe` names the runtime concept it exercises.
