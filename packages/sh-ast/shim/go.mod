module eslint-sh-shim

go 1.26.10

require mvdan.cc/sh/v3 v3.14.1

// Syntax corrections live in the maintained Go fork; schema and WASM use this immutable source.
replace mvdan.cc/sh/v3 => github.com/mike-north/sh/v3 v3.14.2-0.20261112073653-38f23b706eb3
