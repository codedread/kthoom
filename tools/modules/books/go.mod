module github.com/codedread/kthoom/tools/modules/books

go 1.16

replace github.com/codedread/kthoom/tools/modules/archives => ../archives

require (
	github.com/codedread/kthoom/tools/modules/archives v0.0.0-00010101000000-000000000000
	golang.org/x/net v0.7.0
)
