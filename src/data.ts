import { AuditEvent, Endorsement, Policy, Quote, Referral, Submission, WebhookEvent, bindPolicy, buildQuote, evaluateEligibility } from "./domain";

export const submissions: Submission[] = [
  {
    id: "SUB-1007",
    agency: "Harbor Light Agency",
    producer: "Maya Patel",
    status: "quoted",
    business: {
      name: "North Shore Portrait Co.",
      contact: "Elena Russo",
      email: "elena@northshoreportraits.example",
      state: "MA",
      city: "Salem",
      annualRevenue: 640000,
      payroll: 210000,
      yearsInBusiness: 7,
      priorClaimsCount: 0
    },
    risk: {
      classCode: "PHOTO-PORTRAIT",
      usesDrones: false,
      pyrotechnics: false,
      eventWorkPercent: 18,
      limit: 1_000_000,
      deductible: 1000
    },
    effectiveDate: "2026-06-01",
    createdAt: "2026-05-06T13:10:00Z",
    ruleVersion: "UW-2026.05-v3",
    ratingVersion: "RT-2026.05.01"
  },
  {
    id: "SUB-1011",
    agency: "Bay State Producers",
    producer: "Jon Bell",
    status: "referred",
    business: {
      name: "Aperture Event Works",
      contact: "Noah Kim",
      email: "noah@apertureevent.example",
      state: "CT",
      city: "New Haven",
      annualRevenue: 1850000,
      payroll: 650000,
      yearsInBusiness: 4,
      priorClaimsCount: 2
    },
    risk: {
      classCode: "PHOTO-DRONE",
      usesDrones: true,
      pyrotechnics: false,
      eventWorkPercent: 72,
      limit: 2_000_000,
      deductible: 1000
    },
    effectiveDate: "2026-05-20",
    createdAt: "2026-05-06T13:44:00Z",
    ruleVersion: "UW-2026.05-v3",
    ratingVersion: "RT-2026.05.01"
  },
  {
    id: "SUB-1014",
    agency: "Granite Risk Partners",
    producer: "Lena Ortiz",
    status: "issued",
    selectedQuoteOptionId: "SUB-1014-OPT-2",
    business: {
      name: "Clear Frame Studio LLC",
      contact: "Sam Warren",
      email: "sam@clearframe.example",
      state: "NH",
      city: "Portsmouth",
      annualRevenue: 390000,
      payroll: 120000,
      yearsInBusiness: 11,
      priorClaimsCount: 1
    },
    risk: {
      classCode: "PHOTO-STUDIO",
      usesDrones: false,
      pyrotechnics: false,
      eventWorkPercent: 8,
      limit: 1_000_000,
      deductible: 1000
    },
    effectiveDate: "2026-05-06",
    createdAt: "2026-05-05T19:18:00Z",
    ruleVersion: "UW-2026.05-v3",
    ratingVersion: "RT-2026.05.01"
  },
  {
    id: "SUB-1016",
    agency: "Ocean State Brokerage",
    producer: "Rae Morgan",
    status: "ineligible",
    business: {
      name: "Spark & Shutter Productions",
      contact: "Ari Lane",
      email: "ari@sparkshutter.example",
      state: "RI",
      city: "Providence",
      annualRevenue: 820000,
      payroll: 300000,
      yearsInBusiness: 2,
      priorClaimsCount: 0
    },
    risk: {
      classCode: "PHOTO-WEDDING",
      usesDrones: false,
      pyrotechnics: true,
      eventWorkPercent: 91,
      limit: 2_000_000,
      deductible: 500
    },
    effectiveDate: "2026-06-15",
    createdAt: "2026-05-06T15:01:00Z",
    ruleVersion: "UW-2026.05-v3",
    ratingVersion: "RT-2026.05.01"
  }
];

export const quotes: Quote[] = submissions.filter((submission) => submission.status !== "ineligible").map(buildQuote);

export const referrals: Referral[] = submissions
  .filter((submission) => submission.status === "referred")
  .map((submission) => ({
    id: `REF-${submission.id}`,
    submissionId: submission.id,
    status: "open",
    triggers: evaluateEligibility(submission),
    notes: ["Requested drone operations questionnaire", "Loss run review pending"],
    assignedTo: "Avery Brooks"
  }));

const issuedSubmission = submissions.find((submission) => submission.id === "SUB-1014")!;
const issuedQuote = buildQuote(issuedSubmission);
const issuedOption = issuedQuote.options[1];

export const policies: Policy[] = [bindPolicy(issuedSubmission, issuedQuote, issuedOption)];

export const endorsements: Endorsement[] = [
  {
    id: "END-209",
    policyId: policies[0].id,
    type: "revenue_change",
    status: "quoted",
    premiumDelta: 184
  }
];

export const auditEvents: AuditEvent[] = [
  {
    id: "AUD-9001",
    actor: "System",
    entity: "SUB-1011",
    action: "referral.triggered",
    detail: "Triggered DRONE_WORK and PRIOR_CLAIMS using UW-2026.05-v3",
    createdAt: "2026-05-06T13:45:00Z"
  },
  {
    id: "AUD-9002",
    actor: "Maya Patel",
    entity: "SUB-1007",
    action: "quote.created",
    detail: "Rated 3 options using RT-2026.05.01",
    createdAt: "2026-05-06T14:22:00Z"
  },
  {
    id: "AUD-9003",
    actor: "System",
    entity: policies[0].policyNumber,
    action: "policy.issued",
    detail: "Generated declaration page and immutable policy snapshot",
    createdAt: "2026-05-06T15:04:00Z"
  },
  {
    id: "AUD-9004",
    actor: "Lena Ortiz",
    entity: "END-209",
    action: "endorsement.quoted",
    detail: "Revenue change from $390k to $520k produced $184 premium delta",
    createdAt: "2026-05-06T15:25:00Z"
  }
];

export const webhookEvents: WebhookEvent[] = [
  { id: "WH-710", type: "quote.created", payload: "{ submission_id: 'SUB-1007' }", status: "delivered" },
  { id: "WH-711", type: "quote.referred", payload: "{ submission_id: 'SUB-1011' }", status: "queued" },
  { id: "WH-712", type: "policy.issued", payload: "{ policy_number: 'PB-GL-NH-2026-1014' }", status: "delivered" }
];
