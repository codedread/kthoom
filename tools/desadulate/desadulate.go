/**
 * desadulate.go
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2021 Google Inc.
 */

// This pipeline makes a "better" version of a comic book or epub file.
package main

import (
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/codedread/kthoom/tools/modules/archives"
	"github.com/codedread/kthoom/tools/modules/books/comic"
	"github.com/codedread/kthoom/tools/modules/books/epub"
	"github.com/codedread/kthoom/tools/modules/books/metadata"
	"github.com/codedread/kthoom/tools/modules/images"
)

var inpath string
var outpath string
var infile string

var caseSensitiveSort bool
var slobMode bool
var verboseMode bool
var webpMode bool

var outfile string

var allowedExtensions = []string{
	".cbr",
	".cbz",
	".epub",
}

// TODO: Fail if inpath === outpath?

func checkExecutables() {
	var err error
	commands := []string{"unrar", "unzip", "zip"}
	for _, cmd := range commands {
		_, err = exec.LookPath(cmd)
		if err != nil {
			log.Fatalf("Error: Cannot find executable '%s'\n", cmd)
		}
	}
}

func parseCommandLineFlags() {
	flag.StringVar(&inpath, "i", "", "Base path of the input directory (required)")
	flag.StringVar(&infile, "f", "", "Path of the input file relative to the input directory (required)")
	flag.StringVar(&outpath, "o", "", "Base path to the output directory (required)")
	flag.BoolVar(&caseSensitiveSort, "cs", false, "Case-sensitive sorting of filenames (optional)")
	flag.BoolVar(&slobMode, "slob", false, "Do not clean up temporary directory (optional)")
	flag.BoolVar(&verboseMode, "v", false, "Verbose mode (optional)")
	flag.BoolVar(&webpMode, "webp", false, "Convert images to webp format (optional)")
	flag.Parse()

	if inpath == "" {
		flag.PrintDefaults()
		log.Fatalf("Error:  Invalid -i flag usage")
	}

	if outpath == "" {
		flag.PrintDefaults()
		log.Fatalf("Error:  Invalid -o flag usage")
	}

	if infile == "" {
		flag.PrintDefaults()
		log.Fatalf("Error:  Invalid -f flag usage")
	}
}

func resolveFilenames() {
	var err error

	inpath, err = filepath.Abs(inpath)
	if err != nil {
		log.Fatalf("Error:  Cannot find absolute path of '%s'\n", inpath)
	}

	outpath, err = filepath.Abs(outpath)
	if err != nil {
		log.Fatalf("Error:  Cannot find absolute path of '%s'\n", outpath)
	}

	outfile = filepath.Join(outpath, infile)
	infile = filepath.Join(inpath, infile)
}

func validateInputFile() error {
	fileStatInfo, err := os.Stat(infile)
	if os.IsNotExist(err) {
		return fmt.Errorf("'%s' does not exist\n", infile)
	}
	if !fileStatInfo.Mode().IsRegular() {
		return fmt.Errorf("'%s' is not a regular file\n", infile)
	}

	ext := filepath.Ext(infile)
	extensionAllowed := false
	for _, allowedExt := range allowedExtensions {
		if allowedExt == ext {
			extensionAllowed = true
			break
		}
	}
	if !extensionAllowed {
		return fmt.Errorf("'%s' is an unknown extension\n", ext)
	}

	return nil
}

func validateOutputPath() error {
	fileStatInfo, err := os.Stat(outpath)
	if os.IsNotExist(err) {
		return fmt.Errorf("'%s' does not exist\n", outpath)
	}
	if !fileStatInfo.Mode().IsDir() {
		return fmt.Errorf("'%s' is not a directory\n", infile)
	}

	return nil
}

func prepareToWriteOutputFile() {
	if _, err := os.Stat(outfile); err == nil {
		err = os.Remove(outfile)
		if err != nil {
			log.Fatalf("Could not delete %s: %v\n", outfile, err)
		} else if verboseMode {
			fmt.Printf("File already existed, deleted %s before re-creating\n", outfile)
		}
	}

	if err := os.MkdirAll(filepath.Dir(outfile), os.ModePerm); err != nil {
		log.Fatalf("Failed to create output directory: %v\n", err)
	} else if verboseMode {
		fmt.Printf("Prepared output final directories\n")
	}
}

func getOutWriter() io.Writer {
	if verboseMode {
		return os.Stdout
	}
	return ioutil.Discard
}

func main() {
	parseCommandLineFlags()
	resolveFilenames()
	checkExecutables()

	if verboseMode {
		fmt.Printf("betterize:  inpath is '%s'\n", inpath)
		fmt.Printf("betterize:  input file is '%s'\n", infile)
		fmt.Printf("betterize:  outpath is '%s'\n", outpath)
		fmt.Printf("betterize:  output file is '%s'\n", outfile)
	}

	if err := validateInputFile(); err != nil {
		log.Fatalf(err.Error())
	} else if verboseMode {
		fmt.Println("betterize:  input file is ok!")
	}

	if err := validateOutputPath(); err != nil {
		log.Fatalf(err.Error())
	} else if verboseMode {
		fmt.Println("betterize:  outpath is ok!")
	}

	relPath := filepath.Dir(outfile)
	if verboseMode {
		fmt.Printf("Output output path is %s\n", relPath)
	}

	theArchive, archiveErr := archives.ExtractArchive(infile, getOutWriter(), os.Stderr)
	if !slobMode {
		defer archives.CleanupArchive(theArchive)
	}

	if archiveErr != nil {
		log.Fatalf(archiveErr.Error())
	} else if verboseMode {
		fmt.Printf("betterize:  Found an archive of type %s\n", theArchive.ArchiveType)
		fmt.Printf("betterize:  temp directory is '%s'\n", theArchive.TmpDir)
	}

	if theArchive.ArchiveType == archives.ComicBook {
		outfile = strings.TrimSuffix(outfile, filepath.Ext(outfile)) + ".cbz"
		outfile = strings.Replace(outfile, " ", "_", -1)
		outfile = strings.Replace(outfile, "(", "", -1)
		outfile = strings.Replace(outfile, ")", "", -1)
		outfile = strings.Replace(outfile, "#", "", -1)
		if verboseMode {
			fmt.Printf("betterize:  outfile rewritten to %s\n", outfile)
		}

		theBook, extractErr := comic.ExtractBookFromArchive(theArchive, getOutWriter(), os.Stderr)
		if extractErr != nil {
			log.Fatalf(extractErr.Error())
		}

		// TODO: Move this optimization stuff into books/comic.
		// TODO: This sorts alphabetically, but some books have bad filenames.  We need to handle special cases here
		// like foo8.jpg, foo9.jpg, foo10.jpg.
		// Sort all page files.
		if caseSensitiveSort {
			sort.Strings(theBook.PageFiles)
		} else {
			// Default is case-insensitive sort.
			sort.Slice(theBook.PageFiles, func(i, j int) bool {
				return strings.ToLower(theBook.PageFiles[i]) < strings.ToLower(theBook.PageFiles[j])
			})
		}

		if webpMode {
			for i, pageFilename := range theBook.PageFiles {
				newPageFilename, convertErr := images.ConvertFileToWebp(pageFilename, getOutWriter(), os.Stderr)
				if convertErr != nil {
					fmt.Fprintf(os.Stderr, "Webp conversion failed with %s/%s, skipping\n", theBook.ArchiveFilename, pageFilename)
					continue
				}

				theBook.PageFiles[i] = newPageFilename
				if verboseMode {
					fmt.Printf("New page filename is %s\n", newPageFilename)
				}
			}
		}

		// Get or create the comic book metadata and optimize it for streaming.
		if theBook.Metadata == nil {
			theBook.Metadata = &comic.ComicInfo{}
		}
		if theBook.Metadata.ArchiveFileInfo == nil {
			theBook.Metadata.ArchiveFileInfo = &metadata.ArchiveFileInfo{}
		}
		theBook.Metadata.ArchiveFileInfo.OptimizedForStreaming = "true"

		prepareToWriteOutputFile()
		comic.CreateArchiveFromBook(theBook, outfile, getOutWriter(), os.Stderr)

		fmt.Printf("betterize:  created %s\n", outfile)
	} else if theArchive.ArchiveType == archives.EPub {
		theBook, extractErr := epub.ExtractBookFromArchive(theArchive, getOutWriter(), os.Stderr)
		if extractErr != nil {
			log.Fatalf(extractErr.Error())
		}

		if theBook == nil {
			log.Fatalf("EPub Book could not be created!\n")
		}

		if orderErr := epub.CreateOrderedBook(theBook, getOutWriter(), os.Stderr); orderErr != nil {
			log.Fatalf("EPub Book encountered an error while ordering: %v\n", orderErr)
		}

		// Update metadata.
		if theBook.Package.ArchiveFileInfo == nil {
			theBook.Package.ArchiveFileInfo = &metadata.ArchiveFileInfo{}
		}
		theBook.Package.ArchiveFileInfo.OptimizedForStreaming = "true"

		// Write it out.
		epub.CreateArchiveFromBook(theBook, outfile, getOutWriter(), os.Stderr)
	}

	if verboseMode {
		fmt.Printf("betterize:  done.\n")
	}
}
