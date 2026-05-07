export type Role = "agent" | "underwriter" | "admin" | "applicant";

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "ineligible"
  | "quoted"
  | "referred"
  | "approved"
  | "declined"
  | "bind_requested"
  | "bound"
  | "issued"
  | "endorsement_pending"
  | "cancelled";

export type StateCode = "MA" | "CT" | "RI" | "NH" | "NY" | "VT";

export type QuoteTier = "Basic" | "Standard" | "Premium";

export type RuleAction = "decline" | "refer";

export interface Business {
  name: string;
  contact: string;
  email: string;
  state: StateCode;
  city: string;
  annualRevenue: number;
  payroll: number;
  yearsInBusiness: number;
  priorClaimsCount: number;
}

export interface Risk {
  classCode: "PHOTO-PORTRAIT" | "PHOTO-WEDDING" | "PHOTO-STUDIO" | "PHOTO-DRONE";
  usesDrones: boolean;
  pyrotechnics: boolean;
  eventWorkPercent: number;
  limit: 1_000_000 | 2_000_000;
  deductible: 500 | 1000 | 2500;
}

export interface Submission {
  id: string;
  agency: string;
  producer: string;
  status: SubmissionStatus;
  business: Business;
  risk: Risk;
  effectiveDate: string;
  createdAt: string;
  ruleVersion: string;
  ratingVersion: string;
  selectedQuoteOptionId?: string;
}

export interface RatingBreakdown {
  baseRate: number;
  classFactor: number;
  territoryFactor: number;
  revenueFactor: number;
  claimsFactor: number;
  limitFactor: number;
  deductibleFactor: number;
  annualPremium: number;
  policyFee: number;
  stateTax: number;
  stampingFee: number;
  totalDue: number;
}

export interface QuoteOption {
  id: string;
  tier: QuoteTier;
  limit: string;
  deductible: number;
  endorsements: string[];
  breakdown: RatingBreakdown;
}

export interface Quote {
  id: string;
  submissionId: string;
  status: "active" | "referred" | "bound" | "expired";
  createdAt: string;
  ratingVersion: string;
  ruleVersion: string;
  options: QuoteOption[];
}

export interface UnderwritingRule {
  code: string;
  label: string;
  version: string;
  action: RuleAction;
  test: (submission: Submission) => boolean;
}

export interface RuleTrigger {
  code: string;
  label: string;
  action: RuleAction;
}

export interface Referral {
  id: string;
  submissionId: string;
  status: "open" | "approved" | "declined";
  triggers: RuleTrigger[];
  notes: string[];
  assignedTo: string;
}

export interface Policy {
  id: string;
  policyNumber: string;
  submissionId: string;
  quoteId: string;
  insured: string;
  status: "bound" | "issued";
  effectiveDate: string;
  expirationDate: string;
  premium: number;
  snapshot: {
    submission: Submission;
    quoteOption: QuoteOption;
    ruleVersion: string;
    ratingVersion: string;
    issuedAt: string;
  };
}

export interface Endorsement {
  id: string;
  policyId: string;
  type: "limit_change" | "revenue_change" | "address_change";
  status: "draft" | "quoted" | "issued";
  premiumDelta: number;
}

export interface AuditEvent {
  id: string;
  actor: string;
  entity: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  payload: string;
  status: "queued" | "delivered";
}

export const transitionMap: Record<SubmissionStatus, SubmissionStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["quoted", "referred", "ineligible"],
  ineligible: [],
  quoted: ["bind_requested", "referred", "cancelled"],
  referred: ["approved", "declined"],
  approved: ["quoted"],
  declined: [],
  bind_requested: ["bound", "cancelled"],
  bound: ["issued"],
  issued: ["endorsement_pending", "cancelled"],
  endorsement_pending: ["issued"],
  cancelled: []
};

export function canTransition(from: SubmissionStatus, to: SubmissionStatus) {
  return transitionMap[from].includes(to);
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

export function dollars(value: number) {
  return currency.format(value);
}

export const underwritingRules: UnderwritingRule[] = [
  {
    code: "UNSUPPORTED_STATE",
    label: "Unsupported operating state",
    version: "UW-2026.05-v3",
    action: "decline",
    test: (submission) => !["MA", "CT", "RI", "NH"].includes(submission.business.state)
  },
  {
    code: "PYROTECHNICS",
    label: "Pyrotechnics exposure",
    version: "UW-2026.05-v3",
    action: "decline",
    test: (submission) => submission.risk.pyrotechnics
  },
  {
    code: "DRONE_WORK",
    label: "Drone operations need underwriter approval",
    version: "UW-2026.05-v3",
    action: "refer",
    test: (submission) => submission.risk.usesDrones || submission.risk.classCode === "PHOTO-DRONE"
  },
  {
    code: "HIGH_REVENUE",
    label: "Annual revenue exceeds automatic authority",
    version: "UW-2026.05-v3",
    action: "refer",
    test: (submission) => submission.business.annualRevenue > 2_000_000
  },
  {
    code: "PRIOR_CLAIMS",
    label: "Prior claims count exceeds appetite",
    version: "UW-2026.05-v3",
    action: "refer",
    test: (submission) => submission.business.priorClaimsCount >= 2
  }
];

export function evaluateEligibility(submission: Submission): RuleTrigger[] {
  return underwritingRules
    .filter((rule) => rule.test(submission))
    .map((rule) => ({ code: rule.code, label: rule.label, action: rule.action }));
}

const classFactors: Record<Risk["classCode"], number> = {
  "PHOTO-PORTRAIT": 1.0,
  "PHOTO-WEDDING": 1.18,
  "PHOTO-STUDIO": 0.94,
  "PHOTO-DRONE": 1.35
};

const territoryFactors: Record<StateCode, number> = {
  MA: 1.12,
  CT: 1.06,
  RI: 1.02,
  NH: 0.96,
  NY: 1.28,
  VT: 1.0
};

export function revenueFactor(revenue: number) {
  if (revenue < 250_000) return 0.86;
  if (revenue < 750_000) return 1.0;
  if (revenue < 1_500_000) return 1.22;
  return 1.42;
}

export function rateSubmission(submission: Submission, overrides: Partial<Risk> = {}): RatingBreakdown {
  const risk = { ...submission.risk, ...overrides };
  const baseRate = 520;
  const classFactor = classFactors[risk.classCode];
  const territoryFactor = territoryFactors[submission.business.state];
  const revFactor = revenueFactor(submission.business.annualRevenue);
  const claimsFactor = 1 + Math.min(submission.business.priorClaimsCount, 4) * 0.12;
  const limitFactor = risk.limit === 2_000_000 ? 1.32 : 1.0;
  const deductibleFactor = risk.deductible === 2500 ? 0.9 : risk.deductible === 1000 ? 0.96 : 1.0;
  const annualPremium = roundMoney(baseRate * classFactor * territoryFactor * revFactor * claimsFactor * limitFactor * deductibleFactor);
  const policyFee = 85;
  const stateTax = roundMoney(annualPremium * 0.035);
  const stampingFee = roundMoney(annualPremium * 0.008);
  const totalDue = roundMoney(annualPremium + policyFee + stateTax + stampingFee);

  return {
    baseRate,
    classFactor,
    territoryFactor,
    revenueFactor: revFactor,
    claimsFactor,
    limitFactor,
    deductibleFactor,
    annualPremium,
    policyFee,
    stateTax,
    stampingFee,
    totalDue
  };
}

export function buildQuote(submission: Submission): Quote {
  const tiers: Array<{ tier: QuoteTier; deductible: Risk["deductible"]; limit: Risk["limit"]; endorsements: string[] }> = [
    { tier: "Basic", deductible: 2500, limit: 1_000_000, endorsements: ["General liability", "Damage to rented premises"] },
    { tier: "Standard", deductible: 1000, limit: submission.risk.limit, endorsements: ["General liability", "Professional liability sublimit", "Hired equipment"] },
    { tier: "Premium", deductible: 500, limit: 2_000_000, endorsements: ["General liability", "Additional insured blanket", "Worldwide shoots", "Hired equipment"] }
  ];

  return {
    id: `Q-${submission.id}`,
    submissionId: submission.id,
    status: submission.status === "referred" ? "referred" : "active",
    createdAt: "2026-05-06T14:22:00Z",
    ratingVersion: submission.ratingVersion,
    ruleVersion: submission.ruleVersion,
    options: tiers.map((tier, index) => ({
      id: `${submission.id}-OPT-${index + 1}`,
      tier: tier.tier,
      limit: `$${tier.limit.toLocaleString()} occurrence`,
      deductible: tier.deductible,
      endorsements: tier.endorsements,
      breakdown: rateSubmission(submission, { deductible: tier.deductible, limit: tier.limit })
    }))
  };
}

export function bindPolicy(submission: Submission, quote: Quote, option: QuoteOption): Policy {
  const issuedAt = "2026-05-06T15:04:00Z";
  return {
    id: `POL-${submission.id}`,
    policyNumber: `PB-GL-${submission.business.state}-2026-${submission.id.slice(-4)}`,
    submissionId: submission.id,
    quoteId: quote.id,
    insured: submission.business.name,
    status: "issued",
    effectiveDate: submission.effectiveDate,
    expirationDate: "2027-05-06",
    premium: option.breakdown.totalDue,
    snapshot: {
      submission: structuredClone(submission),
      quoteOption: structuredClone(option),
      ruleVersion: submission.ruleVersion,
      ratingVersion: submission.ratingVersion,
      issuedAt
    }
  };
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
