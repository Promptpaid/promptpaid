import { Router } from "express";
import { handlePaymentsWebhook } from "@/module/payments";

const router = Router();

// Provider -> server webhook. No session, no same-origin, no JSON middleware:
// the provider is not a browser and the raw body must stay untouched for the
// adapter's signature check. Authentication, event recording and idempotency
// all happen inside the handler (a PaymentEvent is written for every
// request, rejected ones included), and responses never reveal provider
// internals or other users' payments.
router.post("/payments", async (req, res) => {
    try {
        const rawBody = req.rawBody?.toString("utf8") ?? "";
        const headers: Record<string, string | undefined> = {};
        for (const key of Object.keys(req.headers)) {
            const value = req.headers[key];
            headers[key] = Array.isArray(value) ? value[0] : value;
        }

        const result = await handlePaymentsWebhook({ rawBody, headers });
        return res.status(result.httpStatus).json(result.body);
    } catch (err) {
        console.error("payments webhook failed:", (err as Error).name);
        return res.status(500).json({
            status: "error",
            message: "Something went wrong.",
        });
    }
});

export default router;
