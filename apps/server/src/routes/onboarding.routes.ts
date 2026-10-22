import { Router } from "express";
import { z } from "zod";
import {
    TIERS,
    chooseTierSchema,
    profileSchema,
    type OnboardingStatus,
    type TierName,
    type UserStatus,
} from "@promptpaid/shared";
import { requireAuth } from "@/middleware/auth";
import { requireJson, requireSameOrigin } from "@/middleware/security";
import { chooseOnboardingTier, readOnboardingStatus, saveOnboardingProfile } from "@/module/onboarding";

const router = Router();

// Order: session -> origin -> JSON -> validate -> service. The user is always
// read from the session; any status/tier/role fields in the body are ignored
// (zod strips unknown keys). Extra body fields never reach the database.
router.post("/profile", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = profileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await saveOnboardingProfile({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            profile: parsed.data,
        });

        if (result.status === "invalid") {
            return res.status(400).json({ status: "invalid", errors: result.errors });
        }

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            nextStep: result.nextStep,
            profile: result.profile,
        });
    } catch (err) {
        console.error("save profile failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

router.get("/status", requireAuth, async (req, res) => {
    try {
        const current = await readOnboardingStatus(req.user!.id);
        if (!current) {
            return res.status(404).json({ status: "not_found", message: "Profile not found." });
        }

        return res.status(200).json({
            status: "ok",
            accountStatus: current.accountStatus,
            onboardingStatus: current.onboardingStatus,
            nextStep: current.nextStep,
            profile: current.profile,
            selectedTier: current.selectedTier,
            editableFields: current.editableFields,
        });
    } catch (err) {
        console.error("read onboarding status failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Tier catalog: static facts from shared settings only. Session required,
// no user data returned. Tier names, prices, limits and the open flag are
// looked up server-side; nothing is accepted from the request.
router.get("/tiers", requireAuth, async (_req, res) => {
    try {
        return res.status(200).json({
            status: "ok",
            tiers: (Object.keys(TIERS) as TierName[]).map((name) => ({
                name: TIERS[name].name,
                price: TIERS[name].price,
                dailyConversations: TIERS[name].dailyConversations,
                ratePerConversation: TIERS[name].ratePerConversation,
                withdrawalThreshold: TIERS[name].withdrawalThreshold,
                open: TIERS[name].open,
            })),
        });
    } catch (err) {
        console.error("read tiers failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Order: session -> origin -> JSON -> validate -> service. The user is always
// read from the session; extra body fields (price, status, selectedTier,
// ...) are stripped by zod and never reach the database. Choosing grants no
// benefits: only `selectedTier` is written, never `tier`.
router.post("/tier", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = chooseTierSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await chooseOnboardingTier({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            tier: parsed.data.tier,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "refused") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            tier: result.tier,
            price: result.price,
            nextStep: result.nextStep,
        });
    } catch (err) {
        console.error("choose tier failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;
