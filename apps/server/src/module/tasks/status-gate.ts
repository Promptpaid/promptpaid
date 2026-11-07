import { canPerform, type UserStatus, type OnboardingStatus } from "@promptpaid/shared";

export interface AccountPosition {
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
}

export function canViewTasks(position: AccountPosition): boolean {
    return canPerform(position, "view_tasks");
}

export function canStartConversation(position: AccountPosition): boolean {
    return canPerform(position, "start_conversation");
}

export function canSendMessage(position: AccountPosition): boolean {
    return canPerform(position, "send_message");
}

export function canSubmitConversation(position: AccountPosition): boolean {
    return canPerform(position, "submit_conversation");
}

export function canCompleteTutorial(position: AccountPosition): boolean {
    return canPerform(position, "complete_tutorial");
}

/**
 * Standard "wrong status" reply. HTTP 409, not 400: the input was valid,
 * the state is wrong. Includes the next step the user should take instead.
 * Database-free so it can be unit-tested on its own.
 */
export function wrongStatusReply(position: AccountPosition) {
    const { nextStepFor } = require("@promptpaid/shared");
    return {
        httpStatus: 409 as const,
        body: {
            status: "wrong_status" as const,
            message: "You can't do that from your current step.",
            nextStep: nextStepFor(position),
        },
    };
}