import { z } from "zod";

// ---------------------------------------------------------------------------
// Tier catalog (onboarding step 7): shared rules only.
// The Prisma `UserTier` enum mirrors `TIER_NAMES`. All money is whole
// numbers in the smallest currency unit (kobo integers) so pricing never
// uses floating point. `open` decides which tiers are selectable; only
// Rookie is open at launch. Choosing a tier grants NO benefits: `tier`
// keeps meaning "the tier the user has paid for and activated".
// ---------------------------------------------------------------------------

export const TIER_NAMES = ["ROOKIE", "ELITE", "LEGENDARY"] as const;

export type TierName = (typeof TIER_NAMES)[number];

export interface TierSetting {
  name: TierName;
  /** Whole kobo (e.g. 200000 = ₦2,000). */
  price: number;
  dailyConversations: number;
  ratePerConversation: number;
  withdrawalThreshold: number;
  open: boolean;
}

export const TIERS: Record<TierName, TierSetting> = {
  ROOKIE: {
    name: "ROOKIE",
    price: 200000,
    dailyConversations: 5,
    ratePerConversation: 10000,
    withdrawalThreshold: 800000,
    open: true,
  },
  ELITE: {
    name: "ELITE",
    price: 400000,
    dailyConversations: 10,
    ratePerConversation: 18000,
    withdrawalThreshold: 1500000,
    open: false,
  },
  LEGENDARY: {
    name: "LEGENDARY",
    price: 700000,
    dailyConversations: 15,
    ratePerConversation: 20000,
    withdrawalThreshold: 2000000,
    open: false,
  },
};

export function tierSettingFor(name: string): TierSetting | null {
  if (name !== "ROOKIE" && name !== "ELITE" && name !== "LEGENDARY") return null;
  return TIERS[name];
}

export function openTiers(): TierSetting[] {
  return (Object.keys(TIERS) as TierName[])
    .map((name) => TIERS[name])
    .filter((tier) => tier.open);
}

// ---------------------------------------------------------------------------
// Choose-tier request schema (POST /onboarding/tier).
// The body carries the tier name only. Unknown keys (price, status, tier
// metadata, selectedTier, ...) are stripped by zod and never trusted: the
// server looks every fact up in TIERS. Unknown names and closed tiers fail
// with 400.
// ---------------------------------------------------------------------------

export const chooseTierSchema = z.object({
  tier: z.enum(TIER_NAMES, { error: "Unknown tier." }),
}).refine((body) => TIERS[body.tier].open, {
  error: "That tier is not open yet.",
  path: ["tier"],
});

export type ChooseTierInput = z.infer<typeof chooseTierSchema>;
