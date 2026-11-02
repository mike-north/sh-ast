---
'sh-ast': patch
---

Restore wire byte values in the JSON parser's owned records and arrays instead of
allocating a second syntax tree. Public syntax values, byte preservation, and
bridge validation remain unchanged.
