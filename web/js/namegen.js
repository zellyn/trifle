/**
 * namegen.js - Random display name generator for anonymous users
 *
 * Generates adjective-noun combinations like "dapper-panda" or "jolly-tiger"
 * for use as temporary display names in the Trifle playground.
 *
 * Uses the same word lists as the Go backend for consistency.
 *
 * @example
 * // Generate a random name
 * const name = generateName();
 * console.log(name); // "intrepid-dolphin"
 *
 * @example
 * // Generate deterministic name for testing
 * const name1 = generateName(12345);
 * const name2 = generateName(12345);
 * console.log(name1 === name2); // true
 *
 * @example
 * // Get word lists for UI customization
 * const adjectives = getAdjectives();
 * const nouns = getNouns();
 * console.log(`Can generate ${adjectives.length * nouns.length} unique names`);
 */

/**
 * List of adjectives with a Victorian/19th century literary flavor
 * Matches the Go backend word list in internal/namegen/namegen.go
 */
const ADJECTIVES = [
  "dapper", "jolly", "keen", "clever", "bold", "wise", "gallant", "stalwart",
  "intrepid", "valiant", "earnest", "sprightly", "hale", "robust", "jaunty", "plucky",
  "bonny", "dashing", "stout", "resolute", "steadfast", "vigilant", "mirthful", "sanguine",
  "blithe", "jovial", "genial", "affable", "prudent", "sagacious", "wily", "canny",
  "astute", "dauntless", "undaunted", "comely", "winsome", "droll", "whimsical", "fanciful",
  "industrious", "diligent", "urbane", "refined", "courteous", "genteel", "spirited", "animated",
  "vivacious", "formidable", "redoubtable", "singular", "peculiar", "quaint", "ardent", "fervent",
  "hearty", "merry", "noble", "bright", "brisk", "capable", "worthy", "able",
];

/**
 * List of animal nouns
 * Matches the Go backend word list in internal/namegen/namegen.go
 */
const NOUNS = [
  "panda", "tiger", "eagle", "dolphin", "falcon", "turtle", "penguin", "raccoon",
  "otter", "badger", "raven", "lynx", "beaver", "coyote", "gecko", "hamster",
  "iguana", "jaguar", "koala", "lemur", "monkey", "narwhal", "owl", "parrot",
  "quail", "rabbit", "salmon", "toucan", "unicorn", "viper", "walrus", "yak",
  "zebra", "alpaca", "bison", "camel", "dragonfly", "elephant", "flamingo", "giraffe",
  "hedgehog", "ibex", "jellyfish", "kangaroo", "llama", "meerkat", "nautilus", "octopus",
  "platypus", "quokka", "starfish", "tapir", "urchin", "vulture", "wombat", "axolotl",
  "butterfly", "chameleon", "firefly", "hummingbird", "mantis", "peacock", "seahorse", "sparrow",
];

/**
 * Simple seeded random number generator (Linear Congruential Generator)
 * Based on Numerical Recipes algorithm
 *
 * @param {number} seed - Integer seed value
 * @returns {function(): number} Function that returns random numbers between 0 and 1
 */
function createSeededRandom(seed) {
  let current = seed % 2147483647;
  if (current <= 0) current += 2147483646;

  return function() {
    current = (current * 16807) % 2147483647;
    return (current - 1) / 2147483646;
  };
}

/**
 * Generate a random display name
 *
 * @param {number} [seed] - Optional seed for deterministic generation (useful for testing)
 * @returns {string} A random name in "adjective-noun" format
 *
 * @example
 * generateName(); // "intrepid-dolphin"
 * generateName(12345); // Always returns same name for same seed
 */
export function generateName(seed) {
  const random = seed !== undefined
    ? createSeededRandom(seed)
    : Math.random;

  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];

  return `${adjective}-${noun}`;
}

/**
 * Get the list of adjectives
 * Useful for UI customization or displaying word lists to users
 *
 * @returns {string[]} Array of adjective strings
 *
 * @example
 * const adjectives = getAdjectives();
 * console.log(`${adjectives.length} adjectives available`);
 */
export function getAdjectives() {
  return [...ADJECTIVES];
}

/**
 * Get the list of nouns
 * Useful for UI customization or displaying word lists to users
 *
 * @returns {string[]} Array of noun strings
 *
 * @example
 * const nouns = getNouns();
 * console.log(`${nouns.length} nouns available`);
 */
export function getNouns() {
  return [...NOUNS];
}

/**
 * Re-roll a name - convenience function that generates a new random name
 * Equivalent to calling generateName() without a seed
 *
 * @returns {string} A new random name
 *
 * @example
 * const firstTry = generateName();
 * const secondTry = rerollName(); // Different name
 */
export function rerollName() {
  return generateName();
}

/**
 * Get statistics about the name generator
 *
 * @returns {object} Statistics including total combinations possible
 *
 * @example
 * const stats = getStats();
 * console.log(`Can generate ${stats.totalCombinations} unique names`);
 */
export function getStats() {
  return {
    adjectiveCount: ADJECTIVES.length,
    nounCount: NOUNS.length,
    totalCombinations: ADJECTIVES.length * NOUNS.length
  };
}
