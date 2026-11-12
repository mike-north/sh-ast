---
'sh-ast': minor
---

Parse long flat command chains and arithmetic expressions that were refused before. Lists joined by `&&` or `||`, pipelines, and flat arithmetic expressions such as `1 + 1 + … + 1` used to count one nesting level per operator, so `parseSync` and `parseWithPositionsSync` threw `ShParseMaxDepthError` after about 127 links. They now parse, walk and print at any length, including the thousands of chained commands common in generated scripts and install steps.

Genuine nesting is limited exactly as before: subshells, `$( )` substitutions, parameter expansions, arithmetic parentheses and command bodies are still refused at 128 levels, including inside or around a long chain. Sequences the grammar nests (`elif` ladders, `&&` and `||` inside `[[ ]]`, and right-associative arithmetic) still count one level per link.

Before upgrading, make sure every piece of your code that walks trees can handle long chains. A chain is a left-nested tree, so a traversal that recurses once per node goes one level deeper per link. On a chain of a few thousand commands, which sh-ast refused before and now returns, such a traversal overflows the JavaScript stack with a `RangeError`. Walk trees with the package's own `walk`, or replace the recursion with an explicit stack. `walk` and `printSync` handle long chains. `structuredClone` and `JSON.stringify` recurse inside the JavaScript engine and throw `RangeError` on very long chains; the README gives the figures.

`parseWithPositionsSync` now records the start of a long arithmetic chain once instead of once per operator, so its cost grows linearly with the chain.

Uses the maintained Go syntax fork at revision 38f23b706eb32d08a3797af4ea90a9ea8e5992c1 (based on mvdan/sh v3.14.1).
