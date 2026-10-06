import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { waitlistSchema } from "@promptpaid/shared";
import { joinWaitlist } from "../module/waitlist/index";

const router = Router();

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5, // 5 attempts per IP per 10 minutes; change if you want it looser
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: "rate_limited", message: "Too many attempts. Try again later." },
});

router.post("/", limiter, async (req, res) => {
    // Honeypot: a hidden field real users never fill. Pretend success, store nothing.
    if (typeof req.body?.website === "string" && req.body.website.trim() !== "") {
        return res.status(201).json({ status: "created", message: "You're on the list!" });
    }

    const parsed = waitlistSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            status: "invalid",
            errors: z.flattenError(parsed.error).fieldErrors,
        });
    }

    try {
        const result = await joinWaitlist(parsed.data);
        if (result.status === "duplicate") {
            // Same text whether the email or the phone matched.
            return res.status(200).json({
                status: "duplicate",
                message: "You're already on the waitlist.",
            });
        }
        return res.status(201).json({
            status: "created",
            message: "You're on the list! Check your email.",
        });
    } catch (err) {
        console.error("waitlist signup failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;