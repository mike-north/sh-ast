// Command repack-module constructs a coherent altered module-cache fixture using
// Go's canonical module ZIP writer and checksum algorithm. Tests use only copied
// caches; this fixture cannot alter the published module or a shared Go cache.
package main

import (
	"fmt"
	"os"

	"golang.org/x/mod/module"
	"golang.org/x/mod/sumdb/dirhash"
	"golang.org/x/mod/zip"
)

func main() {
	if len(os.Args) != 5 {
		panic("expected copied source directory, archive, module path and version")
	}
	archive, err := os.Create(os.Args[2])
	if err != nil {
		panic(err)
	}
	if err := zip.CreateFromDir(archive, module.Version{Path: os.Args[3], Version: os.Args[4]}, os.Args[1]); err != nil {
		panic(err)
	}
	if err := archive.Close(); err != nil {
		panic(err)
	}
	sum, err := dirhash.HashZip(os.Args[2], dirhash.DefaultHash)
	if err != nil {
		panic(err)
	}
	fmt.Println(sum)
}
