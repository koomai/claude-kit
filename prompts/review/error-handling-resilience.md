# EHR — Error Handling & Resilience

Review the current change for unhandled, invisible, or half-done failure: missing failure paths, swallowed errors, retry and timeout gaps, partial-failure states.

---

Review the current change — the uncommitted diff and this branch's commits, not the whole codebase — for one thing only: failure that is unhandled, invisible, or leaves the system half-done. Code that assumes the happy path, where an ordinary failure would corrupt state, strand a record, or vanish without a trace.

Look for:
- An operation that can fail (network, database, filesystem, external API, queue) with no failure path at all.
- Swallowed errors: log-and-continue when the caller needed to know, or a catch-all that hides programmer errors alongside expected ones.
- Remote calls with no timeout; retries without idempotency; retry-forever with no attempt cap, backoff, or dead-letter.
- Partial-failure states: multi-step writes with no transaction or compensation, so a crash mid-sequence leaves inconsistent data.
- Check-then-act races: two concurrent requests both pass the guard and both write, with no lock, atomic update, or unique constraint as the backstop.
- Failure reported as success: empty result conflated with error, 200 with an error body, a job that "completes" after skipping the work.
- External responses trusted without checking shape or status, so a partner change becomes a silent data bug.
- Errors that carry no context to diagnose with — no ids, no input summary, no cause chain — or logged at a level nobody watches.
- Resources not released on the failure path: locks, temp files, open transactions, reserved inventory.
- Re-delivery semantics: what happens when a job or message is processed twice, out of order, or is a poison message.
- What the user sees when it fails: a clear error, or a spinner forever and a half-saved form.

Do not wrap everything in try/catch. Prefer letting unexpected errors propagate to a boundary that already handles and reports them. Be skeptical of resilience theatre — retries on operations that cannot succeed on retry, circuit breakers with no recovery story, handling that adds states without making any failure survivable.

Trace, don't assume: for every call, write, and assumption in the touched code, say what happens today when it fails and who finds out.

If a fix is clear, low-risk, and inside the current task's scope, make it and run the relevant checks. Otherwise do not implement it; return a recommendation.

Return:
1. Verdict: `implement`, `recommend`, or `skip`.
2. Gap: the concrete unhandled failure or half-done state, or `none`.
3. Why: the incident it would cause and how it would surface (silent corruption, stuck record, invisible outage, lost work).
4. Scope: the smallest credible change and its risk (behavior change for existing callers, duplicate side effects from new retries).
5. Validation: checks run, or the checks that would be needed.
