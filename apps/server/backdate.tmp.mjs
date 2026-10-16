import { db } from "./src/services";

const email = process.argv[2] ?? "";
const daysBack = Number(process.argv[3] ?? "0");
if (!email || !daysBack) {
  console.error("usage: tsx backdate.tmp.mjs <email> <daysBack>");
  process.exit(1);
}
const user = await db.user.findUnique({ where: { email }, select: { id: true } });
if (!user) {
  console.error("no such user");
  process.exit(1);
}
const latest = await db.attempt.findFirst({
  where: { userId: user.id, status: { not: "OPEN" } },
  orderBy: { attemptNumber: "desc" },
  select: { id: true, attemptNumber: true, submittedAt: true },
});
if (!latest?.submittedAt) {
  console.error("no closed attempt");
  process.exit(1);
}
const backdated = new Date(latest.submittedAt.getTime() - daysBack * 24 * 60 * 60 * 1000);
await db.attempt.update({ where: { id: latest.id }, data: { submittedAt: backdated } });
console.log(`attempt ${latest.attemptNumber} submittedAt -> ${backdated.toISOString()}`);
await db.$disconnect();
