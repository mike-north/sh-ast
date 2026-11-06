// Command verify-source checks the selected replacement module's cached source
// with Go's own module checksum algorithm. go mod verify walks original module
// paths and does not verify a remotely replaced module under its replacement
// path, even though compilation reads that replacement's expanded directory.
package main

import (
	"flag"
	"fmt"
	"os"

	"golang.org/x/mod/sumdb/dirhash"
)

func main() {
	directory := flag.String("dir", "", "expanded source directory selected by Go")
	archive := flag.String("zip", "", "downloaded Go module archive")
	module := flag.String("module", "", "replacement module path")
	version := flag.String("version", "", "immutable replacement version")
	expected := flag.String("sum", "", "Go content checksum from the verified module graph")
	flag.Parse()
	if *directory == "" || *archive == "" || *module == "" || *version == "" || *expected == "" || flag.NArg() != 0 {
		fail("all source identity arguments are required")
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
