package namegen

import (
	"strings"
	"testing"
)

func TestGenerate(t *testing.T) {
	// Generate several names to test
	names := make(map[string]bool)

	for i := 0; i < 100; i++ {
		name, err := Generate()
		if err != nil {
			t.Fatalf("Generate() failed: %v", err)
		}

		// Check format
		parts := strings.Split(name, "-")
		if len(parts) != 2 {
			t.Errorf("Expected name in format 'adjective-noun', got: %s", name)
		}

		// Check that adjective is in our list
		adj := parts[0]
		found := false
		for _, a := range adjectives {
			if a == adj {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Adjective %q not found in adjectives list", adj)
		}

		// Check that noun is in our list
		noun := parts[1]
		found = false
		for _, n := range nouns {
			if n == noun {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Noun %q not found in nouns list", noun)
		}

		names[name] = true
	}

	// With 100 iterations and 64 adjectives × 64 nouns = 4096 combinations,
	// we should see some variety (not all the same)
	if len(names) < 50 {
		t.Errorf("Expected more variety in names, only got %d unique names out of 100", len(names))
	}

	t.Logf("Generated %d unique names out of 100 attempts", len(names))

	// Show a few examples
	count := 0
	for name := range names {
		if count < 5 {
			t.Logf("Example: %s", name)
			count++
		}
	}
}
