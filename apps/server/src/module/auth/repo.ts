import { db } from "@/services";
import type { SignupInput } from "@promptpaid/shared";

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
    );
}


export async function createUser(input: SignupInput) {
    try {
        const user = await db.user.create({
            data: {
                name: input.name,
                email: input.email,
                phone: input.phone,
                passwordHash: input.password,
                country: input.country,
                languages: input.languages
            },
        })
        return { status: "created" as const, user };
    } catch (error) {
        if (isUniqueViolation(error)) return { status: "duplicate" as const }
        throw error;
    }
}

export async function findUserByEmail(email: string) {
    return db.user.findUnique({ where: { email } });
}

export async function recordFailedLogin(
    userId: string,
    attempts: number,
    lockedUntil: Date | null
) {
    await db.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: attempts, lockedUntil },
    });
}

export async function resetFailedLogin(userId: string) {
    await db.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
    });
}

export async function createSession(userId: string, tokenHash: string, expiresAt: Date) {
    return db.session.create({
        data: { userId, tokenHash, expiresAt },
    });
}

export type AuthUser = Omit<NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>, "passwordHash">;

export async function findSessionByTokenHash(tokenHash: string) {
    return db.session.findUnique({
        where: { tokenHash },
        include: { user: true },
    });
}

export async function deleteSessionById(id: string) {
    await db.session.deleteMany({ where: { id } });
}

export async function deleteSessionByTokenHash(tokenHash: string) {
    await db.session.deleteMany({ where: { tokenHash } });
}

export async function deleteSessionsForUser(userId: string) {
    await db.session.deleteMany({ where: { userId } });
}

export async function slideSessionExpiry(id: string, expiresAt: Date) {
    await db.session.update({
        where: { id },
        data: { expiresAt, lastUsedAt: new Date() },
    });
}