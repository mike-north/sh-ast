---
'sh-ast': patch
---

Document and test ordinary structuredClone as the supported way to make independent editable copies of parsed syntax subtrees. Preserve byte strings, typed-nil records, internal aliases and original position values while keeping copied node identities separate from parse-time snapshots and retaining each operation's existing input limits.
