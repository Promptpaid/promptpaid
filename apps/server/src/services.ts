import { createPrismaClient } from "@promptpaid/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
