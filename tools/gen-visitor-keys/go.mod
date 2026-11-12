module sh-ast-gen-visitor-keys

go 1.26.10

require (
	golang.org/x/mod v0.38.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/tools v0.48.0 // indirect
	mvdan.cc/sh/v3 v3.14.1 // indirect
)

// Inspect the same immutable Go fork source that supplies the WASM syntax implementation.
replace mvdan.cc/sh/v3 => github.com/mike-north/sh/v3 v3.14.2-0.20261112073653-38f23b706eb3
