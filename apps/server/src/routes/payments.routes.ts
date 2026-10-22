import { Router } from "express";
import { z } from "zod";
import {
    paymentStartSchema,
    type OnboardingStatus,
    type UserStatus,
} from "@promptpaid/shared";
import { requireAuth } from "@/middleware/auth";
import { requireSameOrigin } from "@/middleware/security";
import { startPayment, readCurrentPayment } from "@/module/payments";

const router = Router();

// Order: session -> origin -> validate -> service. The user is read from the
// session only. There is no other body to validate: the tier and the amount
// come from selectedTier and TIERS, never from the client.
router.post("/start", requireAuth, requireSameOrigin, async (req, res) => {
    try {
        const parsed = paymentStartSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await startPayment({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        });

        if (result.status === "wrong_status" || result.status === "no_tier") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(result.repeated ? 200 : 201).json({
            status: "ok",
            repeated: result.repeated,
            payment: result.payment,
            nextStep: result.nextStep,
        });
    } catch (err) {
        console.error("start payment failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Current payment state for web and bot. GET, so no JSON body check; the
// seconds remaining are server-calculated and the shortfall (UNDERPAID) is
// included when present.
router.get("/current", requireAuth, requireSameOrigin, async (req, res) => {
    try {
        const result = await readCurrentPayment({ userId: req.user!.id });

        if (result.status === "none") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            payment: result.payment,
            nextStep: result.nextStep,
        });
    } catch (err) {
        console.error("read current payment failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;
