package namegen

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

// Lists of adjectives and nouns for generating display names
// Adjectives have a Victorian/19th century literary flavor
var Adjectives = []string{
	"dapper", "jolly", "keen", "clever", "bold", "wise", "gallant", "stalwart",
	"intrepid", "valiant", "earnest", "sprightly", "hale", "robust", "jaunty", "plucky",
	"bonny", "dashing", "stout", "resolute", "steadfast", "vigilant", "mirthful", "sanguine",
	"blithe", "jovial", "genial", "affable", "prudent", "sagacious", "wily", "canny",
	"astute", "dauntless", "undaunted", "comely", "winsome", "droll", "whimsical", "fanciful",
	"industrious", "diligent", "urbane", "refined", "courteous", "genteel", "spirited", "animated",
	"vivacious", "formidable", "redoubtable", "singular", "peculiar", "quaint", "ardent", "fervent",
	"hearty", "merry", "noble", "bright", "brisk", "capable", "worthy", "able",
}

var Nouns = []string{
	"panda", "tiger", "eagle", "dolphin", "falcon", "turtle", "penguin", "raccoon",
	"otter", "badger", "raven", "lynx", "beaver", "coyote", "gecko", "hamster",
	"iguana", "jaguar", "koala", "lemur", "monkey", "narwhal", "owl", "parrot",
	"quail", "rabbit", "salmon", "toucan", "unicorn", "viper", "walrus", "yak",
	"zebra", "alpaca", "bison", "camel", "dragonfly", "elephant", "flamingo", "giraffe",
	"hedgehog", "ibex", "jellyfish", "kangaroo", "llama", "meerkat", "nautilus", "octopus",
	"platypus", "quokka", "starfish", "tapir", "urchin", "vulture", "wombat", "axolotl",
	"butterfly", "chameleon", "firefly", "hummingbird", "mantis", "peacock", "seahorse", "sparrow",
}

// Generate creates a random adjective-noun combination
func Generate() (string, error) {
	adj, err := randomChoice(Adjectives)
	if err != nil {
		return "", err
	}

	noun, err := randomChoice(Nouns)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s-%s", adj, noun), nil
}

// randomChoice selects a random element from a slice using crypto/rand
func randomChoice(items []string) (string, error) {
	if len(items) == 0 {
		return "", fmt.Errorf("empty slice")
	}

	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(items))))
	if err != nil {
		return "", fmt.Errorf("failed to generate random number: %w", err)
	}

	return items[n.Int64()], nil
}
