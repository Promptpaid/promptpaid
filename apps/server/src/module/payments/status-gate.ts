import { canPerform, nextStepFor, type OnboardingStatus, type UserStatus } from "@promptpaid/shared";

export interface AccountPosition {
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}

/**
 * Payment gates. start_payment additionally requires the caller to hold a
 * selectedTier and no open payment (both checked in the service on a fresh
 * read, like every other journey step).
 */
export function canStartPayment(position: AccountPosition): boolean {
    return canPerform(position, "start_payment");
}

export function canGetPin(position: AccountPosition): boolean {
    return canPerform(position, "get_pin");
}

/**
 * Activation also allows ACTIVATED so a repeat call returns success instead
 * of a 409; the service verifies on a fresh read that there is genuinely
 * nothing left to write.
 */
export function canActivate(position: AccountPosition): boolean {
    return canPerform(position, "activate");
}

/**
 * The standard "wrong status" reply, identical conventions to the onboarding
 * gate: HTTP 409 because the input was valid and the state is wrong, with
 * the next step the user should take instead.
 */
export function wrongStatusReply(position: AccountPosition) {
    return {
        httpStatus: 409 as const,
        body: {
            status: "wrong_status" as const,
            message: "You can't do that from your current step.",
            nextStep: nextStepFor(position),
        },
    };
}
