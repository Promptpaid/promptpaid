import { db } from "@/services";
import type { Database } from "@promptpaid/db";
import { ONBOARDING_STATUS, type OnboardingStatus, type TierName } from "@promptpaid/shared";

export interface ProfileFields {
    languages: string[];
    skills: string[];
    timezone: string;
}

/**
 * Conditional profile save: update only when the user is still standing in an
 * allowed journey status. Reports how many rows changed. A count of 0 means
 * something moved the user first (e.g. screening started in another tab), so
 * the caller returns the wrong-status reply instead of overwriting.
 *
 * The check and the write are one atomic statement, so two concurrent saves
 * cannot both pass the gate and slip a change in after the journey moved on.
 *
 * Setting PROFILE_COMPLETE unconditionally is correct because the only allowed
 * statuses are CREATED and PROFILE_COMPLETE, and both end up complete.
 */
export async function saveProfile(
    userId: string,
    fields: ProfileFields,
    allowedStatuses: readonly OnboardingStatus[],
) {
    const result = await db.user.updateMany({
        where: {
            id: userId,
            onboardingStatus: { in: [...allowedStatuses] },
        },
        data: {
            languages: fields.languages,
            skills: fields.skills,
            timezone: fields.timezone,
            profileCompletedAt: new Date(),
            onboardingStatus: ONBOARDING_STATUS.PROFILE_COMPLETE,
        },
    });

    return { count: result.count };
}

/**
 * THE single status-change helper. The service layer moves a user along the
 * journey only through here: one conditional `updateMany` that changes the
 * row only while it still stands in an allowed status. A count of 0 means
 * something moved the user first, so the caller must re-read and reply
 * instead of overwriting. Never add a second status writer; extend this one.
 */
export async function transitionOnboardingStatus(
    userId: string,
    allowedFrom: readonly OnboardingStatus[],
    to: OnboardingStatus,
    client: Pick<Database, "user"> = db,
) {
    const result = await client.user.updateMany({
        where: {
            id: userId,
            onboardingStatus: { in: [...allowedFrom] },
        },
        data: { onboardingStatus: to },
    });

    return { count: result.count };
}

/**
 * Conditional selected-tier write: sets only `selectedTier`, only while the
 * user still stands in an allowed journey status. Never touches `tier`
 * (paid-for tier) or `onboardingStatus` (only `transitionOnboardingStatus`
 * may move the journey). Reports how many rows changed; a count of 0 means
 * something moved the user first.
 */
export async function setSelectedTier(
    userId: string,
    tier: TierName,
    allowedStatuses: readonly OnboardingStatus[],
    client: Pick<Database, "user"> = db,
) {
    const result = await client.user.updateMany({
        where: {
            id: userId,
            onboardingStatus: { in: [...allowedStatuses] },
        },
        data: { selectedTier: tier },
    });

    return { count: result.count };
}

/** Safe fields only: never the password hash or lockout bookkeeping. */
export async function getOnboardingProfile(userId: string) {
    return db.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            country: true,
            status: true,
            onboardingStatus: true,
            tier: true,
            selectedTier: true,
            languages: true,
            skills: true,
            timezone: true,
            profileCompletedAt: true,
        },
    });
}
