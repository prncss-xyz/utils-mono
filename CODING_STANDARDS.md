# Coding standards

Judgement rules that lint cannot check. Reviewers apply them; cite the rule when raising a finding.

## Tests

### Parameterised tests

`it.each` rows supply data: inputs and expected results, such as expected events.

- The test body may branch on a row value only to build inputs. Every row runs the same steps and makes the same assertions.
- If rows need different steps or assert different contracts, split them into separate named tests.
- Never loop over a case table inside one `it`. A loop stops at the first failure and hides the later cases. Use `it.each` instead.
