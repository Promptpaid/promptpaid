import {
    canPerform,
    type OnboardingStatus,
    type UserStatus,
} from "@promptpaid/shared";

export interface AccountPosition {
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}

/**
 * Screening gates. Each action requires an ACTIVE account AND an allowed
 * journey status; the allowed lists live in @promptpaid/shared
 * (ACTION_ALLOWED_STATUSES). Non-ACTIVE accounts (FROZEN, SUSPENDED) fail
 * every gate here, same as login and the auth middleware.
 */
export function canStartScreening(position: AccountPosition): boolean {
    return canPerform(position, "screening_start");
}

export function canAnswerScreening(position: AccountPosition): boolean {
    return canPerform(position, "screening_answer");
}

export function canSubmitScreening(position: AccountPosition): boolean {
    return canPerform(position, "screening_submit");
}

export function canViewScreeningResult(position: AccountPosition): boolean {
    return canPerform(position, "screening_result");
}
