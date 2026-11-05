module eslint-sh-shim

go 1.26.10

require mvdan.cc/sh/v3 v3.13.1

// v3.13.1 with maintained Unicode and comment-iteration corrections; see the replacement's README.
replace mvdan.cc/sh/v3 => ../../../third_party/mvdan-sh/upstream
