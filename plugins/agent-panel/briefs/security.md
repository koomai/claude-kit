Find exploitable security flaws, not theoretical ones.

Look for:
- Authorization: an action or record reachable without the right role, owner check or tenant scope.
- Authentication and sessions: bypasses, weak resets, tokens that do not expire or are not bound to a user.
- Injection: SQL, shell, template, path or header input that reaches an interpreter unescaped.
- Data exposure: secrets, tokens or personal data in responses, logs, errors or client bundles.
- Request forgery and redirects: state-changing requests without origin checks, server-side fetches of user URLs, open redirects.
- Unsafe defaults: debug modes, wide CORS, permissive file uploads, mass assignment.

Trace each finding from the attacker's input to the sink. A flaw you cannot reach from outside is a hardening note, not a finding.

For each finding give:
- severity: critical, high, medium or low
- confidence: high, medium or low
- location: file:line for the entry point and for the sink
- attack: who can do it, the request or input they send, and what they gain
- evidence: the code path, step by step
- smallest fix
- test: a request that must be refused once fixed

End with the entry points you examined and found sound.
