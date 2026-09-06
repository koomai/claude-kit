# TQ — Test Quality

Review the current change for test gaps, over-mocking, or brittle assertions that give false confidence.

---

Review the current change — the uncommitted diff and this branch's commits, not the whole codebase — for one thing only: tests that give false confidence. A behavior change that would ship without any test going red, or a test that would break without any behavior changing.

Look for:
- A branch, guard, or error path no test exercises — especially the unhappy paths.
- A mock or fake standing in for the thing the test claims to verify, so the test passes when the real integration is broken.
- Assertions on incidental output (exact strings, ordering, counts) instead of the contract.
- Assertions that a mock was called, instead of that the outcome happened.
- A test with no meaningful assertion — it only proves the code runs without throwing.
- A test that passes for the wrong reason: the assertion is never reached, the loop iterates zero times, the expected exception is thrown earlier than intended.
- Asserting the response but not the side effect — the row written, the event fired, the job queued, the mail sent — or vice versa.
- Coverage at the wrong layer: the unit is tested but the route, middleware, validation, or serialization it sits behind is not.
- Fixtures that encode one blessed scenario and hide the boundaries: empty, one, many, duplicates, soft-deleted, missing owner, wrong tenant.
- Setup duplicated across tests instead of a factory state, builder, or shared fixture that names the scenario.
- A missing seam: logic buried in a controller, job, closure, or static call that forces tests through heavy machinery to reach it.
- Dependence on wall-clock time, randomness, execution order, or leftover state from another test.
- A test name that does not say which behavior would be broken if it failed.

Do not force coverage. Prefer fewer, stronger tests over exhaustive permutations. Be skeptical of tests that restate the implementation line by line — deleting one of those is a cleanup too.

Trace, don't assume: for each new branch or contract, name the test that would go red if it regressed. If you cannot, that is the gap. Where cheap, break the code deliberately and confirm a test fails.

If a fix is clear, low-risk, and inside the current task's scope, make it and run the affected suite. Otherwise do not implement it; return a recommendation.

Return:
1. Verdict: `implement`, `recommend`, or `skip`.
2. Gap: the concrete untested risk or brittle test, or `none`.
3. Why: the regression it would let through, or the harmless change it would block.
4. Scope: the smallest credible test change, and its cost (runtime, fixtures touched, flakiness potential).
5. Validation: the suite or filter run, or the run that would be needed.
