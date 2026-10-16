Find behaviour this change breaks for callers and users who already depend on it.

Start from what changed (use the git tool for the diff), then follow every caller, consumer and stored record of the changed code.

Look for:
- Changed signatures, return shapes, defaults, error types or status codes that a caller still expects in the old form.
- Renamed or removed fields, routes, events, config keys or environment variables that something else still reads.
- Data already stored in the old shape: rows, cache entries, queued jobs, serialized payloads, files.
- Ordering and timing: work that moved earlier, later, into a queue or out of a transaction.
- Behaviour that was accidental but relied on: a side effect, an implicit sort, a lenient parse.
- Tests that were edited to pass instead of the code being kept compatible.

For each finding give:
- severity: critical, high, medium or low
- confidence: high, medium or low
- what changed: file:line, before and after
- who breaks: the caller, consumer or stored data, with file:line
- evidence: why the old expectation no longer holds
- smallest fix, or the migration it needs
- test: a scenario that passes before the change and fails after

End with the callers and consumers you checked and found unaffected.
