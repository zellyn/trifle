package db

import (
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

// TestSQLiteLibcVersionMatch ensures that the versions of modernc.org/sqlite
// and modernc.org/libc match the pairing required by sqlite's go.mod.
// This prevents the fragile dependency issue described in:
// https://gitlab.com/cznic/sqlite/-/issues/177
func TestSQLiteLibcVersionMatch(t *testing.T) {
	// Get the version of sqlite that sqlite requires for libc
	cmd := exec.Command("go", "mod", "graph")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to run 'go mod graph': %v\nOutput: %s", err, output)
	}

	// Parse the module graph to find what version of libc that sqlite requires
	// Line format: "modernc.org/sqlite@vX.Y.Z modernc.org/libc@vA.B.C"
	re := regexp.MustCompile(`modernc\.org/sqlite@(v[\d.]+)\s+modernc\.org/libc@(v[\d.]+)`)
	matches := re.FindStringSubmatch(string(output))

	if len(matches) < 3 {
		t.Fatalf("Could not find modernc.org/sqlite -> modernc.org/libc dependency in go mod graph.\nOutput:\n%s", output)
	}

	sqliteVersion := matches[1]
	requiredLibcVersion := matches[2]

	// Get our actual libc version
	cmd = exec.Command("go", "list", "-m", "-f", "{{.Version}}", "modernc.org/libc")
	output, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to get modernc.org/libc version: %v\nOutput: %s", err, output)
	}

	actualLibcVersion := strings.TrimSpace(string(output))

	// Compare versions
	if actualLibcVersion != requiredLibcVersion {
		t.Errorf(
			"VERSION MISMATCH: modernc.org/libc version does not match what modernc.org/sqlite requires!\n\n"+
				"modernc.org/sqlite version: %s\n"+
				"Required modernc.org/libc version: %s\n"+
				"Actual modernc.org/libc version: %s\n\n"+
				"To fix this issue:\n"+
				"  1. Run: go get modernc.org/libc@%s\n"+
				"  2. Update the comment in go.mod with the new pairing\n\n"+
				"See: https://gitlab.com/cznic/sqlite/-/issues/177\n",
			sqliteVersion,
			requiredLibcVersion,
			actualLibcVersion,
			requiredLibcVersion,
		)
	} else {
		t.Logf("✓ Version match OK: modernc.org/sqlite@%s requires modernc.org/libc@%s (actual: %s)",
			sqliteVersion, requiredLibcVersion, actualLibcVersion)
	}
}

