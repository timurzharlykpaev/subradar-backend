export interface PlanConfig {
  subscriptionLimit: number | null;
  aiRequestsLimit: number | null;
  hasInvite: boolean;
  canCreateOrg: boolean;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    subscriptionLimit: 5,
    aiRequestsLimit: 10,
    hasInvite: false,
    canCreateOrg: false,
  },
  pro: {
    subscriptionLimit: null,
    aiRequestsLimit: 200,
    hasInvite: true,
    canCreateOrg: false,
  },
  organization: {
    subscriptionLimit: null,
    aiRequestsLimit: null,
    hasInvite: true,
    canCreateOrg: true,
  },
};

export const PLAN_DETAILS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    currency: 'USD',
    features: [
      'Up to 5 subscriptions',
      '10 AI requests per month',
      'Basic analytics',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 2.99,
    yearlyPrice: 24.99,
    currency: 'USD',
    variantIdMonthly: '1377270',
    variantIdYearly: '1377270',
    features: [
      'Unlimited subscriptions',
      '200 AI requests per month',
      'Internet search',
      'Advanced analytics',
      'PDF & CSV reports',
      '1 invite slot (For You + One)',
      '7-day free trial',
    ],
  },
  {
    id: 'organization',
    name: 'Organization',
    price: 9.99,
    yearlyPrice: 99.99,
    currency: 'USD',
    variantIdMonthly: '1377279',
    variantIdYearly: '1377279',
    features: [
      'Everything in Pro',
      'Unlimited AI requests',
      'Create organization',
      'Invite multiple members',
      'Shared team analytics',
      'Role management (Owner / Admin / Member)',
      'Priority AI',
    ],
  },
];
