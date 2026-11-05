module eslint-sh-shim

go 1.26.10

require mvdan.cc/sh/v3 v3.13.1

// v3.13.1 with the official Unicode sentinel correction; see the replacement's README.
replace mvdan.cc/sh/v3 => ../../../third_party/mvdan-sh/upstream
