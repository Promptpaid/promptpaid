import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { signUpSchema } from "@promptpaid/shared";
import { signup } from "@/module/auth";

const router = Router();

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5, // 5 attempts per IP per 10 minutes; change if you want it looser
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: "rate_limited", message: "Too many attempts. Try again later." },
});

router.post("/signup", limiter, async (req, res) => {
    try {
        const parsed = signUpSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const result = await signup(parsed.data);

        if (result.status === "duplicate") {
            return res.status(409).json({
                status: "duplicate",
                message: "An account with these details already exists.",
            });
        }

        if (result.status === "invalid") {
            return res.status(400).json({
                status: "invalid",
                errors: { [result.field]: ["Invalid value."] },
            });
        }

        return res.status(201).json({
            status: "created",
            user: result.user,
        });
    } catch (err) {
        console.error("signup failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;
