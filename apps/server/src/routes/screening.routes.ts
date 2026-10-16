import { Router } from "express";
import { z } from "zod";
import {
    screeningAnswerSchema,
    screeningCurrentSchema,
    screeningResultSchema,
    screeningStartSchema,
    screeningSubmitSchema,
    type OnboardingStatus,
    type UserStatus,
} from "@promptpaid/shared";
import { clearSessionCookie, requireAuth } from "@/middleware/auth";
import { requireJson, requireSameOrigin } from "@/middleware/security";
import {
    readCurrentScreening,
    readScreeningResult,
    saveScreeningAnswers,
    startScreening,
    submitScreening,
} from "@/module/screening";

const router = Router();

// Order: session -> origin -> JSON -> validate -> service. The user is always
// read from the session; extra body fields (status, score, passed, tier) are
// stripped by zod and never reach the service. Responses carry prompts and
// displayed options only: no correct answers, no bank ids, no scores.
router.post("/start", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = screeningStartSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await startScreening({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            languages: user.languages,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "cooldown") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "no_bank") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(result.created ? 201 : 200).json({
            status: "ok",
            resumed: !result.created,
            attempt: result.attempt,
        });
    } catch (err) {
        console.error("screening start failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

router.post("/current", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = screeningCurrentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await readCurrentScreening({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "none") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            attempt: result.attempt,
        });
    } catch (err) {
        console.error("screening current failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Save answers as the user goes. The response confirms the save only and
// never reveals correctness.
router.post("/answers", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = screeningAnswerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await saveScreeningAnswers({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
            answers: parsed.data.answers,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "none" || result.status === "expired") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "invalid") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            saved: result.saved,
            secondsRemaining: result.secondsRemaining,
        });
    } catch (err) {
        console.error("screening answers failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Grade and close the attempt. Safe to repeat: a second call returns the same
// stored result without touching the attempt again.
router.post("/submit", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = screeningSubmitSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await submitScreening({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "none") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.result.suspended) {
            clearSessionCookie(res);
        }

        return res.status(200).json({
            status: "ok",
            repeated: result.repeated,
            result: result.result,
        });
    } catch (err) {
        console.error("screening submit failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

// Stored result only: section scores, pass or fail, next attempt date. Never
// answers, never which questions were wrong.
router.post("/result", requireAuth, requireSameOrigin, requireJson, async (req, res) => {
    try {
        const parsed = screeningResultSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const user = req.user!;
        const result = await readScreeningResult({
            userId: user.id,
            accountStatus: user.status as UserStatus,
            onboardingStatus: user.onboardingStatus as OnboardingStatus,
        });

        if (result.status === "wrong_status") {
            return res.status(result.httpStatus).json(result.body);
        }

        if (result.status === "none") {
            return res.status(result.httpStatus).json(result.body);
        }

        return res.status(200).json({
            status: "ok",
            result: result.result,
        });
    } catch (err) {
        console.error("screening result failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;
