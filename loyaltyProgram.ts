import {
  Customer,
  LoyaltyMilestone,
  LoyaltyTierConfig,
  LoyaltyTierId,
} from '../types';

export const LOYALTY_TIERS: LoyaltyTierConfig[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    minLifetimePoints: 0,
    earnMultiplier: 1.0,
    bonusDiscountPct: 0,
    description: '1 pt per ₹100 billed · Redeem 1 pt = ₹1',
  },
  {
    id: 'silver',
    name: 'Silver',
    minLifetimePoints: 500,
    earnMultiplier: 1.25,
    bonusDiscountPct: 1,
    description: '1.25x point accrual · 500+ lifetime pts',
  },
  {
    id: 'gold',
    name: 'Gold',
    minLifetimePoints: 2000,
    earnMultiplier: 1.5,
    bonusDiscountPct: 2,
    description: '1.5x point accrual · 2,000+ lifetime pts',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minLifetimePoints: 5000,
    earnMultiplier: 2.0,
    bonusDiscountPct: 3,
    description: '2.0x point accrual · 5,000+ lifetime pts',
  },
];

export const LOYALTY_MILESTONES: LoyaltyMilestone[] = [
  {
    id: 'ms_500',
    title: 'Silver Entry Milestone',
    pointsRequired: 500,
    rewardPointsBonus: 50,
    rewardCashValue: 50,
    description: 'Reach 500 lifetime pts to unlock +50 bonus points',
  },
  {
    id: 'ms_1500',
    title: 'Regular Buyer Milestone',
    pointsRequired: 1500,
    rewardPointsBonus: 150,
    rewardCashValue: 150,
    description: 'Reach 1,500 lifetime pts to unlock +150 bonus points',
  },
  {
    id: 'ms_3000',
    title: 'Volume Champion Milestone',
    pointsRequired: 3000,
    rewardPointsBonus: 350,
    rewardCashValue: 350,
    description: 'Reach 3,000 lifetime pts to unlock +350 bonus points',
  },
  {
    id: 'ms_5000',
    title: 'Platinum Partner Milestone',
    pointsRequired: 5000,
    rewardPointsBonus: 650,
    rewardCashValue: 650,
    description: 'Reach 5,000 lifetime pts to unlock +650 bonus points',
  },
];

export function getLoyaltyTierForPoints(lifetimePoints: number = 0): LoyaltyTierConfig {
  let current = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (lifetimePoints >= tier.minLifetimePoints) {
      current = tier;
    }
  }
  return current;
}

export function getNextLoyaltyTier(lifetimePoints: number = 0): {
  nextTier: LoyaltyTierConfig | null;
  pointsNeeded: number;
  progressPct: number;
} {
  const current = getLoyaltyTierForPoints(lifetimePoints);
  const idx = LOYALTY_TIERS.findIndex(t => t.id === current.id);
  const next = idx >= 0 && idx < LOYALTY_TIERS.length - 1 ? LOYALTY_TIERS[idx + 1] : null;
  if (!next) {
    return { nextTier: null, pointsNeeded: 0, progressPct: 100 };
  }
  const span = Math.max(1, next.minLifetimePoints - current.minLifetimePoints);
  const gained = Math.max(0, lifetimePoints - current.minLifetimePoints);
  return {
    nextTier: next,
    pointsNeeded: Math.max(0, next.minLifetimePoints - lifetimePoints),
    progressPct: Math.min(100, Math.round((gained / span) * 100)),
  };
}

export function getLoyaltyTierBadgeColor(tierId: LoyaltyTierId): string {
  switch (tierId) {
    case 'platinum':
      return 'text-cyan-300';
    case 'gold':
      return 'text-amber-300';
    case 'silver':
      return 'text-slate-200';
    default:
      return 'text-orange-300';
  }
}

/**
 * Base rule: 1 point per ₹100 spent * tier multiplier.
 */
export function calculatePointsEarnedForBill(
  netBillAmount: number,
  customer?: Customer | null
): number {
  if (!customer || netBillAmount < 100) return 0;
  const tier = getLoyaltyTierForPoints(customer.lifetimeLoyaltyPoints || 0);
  return Math.max(0, Math.floor((netBillAmount / 100) * tier.earnMultiplier));
}

/**
 * 1 Point = ₹1 discount, capped at 50% of items subtotal.
 */
export function calculateMaxRedeemablePoints(
  availablePoints: number,
  itemsSubtotal: number
): number {
  if (availablePoints <= 0 || itemsSubtotal <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(availablePoints), Math.floor(itemsSubtotal * 0.5)));
}

export function getClaimableMilestones(customer: Customer): LoyaltyMilestone[] {
  const lifetime = customer.lifetimeLoyaltyPoints || 0;
  const claimed = new Set(customer.claimedMilestoneIds || []);
  return LOYALTY_MILESTONES.filter(
    m => lifetime >= m.pointsRequired && !claimed.has(m.id)
  );
}
