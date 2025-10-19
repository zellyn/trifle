module github.com/zellyn/trifle

go 1.25.2

// IMPORTANT: modernc.org/sqlite has a fragile dependency on modernc.org/libc.
// Always use the EXACT same version of modernc.org/libc as specified in
// modernc.org/sqlite's go.mod. Do NOT upgrade libc independently!
// See: https://gitlab.com/cznic/sqlite/-/issues/177
// Current pairing: sqlite@v1.39.1 requires libc@v1.66.10

require (
	github.com/pressly/goose/v3 v3.26.0
	golang.org/x/oauth2 v0.32.0
	modernc.org/sqlite v1.39.1
)

require (
	cloud.google.com/go/compute/metadata v0.3.0 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/sethvargo/go-retry v0.3.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/exp v0.0.0-20250620022241-b7579e27df2b // indirect
	golang.org/x/sync v0.16.0 // indirect
	golang.org/x/sys v0.36.0 // indirect
	modernc.org/libc v1.66.10 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)
