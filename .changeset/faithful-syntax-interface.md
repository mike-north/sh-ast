---
'sh-ast': minor
---

Expose a faithful synchronous interface to mvdan/sh v3.13.1, preserving upstream fields, explicit defaults and nulls, byte strings, token positions, operator families, parser controls, and partial error results. First use remains synchronous. Node bounds are computed from current mutable records. `parseWithPositionsSync` provides a separate immutable snapshot of original node bounds for source consumers, with no per-node WASM calls.

This 0.x migration replaces normalized lowercase nodes and UTF-16 ranges with upstream syntax records and byte positions; consumers own their presentation adapters. KeepComments now follows the upstream false default. Analysis helpers consume the new records. Public traversal and printing remain deferred to the following minor release.
