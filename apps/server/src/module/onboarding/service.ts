import {
    ACTION_ALLOWED_STATUSES,
    ONBOARDING_STATUS,
    TIERS,
    editableProfileFields,
    nextStepFor,
    type OnboardingStatus,
    type ProfileInput,
    type TierName,
    type UserStatus,
} from "@promptpaid/shared";
import { db } from "@/services";
import { getOnboardingProfile, saveProfile, setSelectedTier, transitionOnboardingStatus } from "./repo";
import { canChooseTier, canSaveProfile, wrongStatusReply } from "./status-gate";
import { isValidTimeZone } from "./timezone";

export interface SaveProfileInput {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    profile: ProfileInput;
}

export async function saveOnboardingProfile(input: SaveProfileInput) {
    if (!isValidTimeZone(input.profile.timezone)) {
        return {
            status: "invalid" as const,
            errors: { timezone: ["Enter a valid timezone."] },
        };
    }

    const position = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };

    if (!canSaveProfile(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    const { count } = await saveProfile(
        input.userId,
        {
            languages: input.profile.languages,
            skills: input.profile.skills,
            timezone: input.profile.timezone,
        },
        ACTION_ALLOWED_STATUSES.save_profile,
    );

    if (count === 0) {
        // Something moved the user between the gate check and the write.
        const current = await getOnboardingProfile(input.userId);
        const latest = {
            accountStatus: (current?.status ?? input.accountStatus) as UserStatus,
            onboardingStatus: (current?.onboardingStatus ??
                input.onboardingStatus) as OnboardingStatus,
        };
        return { status: "wrong_status" as const, ...wrongStatusReply(latest) };
    }

    const profile = await getOnboardingProfile(input.userId);
    return {
        status: "ok" as const,
        profile,
        nextStep: nextStepFor({
            accountStatus: input.accountStatus,
            onboardingStatus: ONBOARDING_STATUS.PROFILE_COMPLETE,
        }),
    };
}

export async function readOnboardingStatus(userId: string) {
    const profile = await getOnboardingProfile(userId);
    if (!profile) return null;

    const accountStatus = profile.status as UserStatus;
    const onboardingStatus = profile.onboardingStatus as OnboardingStatus;

    return {
        accountStatus,
        onboardingStatus,
        nextStep: nextStepFor({ accountStatus, onboardingStatus }),
        profile,
        selectedTier: (profile.selectedTier ?? null) as TierName | null,
        editableFields: editableProfileFields(onboardingStatus),
    };
}

export interface ChooseTierInput {
    userId: string;
    accountStatus: UserStatus;
    onboardingStatus: OnboardingStatus;
    tier: TierName;
}

/**
 * Onboarding step 7: pick a tier. Choosing grants NO benefits: this writes
 * only `selectedTier` and moves the journey to TIER_CHOSEN. `tier`
 * (paid-for tier) is never written here; only the later payment and
 * activation feature sets it.
 *
 * Safe to repeat: choosing the already-selected tier from TIER_CHOSEN
 * returns the same result with zero writes.
 */
export async function chooseOnboardingTier(input: ChooseTierInput) {
    const position = {
        accountStatus: input.accountStatus,
        onboardingStatus: input.onboardingStatus,
    };

    if (!canChooseTier(position)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(position) };
    }

    // TODO(payment): re-read the user here and refuse the change when a
    // payment has already started. There is no payment code yet, so there
    // is nothing to check against.

    // Fresh read: the session snapshot may be stale, and this doubles as
    // the idempotency check.
    const current = await getOnboardingProfile(input.userId);
    if (!current) {
        return {
            status: "wrong_status" as const,
            ...wrongStatusReply(position),
        };
    }
    const latest: { accountStatus: UserStatus; onboardingStatus: OnboardingStatus } = {
        accountStatus: current.status as UserStatus,
        onboardingStatus: current.onboardingStatus as OnboardingStatus,
    };
    if (!canChooseTier(latest)) {
        return { status: "wrong_status" as const, ...wrongStatusReply(latest) };
    }

    const setting = TIERS[input.tier];

    if (current.onboardingStatus === ONBOARDING_STATUS.TIER_CHOSEN && current.selectedTier === input.tier) {
        return {
            status: "ok" as const,
            repeated: true as const,
            tier: input.tier,
            price: setting.price,
            nextStep: nextStepFor({
                accountStatus: latest.accountStatus,
                onboardingStatus: ONBOARDING_STATUS.TIER_CHOSEN,
            }),
        };
    }

    // One short transaction: the single status helper moves the journey,
    // then only `selectedTier` is written. Either count of 0 means something
    // moved the user first, so the caller re-reads instead of overwriting.
    const moved = await db.$transaction(
        async (tx) => {
            const transitioned = await transitionOnboardingStatus(
                input.userId,
                [...ACTION_ALLOWED_STATUSES.choose_tier],
                ONBOARDING_STATUS.TIER_CHOSEN,
                tx,
            );
            if (transitioned.count === 0) return { count: 0 };
            return setSelectedTier(
                input.userId,
                input.tier,
                [ONBOARDING_STATUS.TIER_CHOSEN],
                tx,
            );
        },
        { timeout: 15000 },
    );

    if (moved.count === 0) {
        const reread = await getOnboardingProfile(input.userId);
        const fresh = {
            accountStatus: (reread?.status ?? input.accountStatus) as UserStatus,
            onboardingStatus: (reread?.onboardingStatus ??
                input.onboardingStatus) as OnboardingStatus,
        };
        return { status: "wrong_status" as const, ...wrongStatusReply(fresh) };
    }

    return {
        status: "ok" as const,
        repeated: false as const,
        tier: input.tier,
        price: setting.price,
        nextStep: nextStepFor({
            accountStatus: input.accountStatus,
            onboardingStatus: ONBOARDING_STATUS.TIER_CHOSEN,
        }),
    };
}
