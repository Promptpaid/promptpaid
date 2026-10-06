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