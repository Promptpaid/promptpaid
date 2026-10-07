import type { NextFunction, Request, Response } from "express";
import { ENV } from "@/env.server";

const ALLOWED_ORIGIN = ENV.CORS_ORIGIN.trim().replace(/\/+$/, "");

/**
 * Only accept requests whose body is JSON (Content-Type: application/json).
 */
export function requireJson(req: Request, res: Response, next: NextFunction) {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        return res.status(415).json({
            status: "unsupported_media_type",
            message: "Content-Type must be application/json.",
        });
    }
    next();
}

/**
 * Reject requests whose Origin header does not match the allowed web origin.
 * Requests without an Origin header (non-browser clients) are allowed;
 * browsers always send one on cross-site and state-changing requests.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin?.trim().replace(/\/+$/, "");
    if (origin !== undefined && origin !== "" && origin !== ALLOWED_ORIGIN) {
        return res.status(403).json({
            status: "forbidden",
            message: "Cross-origin request rejected.",
        });
    }
    next();
}
