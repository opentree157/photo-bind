import {
  AuditEvent,
  Policy,
  QuoteOption,
  RatingBreakdown,
  Risk,
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
  renewalWorkItems?: { expiringPolicies: any[]; renewalSubmissions: any[] };
}

export const apiEndpoints = [
  "POST /api/session",
  "POST /api/submissions",
  "GET /api/submissions/:id",
  "POST /api/submissions/:id/submit",
  "POST /api/submissions/:id/quote",
  "GET /api/quotes/:id",
  "POST /api/payment-intents",
  "POST /api/quotes/:id/request_bind",
  "POST /api/underwriting/referrals/:id/approve",
  "POST /api/underwriting/referrals/:id/decline",
  "POST /api/policies/:id/endorsements",
  "POST /api/policies/:policy_id/endorsements/:id/issue",
  "GET /api/policies/:id/documents",
  "GET /api/renewals",
  "POST /api/policies/:id/renewals",
  "POST /api/renewals/:id/request_bind",
  "GET /api/admin/rating-tables",
  "POST /api/admin/rating-tables",
  "POST /api/partner/v1/quotes",
  "POST /api/partner/v1/bind",
  "GET /api/partner/v1/policies/:policy_number"
];

export const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";

export interface ApiSession {
  token: string;
  user: { id: number; name: string; email: string; role: string };
}

export async function createSession(role: string): Promise<ApiSession> {
  return request("/api/session", {
    method: "POST",
    body: JSON.stringify({ role })
  }, undefined);
}

export async function fetchPlatformState(token: string): Promise<PlatformState> {
  const [submissionsJson, policiesJson, auditJson, webhookJson, renewalsJson] = await Promise.all([
    request("/api/submissions", {}, token),
    request("/api/policies", {}, token),
    request("/api/audit-events", {}, token),
    request("/api/webhook-events", {}, token),
    request("/api/renewals", {}, token)
  ]);

  const mappedSubmissions = submissionsJson.map(mapSubmission);
  const mappedPolicies = policiesJson.map(mapPolicy);
  return {
    submissions: mappedSubmissions.length ? mappedSubmissions : [],
    policies: mappedPolicies,
    auditEvents: auditJson.map(mapAuditEvent),
    webhookEvents: webhookJson.map(mapWebhookEvent),
    documents: policiesJson.flatMap((policy: any) => (policy.documents ?? []).map((document: any) => mapDocument(document, String(policy.id)))),
    idempotencyLedger: {},
    renewalWorkItems: {
      expiringPolicies: renewalsJson.expiring_policies ?? [],
      renewalSubmissions: renewalsJson.renewal_submissions ?? []
    }
  };
}

export async function createAndQuoteSubmission(submission: Submission, token: string): Promise<Submission> {
  const created = await request("/api/submissions", {
    method: "POST",
    body: JSON.stringify(toSubmissionPayload(submission))
  }, token);
  const quote = await request(`/api/submissions/${created.id}/quote`, { method: "POST" }, token);
  return mapSubmission(quote.submission ?? { ...created, status: quote.status === "referred" ? "referred" : "quoted", quotes: [quote] });
}

export async function requestBindApi(submission: Submission, tier: string, token: string, paymentIntent = "demo-card"): Promise<void> {
  const quote = await request(`/api/submissions/${submission.id}/quote`, { method: "POST" }, token);
  const option = (quote.quote_options ?? []).find((item: any) => item.tier === tier) ?? quote.quote_options?.[0];
  if (!option) throw new Error("No quote option returned from Rails");
  const intent = await createPaymentIntentApi(Number(quote.id), Number(option.id), token, `payment:${quote.id}:${option.id}`);
  await request(`/api/quotes/${quote.id}/request_bind`, {
    method: "POST",
    headers: { "Idempotency-Key": `bind:${submission.id}:${option.id}` },
    body: JSON.stringify({
      quote_option_id: option.id,
      payment_intent_id: intent.payment_intent_id ?? `pi_${paymentIntent}_${Date.now()}`,
      effective_date: submission.effectiveDate
    })
  }, token);
}

export async function createPaymentIntentApi(quoteId: number, quoteOptionId: number, token: string, idempotencyKey: string) {
  return request("/api/payment-intents", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ quote_id: quoteId, quote_option_id: quoteOptionId })
  }, token);
}

export async function approveReferralApi(referralId: string, token: string, notes: string): Promise<void> {
  await request(`/api/underwriting/referrals/${referralId}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes })
  }, token);
}

export async function declineReferralApi(referralId: string, token: string, notes: string): Promise<void> {
  await request(`/api/underwriting/referrals/${referralId}/decline`, {
    method: "POST",
    body: JSON.stringify({ notes })
  }, token);
}

export async function fetchRatingTable(token: string) {
  return request("/api/admin/rating-tables", {}, token);
}

export async function saveRatingFactor(token: string, factor: Record<string, string | number | boolean>) {
  return request("/api/admin/rating-tables", {
    method: "POST",
    body: JSON.stringify({ rating_factor: factor })
  }, token);
}

export async function createEndorsementApi(policyId: string, token: string, changeRequest: Record<string, string | number>) {
  return request(`/api/policies/${policyId}/endorsements`, {
    method: "POST",
    body: JSON.stringify({
      change_type: changeRequest.change_type ?? "revenue_change",
      effective_date: changeRequest.effective_date ?? new Date().toISOString().slice(0, 10),
      change_request: changeRequest
    })
  }, token);
}

export async function issueEndorsementApi(policyId: string, endorsementId: string, token: string) {
  return request(`/api/policies/${policyId}/endorsements/${endorsementId}/issue`, { method: "POST" }, token);
}

export async function createRenewalApi(policyId: string, token: string) {
  return request(`/api/policies/${policyId}/renewals`, { method: "POST" }, token);
}

export async function bindRenewalQuoteApi(quoteId: string, quoteOptionId: string, effectiveDate: string, token: string) {
  const intent = await createPaymentIntentApi(Number(quoteId), Number(quoteOptionId), token, `renewal-payment:${quoteId}:${quoteOptionId}`);
  return request(`/api/renewals/${quoteId}/request_bind`, {
    method: "POST",
    headers: { "Idempotency-Key": `renewal-bind:${quoteId}:${quoteOptionId}` },
    body: JSON.stringify({
      quote_option_id: quoteOptionId,
      payment_intent_id: intent.payment_intent_id,
      effective_date: effectiveDate
    })
  }, token);
}

async function request(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  return response.json();
}

function mapSubmission(item: any): Submission {
  const business = item.business ?? {};
  const risk = item.risk ?? {};
  const location = business.locations?.[0] ?? {};
  return {
    id: String(item.id),
    agency: item.agency?.name ?? "Northlight Agency",
    producer: item.created_by?.name ?? "Rails API",
    status: item.status,
    business: {
      name: business.legal_name ?? "Untitled business",
      contact: business.contact_name ?? business.legal_name ?? "Unknown",
      email: business.email ?? "",
      state: (risk.state ?? location.state ?? "MA") as Submission["business"]["state"],
      city: location.city ?? "Unknown",
      annualRevenue: centsToDollars(risk.annual_revenue_cents),
      payroll: centsToDollars(risk.payroll_cents),
      yearsInBusiness: business.years_in_business ?? 0,
      priorClaimsCount: risk.prior_claims_count ?? 0
    },
    risk: {
      classCode: normalizeClassCode(risk.class_code),
      usesDrones: Boolean(risk.uses_drones),
      pyrotechnics: Boolean(risk.uses_pyrotechnics),
      eventWorkPercent: risk.event_work_percent ?? 0,
      limit: centsToDollars(risk.requested_limit_cents) === 2_000_000 ? 2_000_000 : 1_000_000,
      deductible: normalizeDeductible(centsToDollars(risk.requested_deductible_cents))
    },
    effectiveDate: item.effective_date ?? new Date().toISOString().slice(0, 10),
    createdAt: item.created_at ?? new Date().toISOString(),
    ruleVersion: item.quotes?.[0]?.rules_version ?? "v3",
    ratingVersion: item.quotes?.[0]?.rating_version ?? "2026.05.01"
  };
}

function mapPolicy(item: any): Policy {
  const snapshot = item.policy_snapshot ?? {};
  const mappedSubmission = snapshot.submission ? mapSubmission(snapshot.submission) : mapSubmission(item.submission ?? {});
  const option = item.quote_option ?? snapshot.selected_option ?? {};
  const quoteOption: QuoteOption = {
    id: String(option.id ?? `${mappedSubmission.id}-OPT-1`),
    tier: option.tier ?? "Standard",
    limit: `$${centsToDollars(option.limit_cents).toLocaleString()} occurrence`,
    deductible: centsToDollars(option.deductible_cents) as QuoteOption["deductible"],
    endorsements: option.tier === "Premium" ? ["General liability", "Additional insured blanket", "Worldwide shoots"] : ["General liability"],
    breakdown: mapBreakdown(option.breakdown ?? {})
  };
  return {
    id: String(item.id),
    policyNumber: item.policy_number,
    submissionId: String(item.submission_id),
    quoteId: String(item.quote_id),
    insured: mappedSubmission.business.name,
    status: item.status,
    effectiveDate: item.effective_date,
    expirationDate: item.expiration_date,
    premium: centsToDollars(option.total_due_cents),
    snapshot: {
      submission: mappedSubmission,
      quoteOption,
      ruleVersion: snapshot.rules_version ?? snapshot.ruleVersion ?? item.quote?.rules_version ?? "v3",
      ratingVersion: snapshot.rating_version ?? snapshot.ratingVersion ?? item.quote?.rating_version ?? "2026.05.01",
      issuedAt: snapshot.bound_at ?? item.created_at
    },
    endorsements: item.endorsements ?? []
  } as Policy & { endorsements: any[] };
}

function mapBreakdown(breakdown: any): RatingBreakdown {
  return {
    baseRate: Number(breakdown.base_rate ?? breakdown.baseRate ?? 0),
    classFactor: Number(breakdown.class_factor ?? breakdown.classFactor ?? 1),
    territoryFactor: Number(breakdown.territory_factor ?? breakdown.territoryFactor ?? 1),
    revenueFactor: Number(breakdown.revenue_factor ?? breakdown.revenueFactor ?? 1),
    claimsFactor: Number(breakdown.claims_factor ?? breakdown.claimsFactor ?? 1),
    limitFactor: Number(breakdown.limit_factor ?? breakdown.limitFactor ?? 1),
    deductibleFactor: Number(breakdown.deductible_factor ?? breakdown.deductibleFactor ?? 1),
    annualPremium: Number(breakdown.annual_premium ?? breakdown.annualPremium ?? 0),
    policyFee: Number(breakdown.policy_fee ?? breakdown.policyFee ?? 75),
    stateTax: Number(breakdown.state_tax ?? breakdown.stateTax ?? 0),
    stampingFee: Number(breakdown.stamping_fee ?? breakdown.stampingFee ?? 0),
    totalDue: Number(breakdown.total_due ?? breakdown.totalDue ?? 0)
  };
}

function mapDocument(item: any, policyId: string): DocumentRecord {
  return {
    id: String(item.id),
    policyId,
    name: item.document_type === "declarations" ? "Declaration page PDF" : item.document_type,
    status: item.status === "generated" ? "generated" : "queued",
    generatedAt: item.updated_at,
    html: ""
  };
}

function mapAuditEvent(item: any): AuditEvent {
  return {
    id: String(item.id),
    actor: item.user_id ? `User ${item.user_id}` : "System",
    entity: `${item.subject_type} ${item.subject_id}`,
    action: item.event_type,
    detail: item.message,
    createdAt: item.created_at
  };
}

function mapWebhookEvent(item: any): WebhookEvent {
  return {
    id: String(item.id),
    type: item.event_type,
    payload: JSON.stringify(item.payload),
    status: item.status === "delivered" ? "delivered" : "queued"
  };
}

function toSubmissionPayload(submission: Submission) {
  return {
    source: submission.agency === "Direct" ? "partner" : "agent",
    effective_date: submission.effectiveDate,
    business: {
      legal_name: submission.business.name,
      contact_name: submission.business.contact,
      email: submission.business.email,
      business_class: "photographer",
      years_in_business: submission.business.yearsInBusiness
    },
    location: {
      line1: "Applicant provided",
      city: submission.business.city || "Applicant city",
      state: submission.business.state,
      postal_code: "00000"
    },
    risk: {
      annual_revenue_cents: dollarsToCents(submission.business.annualRevenue),
      payroll_cents: dollarsToCents(submission.business.payroll),
      prior_claims_count: submission.business.priorClaimsCount,
      uses_drones: submission.risk.usesDrones,
      uses_pyrotechnics: submission.risk.pyrotechnics,
      event_work_percent: submission.risk.eventWorkPercent,
      class_code: submission.risk.classCode,
      requested_limit_cents: dollarsToCents(submission.risk.limit),
      requested_deductible_cents: dollarsToCents(submission.risk.deductible)
    },
    applicant_answers: submission
  };
}

function centsToDollars(value: number | string | null | undefined) {
  return Math.round(Number(value ?? 0) / 100);
}

function dollarsToCents(value: number) {
  return Math.round(value * 100);
}

function normalizeClassCode(value: string | undefined): Risk["classCode"] {
  if (value === "PHOTO-WEDDING" || value === "PHOTO-STUDIO" || value === "PHOTO-DRONE") return value;
  return "PHOTO-PORTRAIT";
}

function normalizeDeductible(value: number): Risk["deductible"] {
  if (value === 500 || value === 2500) return value;
  return 1000;
}

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
