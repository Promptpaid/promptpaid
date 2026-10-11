import type { LoginInput, SignupInput } from "@promptpaid/shared";
import { USER_STATUS } from "@promptpaid/shared";
import {
    createSession,
    createUser,
    findUserByEmail,
    recordFailedLogin,
    recordFailedLoginForUnknownUser,
    resetFailedLogin,
} from "./repo";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";
import { generateSessionData, SESSION_TTL_MS } from "./session";

const INTERNATIONAL_PHONE = /^\+\d{8,15}$/;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function signup(input: SignupInput) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();

    if (!INTERNATIONAL_PHONE.test(phone)) {
        return { status: "invalid" as const, field: "phone" as const };
    }

    const passwordHash = await hashPassword(input.password);

    const result = await createUser({ ...input, name, email, phone, password: passwordHash });

    if (result.status === "duplicate") return { status: "duplicate" as const };

    const user = result.user;
    return {
        status: "created" as const,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            country: user.country,
            languages: user.languages,
            status: user.status,
            tier: user.tier,
            createdAt: user.createdAt,
        },
    };
}


export async function login(input: LoginInput) {
    const email = input.email.trim().toLowerCase();
    const genericFailure = { status: "invalid_credentials" as const };

    const user = await findUserByEmail(email);

    if (!user) {
        // Run the Argon2 verify and a matching no-op write so the unknown-email
        // path costs the same as the wrong-password path and cannot be told
        // apart by response time.
        await verifyPassword(DUMMY_HASH, input.password);
        await recordFailedLoginForUnknownUser();
        return genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return genericFailure;
    }

    if (user.status !== USER_STATUS.ACTIVE) {
        // TODO: improve this message later so suspended accounts get their own notice.
        return genericFailure;
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);

    if (!passwordOk) {
        const attempts = user.failedLoginAttempts + 1;
        const lockedUntil =
            attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
                : null;
        await recordFailedLogin(user.id, attempts, lockedUntil);
        return genericFailure;
    }

    await resetFailedLogin(user.id);

    const { rawToken, hashedToken } = generateSessionData();
    await createSession(user.id, hashedToken, new Date(Date.now() + SESSION_TTL_MS));

    return {
        status: "ok" as const,
        token: rawToken,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
        },
    };
}