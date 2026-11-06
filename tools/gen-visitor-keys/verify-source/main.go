// Command verify-source checks the selected replacement module's cached source
// with Go's own module checksum algorithm. go mod verify walks original module
// paths and does not verify a remotely replaced module under its replacement
// path, even though compilation reads that replacement's expanded directory.
// The expected checksums are independent repository identity pins, not values
// inferred from the mutable cache or consumer go.sum files being inspected.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"golang.org/x/mod/sumdb/dirhash"
)

func main() {
	directory := flag.String("dir", "", "expanded source directory selected by Go")
	archive := flag.String("zip", "", "downloaded Go module archive")
	module := flag.String("module", "", "replacement module path")
	version := flag.String("version", "", "immutable replacement version")
	expected := flag.String("sum", "", "review-owned Go source content checksum")
	goMod := flag.String("go-mod", "", "downloaded module metadata file")
	goModSum := flag.String("go-mod-sum", "", "review-owned Go module metadata checksum")
	flag.Parse()
	if *directory == "" || *archive == "" || *module == "" || *version == "" || *expected == "" || *goMod == "" || *goModSum == "" || flag.NArg() != 0 {
		fail("all source identity arguments are required")
	}
	// Go hashes a module's separately cached .mod file as a single go.mod entry.
	// Check those actual bytes too, rather than trusting a reported GoModSum.
	modHash, err := dirhash.Hash1([]string{"go.mod"}, func(string) (io.ReadCloser, error) {
		return os.Open(*goMod)
	})
	if err != nil {
		fail("hash module metadata: %v", err)
	}
	if modHash != *goModSum {
		fail("go.mod has been modified: got %s, want %s", modHash, *goModSum)
	}
	zipped, err := dirhash.HashZip(*archive, dirhash.DefaultHash)
	if err != nil {
		fail("hash module archive: %v", err)
	}
	if zipped != *expected {
		fail("module archive has been modified: got %s, want %s", zipped, *expected)
	}
	expanded, err := dirhash.HashDir(*directory, *module+"@"+*version, dirhash.DefaultHash)
	if err != nil {
		fail("hash expanded source: %v", err)
	}
	if expanded != *expected {
		fail("expanded source has been modified: got %s, want %s", expanded, *expected)
	}
}

// fail makes integrity refusal visible to the invoking build gate without
// converting a corrupted source cache into an apparently successful build.
func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "verify-source: "+format+"\n", args...)
	os.Exit(1)
}
