import {
    canPerform,
    nextStepFor,
    type OnboardingStatus,
    type UserStatus,
} from "@promptpaid/shared";

export interface AccountPosition {
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}

/**
 * The gate. An onboarding action is allowed only when the account is ACTIVE
 * (the frozen switch overrides everything) AND the journey status is in the
 * allowed list for that action. The table itself lives in @promptpaid/shared.
 */
export function canSaveProfile(position: AccountPosition): boolean {
    return canPerform(position, "save_profile");
}

/**
 * Choosing a tier is allowed fresh from SCREENING_PASSED and again from
 * TIER_CHOSEN (change of mind before paying). Choosing grants no benefits.
 */
export function canChooseTier(position: AccountPosition): boolean {
    return canPerform(position, "choose_tier");
}

/**
 * The standard "wrong status" reply. HTTP 409, not 400: the input was valid,
 * the state is wrong. Includes the next step the user should take instead.
 * Database-free so it can be unit-tested on its own.
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
