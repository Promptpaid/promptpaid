import { CONSENT_VERSION, type WaitlistInput } from "@promptpaid/shared";

import { db } from "../../services";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

export async function createEntry(input: WaitlistInput) {
  try {
    const entry = await db.waitlistEntry.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        country: input.country,
        languages: input.languages,
        interests: input.interests,
        consentAt: new Date(),
        consentVersion: CONSENT_VERSION,
      },
    });
    return { status: "created" as const, entry };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate" as const };
    throw err;
  }
}

export async function markConfirmationSent(id: string) {
  await db.waitlistEntry.update({
    where: { id },
    data: { confirmationSentAt: new Date() },
  });
}