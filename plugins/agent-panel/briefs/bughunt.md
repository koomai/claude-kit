Hunt for real correctness bugs and the missing tests that would let them back in.

Look for:
- Logic errors: wrong conditions, off-by-one, wrong defaults, unhandled null or empty values.
- Boundary and error paths: empty input, largest and smallest values, partial failure, missing cleanup or rollback.
- Contract gaps: unchecked input, a caller and a callee that disagree about a type or a return value.
- Order and concurrency: races, check-then-act, shared mutable state, async steps that can interleave.
- Resource lifecycle: handles, locks and listeners that are not released, errors swallowed in cleanup.
- Risky branches with no test: error handlers, retries, fallbacks, migrations.

Prefer failures a user would see and bugs with a wide blast radius. Skip style unless it hides a correctness bug.

For each finding give:
- severity: critical, high, medium or low
- confidence: high, medium or low
- location: file:line and the function
- evidence: the code and the input or sequence that makes it fail
- impact: what the user or the system sees
- smallest fix
- test: a failing scenario, with inputs and the expected result

End with what you looked at and found clean, so the next reader does not repeat it.
