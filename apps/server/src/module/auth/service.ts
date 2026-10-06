import type { SignupInput } from "@promptpaid/shared";
import { createUser } from "./repo";
import { hashPassword } from "./password";

const INTERNATIONAL_PHONE = /^\+\d{8,15}$/;

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
