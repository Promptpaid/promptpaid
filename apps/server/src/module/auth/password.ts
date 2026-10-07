import { hash, verify, type Options } from "@node-rs/argon2";

/**
 * Explicit Argon2id options.
 *
 * OWASP minimum for Argon2id:
 * - Memory: 19456 KiB (19 MiB)
 * - Iterations: 2
 * - Parallelism: 1
 *
 * The library defaults are different:
 * - memoryCost: 65536 (64 MiB)  → higher than OWASP minimum, but still set explicitly
 * - timeCost: 3                 → higher than OWASP minimum
 * - parallelism: 4              → higher than OWASP minimum
 * - algorithm: Argon2id   → already Argon2id by default, but set explicitly
 *
 * Do not rely on defaults. Pin the values below.
 */
const ARGON2_OPTIONS: Options = {
    algorithm: 2,          // Algorithm.Argon2id (ambient const enum can't be imported under verbatimModuleSyntax)
    memoryCost: 19456,     // 19 MiB in KiB
    timeCost: 2,           // 2 iterations
    parallelism: 1,        // 1 degree of parallelism
    outputLen: 32,         // 32-byte output
    // salt is generated automatically if not provided
};

/**
 * Hash a plaintext password.
 *
 * Returns a PHC-encoded string, e.g.:
 * $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 */
export async function hashPassword(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * A valid Argon2id hash with the same options as above, used to run a
 * password check when the email is unknown so response times do not
 * reveal whether an account exists.
 */
export const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$p/zf2QdY18cnkVaHG3ollA$KVXJNhKeJprihmapq01aeorKRGnGl95Cdw/UlWdUd94";

/**
 * Verify a plaintext password against a stored Argon2 hash.
 *
 * Returns true if the password matches, false otherwise.
 * Reuse this function in your login flow after fetching the stored hash.
 */
export async function verifyPassword(
    storedHash: string,
    plaintext: string
): Promise<boolean> {
    try {
        return await verify(storedHash, plaintext);
    } catch {
        // Malformed hash, unsupported algorithm, or internal error
        return false;
    }
}