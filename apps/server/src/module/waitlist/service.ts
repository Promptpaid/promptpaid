import type { WaitlistInput } from "@promptpaid/shared";
import { createEntry, markConfirmationSent } from "./repo";
import { sendWaitlistConfirmation } from "../notifications/waitlist-email";

export async function joinWaitlist(input: WaitlistInput) {
  const result = await createEntry(input);

  // Duplicate: no second email, so the form can't be used to spam someone's inbox.
  if (result.status === "duplicate") return { status: "duplicate" as const };

  const sent = await sendWaitlistConfirmation(result.entry.email, result.entry.name);
  if (sent) {
    await markConfirmationSent(result.entry.id).catch(() =>
      console.error("could not record confirmation time"),
    );
  }
  // The signup is saved even if the email failed.
  return { status: "created" as const };
}