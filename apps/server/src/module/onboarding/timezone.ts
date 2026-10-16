/**
 * Whether a string is a timezone name Node recognizes.
 *
 * We build an `Intl.DateTimeFormat` with the candidate as a timezone and treat
 * a thrown error as invalid. This accepts every alias the runtime knows about
 * (including Africa/Accra), unlike comparing against a hard-coded list. The
 * real check runs on the server; the web form only validates for convenience.
 */
export function isValidTimeZone(name: unknown): name is string {
    if (typeof name !== "string" || name.trim().length === 0) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: name });
        return true;
    } catch {
        return false;
    }
}
