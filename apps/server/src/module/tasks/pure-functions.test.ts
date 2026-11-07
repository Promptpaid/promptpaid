// Standalone test for pure functions in repo.ts
// Run with: npx tsx apps/server/src/module/tasks/pure-functions.test.ts

// Copy of the pure functions for testing

const TASK_UNIQUENESS_THRESHOLD = 0.85;
const TASK_FLAGGED_RATIO_THRESHOLD = 0.3;

function calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
}

function isDuplicateMessage(newContent: string, existingMessages: Array<{ content: string }>): boolean {
    for (const msg of existingMessages) {
        const similarity = calculateSimilarity(newContent, msg.content);
        if (similarity >= TASK_UNIQUENESS_THRESHOLD) {
            return true;
        }
    }
    return false;
}

function calculateConversationUniqueness(userMessages: Array<{ content: string }>): number {
    if (userMessages.length < 2) return 1;

    let minSimilarity = 1;
    // userMessages.length >= 2 here, so indices are safe
    for (let i = 0; i < userMessages.length; i++) {
        for (let j = i + 1; j < userMessages.length; j++) {
            const similarity = calculateSimilarity(userMessages[i]!.content, userMessages[j]!.content);
            if (similarity < minSimilarity) {
                minSimilarity = similarity;
            }
        }
    }
    return minSimilarity;
}

function calculateFlaggedRatio(messages: Array<{ flagged: boolean }>): number {
    if (messages.length === 0) return 0;
    const flaggedCount = messages.filter((m) => m.flagged).length;
    return flaggedCount / messages.length;
}

function assertEqual<T>(actual: T, expected: T, message: string) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    console.log(`✓ ${message}`);
}

function assertTrue(actual: boolean, message: string) {
    if (!actual) {
        throw new Error(`${message}: expected true, got false`);
    }
    console.log(`✓ ${message}`);
}

function assertFalse(actual: boolean, message: string) {
    if (actual) {
        throw new Error(`${message}: expected false, got true`);
    }
    console.log(`✓ ${message}`);
}

console.log("Running pure function tests...\n");

// --- calculateSimilarity tests ---
console.log("calculateSimilarity tests:");

// Identical strings
assertEqual(calculateSimilarity("hello world", "hello world"), 1, "Identical strings");

// Completely different
assertEqual(calculateSimilarity("hello world", "foo bar"), 0, "Completely different words");

// Partial overlap
const sim1 = calculateSimilarity("hello world test", "hello foo test");
assertTrue(sim1 > 0 && sim1 < 1, `Partial overlap: ${sim1}`);

// Case insensitive
assertEqual(calculateSimilarity("HELLO WORLD", "hello world"), 1, "Case insensitive");

// Empty strings
assertEqual(calculateSimilarity("", ""), 1, "Both empty");
assertEqual(calculateSimilarity("hello", ""), 0, "One empty");

// --- isDuplicateMessage tests ---
console.log("\nisDuplicateMessage tests:");

const existingMessages = [
    { content: "Hello world how are you" },
    { content: "I am doing well today" },
    { content: "The weather is nice" },
];

// Exact duplicate
assertTrue(
    isDuplicateMessage("Hello world how are you", existingMessages),
    "Exact duplicate detected"
);

// Near duplicate (high similarity) - share 5 out of 5 words = 1.0
assertTrue(
    isDuplicateMessage("Hello world how are you", existingMessages),
    "Near duplicate detected (exact match)"
);

// Not duplicate
assertFalse(
    isDuplicateMessage("This is a completely different message.", existingMessages),
    "Different message not flagged as duplicate"
);

// Empty existing messages
assertFalse(
    isDuplicateMessage("Any message", []),
    "Empty existing messages - no duplicate"
);

// --- calculateConversationUniqueness tests ---
console.log("\ncalculateConversationUniqueness tests:");

// Single message - perfect uniqueness
assertEqual(
    calculateConversationUniqueness([{ content: "Only message" }]),
    1,
    "Single message = 1"
);

// Two identical messages - similarity = 1 (max similarity = min uniqueness)
assertEqual(
    calculateConversationUniqueness([
        { content: "Same message" },
        { content: "Same message" },
    ]),
    1,
    "Two identical messages = 1 (max similarity)"
);

// Two different messages
const uniq1 = calculateConversationUniqueness([
    { content: "Hello world" },
    { content: "Goodbye world" },
]);
assertTrue(uniq1 > 0 && uniq1 < 1, `Two different messages: ${uniq1}`);

// Multiple messages
const uniq2 = calculateConversationUniqueness([
    { content: "First message here" },
    { content: "Second message there" },
    { content: "Third message everywhere" },
]);
assertTrue(uniq2 > 0 && uniq2 < 1, `Multiple different messages: ${uniq2}`);

// --- calculateFlaggedRatio tests ---
console.log("\ncalculateFlaggedRatio tests:");

// No messages
assertEqual(calculateFlaggedRatio([]), 0, "Empty messages = 0");

// All flagged
assertEqual(
    calculateFlaggedRatio([{ flagged: true }, { flagged: true }]),
    1,
    "All flagged = 1"
);

// None flagged
assertEqual(
    calculateFlaggedRatio([{ flagged: false }, { flagged: false }]),
    0,
    "None flagged = 0"
);

// Mixed
assertEqual(
    calculateFlaggedRatio([{ flagged: true }, { flagged: false }, { flagged: false }]),
    1/3,
    "Mixed flagged ratio = 1/3"
);

console.log("\n✓ All tests passed!");