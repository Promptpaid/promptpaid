import type { NextFunction, Request, Response } from "express";
import { USER_STATUS } from "@promptpaid/shared";
import {
    deleteSessionById,
    deleteSessionByTokenHash,
    findSessionByTokenHash,
    slideSessionExpiry,
    type AuthUser,
} from "@/module/auth/repo";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/module/auth";
import { getHashedTokenForLookup } from "@/module/auth/session";
import { ENV } from "@/env.server";

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
            sessionId?: string;
        }
    }
}

const SLIDE_AFTER_MS = 60 * 60 * 1000; // only slide when lastUsedAt is > 1 hour old

const unauthorized = { status: "unauthorized" as const, message: "Authentication required." };

export function clearSessionCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
    });
}

/**
 * Attach the session cookie. Used by both login and signup so the flags can
 * never drift between the two entry points.
 */
export function setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: ENV.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_MS,
    });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
        if (typeof rawToken !== "string" || rawToken.length === 0) {
            return res.status(401).json(unauthorized);
        }

        const tokenHash = getHashedTokenForLookup(rawToken);
        const session = await findSessionByTokenHash(tokenHash);

        if (!session || session.expiresAt.getTime() <= Date.now()) {
            if (session) await deleteSessionByTokenHash(tokenHash);
            clearSessionCookie(res);
            return res.status(401).json(unauthorized);
        }

        if (session.user.status !== USER_STATUS.ACTIVE) {
            await deleteSessionById(session.id);
            clearSessionCookie(res);
            return res.status(401).json(unauthorized);
        }

        const { passwordHash: _passwordHash, ...user } = session.user;
        req.user = user;
        req.sessionId = session.id;

        const now = Date.now();
        if (now - session.lastUsedAt.getTime() > SLIDE_AFTER_MS) {
            const absoluteMax = session.createdAt.getTime() + SESSION_TTL_MS;
            await slideSessionExpiry(session.id, new Date(Math.min(now + SESSION_TTL_MS, absoluteMax)));
        }

        next();
    } catch (err) {
        console.error("requireAuth failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong. Please try again.",
        });
    }
}


