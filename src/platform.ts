import {
  AuditEvent,
  Policy,
  QuoteOption,
  Submission,
  WebhookEvent,
  bindPolicy,
  buildQuote,
  canTransition,
  evaluateEligibility
} from "./domain";

export interface DocumentRecord {
  id: string;
  policyId: string;
  name: string;
  status: "queued" | "generated";
  generatedAt: string;
  html: string;
}

export interface PlatformState {
  submissions: Submission[];
  policies: Policy[];
  auditEvents: AuditEvent[];
  webhookEvents: WebhookEvent[];
  documents: DocumentRecord[];
  idempotencyLedger: Record<string, string>;
}

export const apiEndpoints = [
  "POST /api/submissions",
  "GET /api/submissions/:id",
  "POST /api/submissions/:id/submit",
  "POST /api/submissions/:id/quote",
  "GET /api/quotes/:id",
  "POST /api/quotes/:id/request_bind",
  "POST /api/underwriting/referrals/:id/approve",
  "POST /api/underwriting/referrals/:id/decline",
  "POST /api/policies/:id/endorsements",
  "GET /api/policies/:id/documents",
  "GET /api/admin/rating-tables",
  "POST /api/admin/rating-tables",
  "POST /api/partner/v1/quotes",
  "POST /api/partner/v1/bind",
  "GET /api/partner/v1/policies/:policy_number"
];

export function transitionSubmission(submission: Submission, to: Submission["status"]): Submission {
  if (submission.status === to) return submission;
  if (!canTransition(submission.status, to)) {
    throw new Error(`Invalid transition: ${submission.status} -> ${to}`);
  }
  return { ...submission, status: to };
}

export function quoteSubmission(submission: Submission): Submission {
  const triggers = evaluateEligibility(submission);
  const nextStatus = triggers.some((trigger) => trigger.action === "decline")
    ? "ineligible"
    : triggers.some((trigger) => trigger.action === "refer")
      ? "referred"
      : "quoted";

  return transitionSubmission(submission.status === "draft" ? transitionSubmission(submission, "submitted") : submission, nextStatus);
}

export function upsertSubmission(state: PlatformState, submission: Submission, actor: string): PlatformState {
  const exists = state.submissions.some((item) => item.id === submission.id);
  return {
    ...state,
    submissions: [submission, ...state.submissions.filter((item) => item.id !== submission.id)],
    auditEvents: [
      audit(actor, submission.id, exists ? "submission.updated" : "submission.created", `${submission.business.name} is ${submission.status}`),
      ...state.auditEvents
    ]
  };
}

export function bindSubmission(
  state: PlatformState,
  submissionId: string,
  optionId: string,
  actor: string,
  idempotencyKey: string
): PlatformState {
  const existingPolicyId = state.idempotencyLedger[idempotencyKey];
  if (existingPolicyId) {
    return {
      ...state,
      auditEvents: [
        audit(actor, submissionId, "bind.idempotent_replay", `Returned existing policy ${existingPolicyId} for ${idempotencyKey}`),
        ...state.auditEvents
      ]
    };
  }

  const submission = state.submissions.find((item) => item.id === submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found`);
  const quote = buildQuote(submission);
  const option = quote.options.find((item) => item.id === optionId) ?? quote.options[1];
  const bindRequested = transitionSubmission(submission, "bind_requested");
  const bound = transitionSubmission(bindRequested, "bound");
  const issued = transitionSubmission(bound, "issued");
  const policy = bindPolicy(issued, quote, option);
  const document = declarationDocument(policy, option);

  return {
    ...state,
    submissions: state.submissions.map((item) => (item.id === submission.id ? { ...issued, selectedQuoteOptionId: option.id } : item)),
    policies: [policy, ...state.policies.filter((item) => item.id !== policy.id)],
    documents: [document, ...state.documents.filter((item) => item.id !== document.id)],
    idempotencyLedger: { ...state.idempotencyLedger, [idempotencyKey]: policy.id },
    auditEvents: [
      audit(actor, policy.policyNumber, "policy.issued", `Issued from ${submission.id} with idempotency key ${idempotencyKey}`),
      audit("System", document.id, "document.generated", `Generated declaration PDF for ${policy.policyNumber}`),
      audit(actor, submission.id, "bind.requested", `Selected ${option.tier} at ${formatCurrency(option.breakdown.totalDue)}`),
      ...state.auditEvents
    ],
    webhookEvents: [
      webhook("policy.issued", `{ policy_number: '${policy.policyNumber}' }`),
      webhook("policy.bound", `{ policy_number: '${policy.policyNumber}' }`),
      ...state.webhookEvents
    ]
  };
}

export function declarationDocument(policy: Policy, option: QuoteOption): DocumentRecord {
  return {
    id: `DOC-DEC-${policy.policyNumber}`,
    policyId: policy.id,
    name: "Declaration page PDF",
    status: "generated",
    generatedAt: new Date().toISOString(),
    html: `<h1>${policy.policyNumber}</h1><p>${policy.insured}</p><p>${option.tier} ${option.limit}</p>`
  };
}

function audit(actor: string, entity: string, action: string, detail: string): AuditEvent {
  return {
    id: `AUD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    actor,
    entity,
    action,
    detail,
    createdAt: new Date().toISOString()
  };
}

function webhook(type: string, payload: string): WebhookEvent {
  return {
    id: `WH-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    payload,
    status: "queued"
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency", maximumFractionDigits: 0 }).format(value);
}
