import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { loginSchema, signUpSchema } from "@promptpaid/shared";
import { login, SESSION_COOKIE_NAME, SESSION_TTL_MS, signup } from "@/module/auth";
import { deleteSessionById, deleteSessionsForUser } from "@/module/auth/repo";
import { clearSessionCookie, requireAuth } from "@/middleware/auth";
import { requireJson, requireSameOrigin } from "@/middleware/security";
import { ENV } from "@/env.server";

const router = Router();

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5, // 5 attempts per IP per 10 minutes; change if you want it looser
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: "rate_limited", message: "Too many attempts. Try again later." },
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10, // 10 login attempts per IP per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: "rate_limited", message: "Too many attempts. Try again later." },
});

router.post("/signup", limiter, requireJson, requireSameOrigin, async (req, res) => {
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

router.post("/login", loginLimiter, async (req, res) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                status: "invalid",
                errors: z.flattenError(parsed.error).fieldErrors,
            });
        }

        const result = await login(parsed.data);

        if (result.status === "invalid_credentials") {
            return res.status(401).json({
                status: "invalid_credentials",
                message: "Invalid email or password.",
            });
        }

        res.cookie(SESSION_COOKIE_NAME, result.token, {
            httpOnly: true,
            secure: ENV.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: SESSION_TTL_MS,
        });

        return res.status(200).json({
            status: "ok",
            user: result.user,
        });
    } catch (err) {
        console.error("login failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

router.get("/me", requireAuth, (req, res) => {
    const user = req.user!;
    return res.status(200).json({
        status: "ok",
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
        },
    });
});

router.post("/logout", requireJson, requireSameOrigin, requireAuth, async (req, res) => {
    try {
        await deleteSessionById(req.sessionId!);
        clearSessionCookie(res);
        return res.status(200).json({ status: "ok", message: "Logged out." });
    } catch (err) {
        console.error("logout failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

router.post("/logout-all", requireJson, requireSameOrigin, requireAuth, async (req, res) => {
    try {
        await deleteSessionsForUser(req.user!.id);
        clearSessionCookie(res);
        return res.status(200).json({ status: "ok", message: "Logged out of all sessions." });
    } catch (err) {
        console.error("logout-all failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
});

export default router;
