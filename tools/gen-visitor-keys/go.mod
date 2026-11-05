module sh-ast-gen-visitor-keys

go 1.26.10

require (
	golang.org/x/mod v0.38.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/tools v0.48.0 // indirect
	mvdan.cc/sh/v3 v3.13.1 // indirect
)

// Inspect the exact parser source used by the WASM shim, including its documented corrections.
replace mvdan.cc/sh/v3 => ../../third_party/mvdan-sh/upstream
