---
'sh-ast': patch
---

Reduce parse-with-positions transport overhead by collecting node occurrences during syntax encoding and sending compact position tuples with sparse errors. Preserve snapshot identity, original-source coordinates, independent upstream failures, and public API behavior.
