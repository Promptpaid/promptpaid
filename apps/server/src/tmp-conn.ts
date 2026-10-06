import { ENV } from "./env.server";
import { createPrismaClient } from "@promptpaid/db";

const db = createPrismaClient(ENV);

const tables = await db.$queryRaw<
  { table_name: string }[]
>`select table_name from information_schema.tables where table_schema='public' order by table_name`;

console.log(
  "HTTP_ADAPTER_OK",
  JSON.stringify(tables.map((t) => t.table_name)),
);

const cols = await db.$queryRaw<
  { column_name: string; is_nullable: string }[]
>`select column_name, is_nullable from information_schema.columns where table_name='WaitlistEntry' order by ordinal_position`;

console.log("WAITLIST_COLS", JSON.stringify(cols));

await db.$disconnect();
