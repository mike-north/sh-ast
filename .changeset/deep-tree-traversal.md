---
'sh-ast': patch
---

Traverse syntax trees without recursion. `walk`, the record validation and wire encoding behind `printSync` and `splitBraces`, and the position bookkeeping for comment placement now keep pending work on an explicit stack instead of recursing once per tree level. A hand-built tree with a long left-nested chain of commands or arithmetic terms (10,000 links and more) is walked, validated and encoded without overflowing the JavaScript stack. Visit order, results, errors and output bytes are unchanged. The Go shim writes, validates and reads syntax records the same way, and accepts print requests nested deeper than `encoding/json` allows. Printing a tree that deep is still limited by the upstream printer.
