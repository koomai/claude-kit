Find mismatches between what one side of an interface produces and what the other side consumes.

Pair each producer with its consumers: API endpoint and client, event and listener, job and dispatcher, schema and query, config and reader, component and its props.

Look for:
- Field names, casing, nesting or types that differ between the two sides.
- Optional on one side and required on the other; null, empty and missing treated differently.
- Enum or status values one side sends and the other does not handle.
- Units, time zones, encodings, pagination and sort order assumed differently.
- Error and empty responses the consumer never handles.
- Validation rules that differ between client and server.
- Documentation or types that describe a shape the code no longer produces.

Read both sides before you report; a mismatch needs a line on each side.

For each finding give:
- severity: critical, high, medium or low
- confidence: high, medium or low
- producer: file:line and what it emits
- consumer: file:line and what it expects
- failure: the input or state where the two diverge, and what happens
- smallest fix, and which side should change
- test: a contract check that would catch it

End with the interfaces you compared and found consistent.
