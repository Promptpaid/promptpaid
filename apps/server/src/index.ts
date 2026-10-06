import cors from "cors";
import express from "express";

import { ENV } from "./env.server";
import authRouter from "./routes/auth.routes";
import waitlistRouter from "./routes/waitlist.routes";

const app = express();

app.use(
  cors({
    origin: ENV.CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
  }),
);

app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (_req, res) => {
  res.status(200).send("Server is Active😎")
}
)

app.use("/waitlist", waitlistRouter);
app.use("/auth", authRouter);

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
