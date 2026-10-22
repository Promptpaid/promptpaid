import cors from "cors";
import express from "express";
import cookieParser from 'cookie-parser'
import type { Request, Response } from "express";

import { ENV } from "./env.server";
import authRouter from "./routes/auth.routes";
import onboardingRouter from "./routes/onboarding.routes";
import screeningRouter from "./routes/screening.routes";
import waitlistRouter from "./routes/waitlist.routes";
import paymentsRouter from "./routes/payments.routes";
import webhooksRouter from "./routes/webhooks.routes";
import { initPaymentsProvider } from "./module/payments";
import { db } from "./services";

const app = express();

app.use(
  cors({
    origin: ENV.CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  }),
);

app.use(cookieParser())

app.set("trust proxy", 1);
// The raw body is captured so /webhooks/payments can verify the provider's
// signature over the exact bytes (parsed JSON is never used for signing).
app.use(express.json({
  limit: "10kb",
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("OK, what were you looking for ????");
});


app.get("/health", async (_req: Request, res: Response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.status(200).send("Server is Active😎 — DB pinged successfully");
  } catch (error) {
    res.status(500).send("Server is Active but DB ping failed 😪");
  }
});

app.use("/waitlist", waitlistRouter);
app.use("/api/waitlist", waitlistRouter);
app.use("/auth", authRouter);
app.use("/onboarding", onboardingRouter);
app.use("/screening", screeningRouter);
app.use("/payments", paymentsRouter);
app.use("/webhooks", webhooksRouter);

// The provider must be configured before the server accepts traffic: a
// missing/unknown provider name, or the fake provider outside development,
// stops the process here instead of serving endpoints.
initPaymentsProvider();

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
