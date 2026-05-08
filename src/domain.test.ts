import { describe, expect, it } from "vitest";
import { auditEvents, policies, submissions, webhookEvents } from "./data";
import { bindPolicy, buildQuote, canTransition, evaluateEligibility, rateSubmission } from "./domain";
import { PlatformState, bindSubmission, quoteSubmission } from "./platform";

describe("rating engine", () => {
  it("produces a golden premium breakdown for an automatic portrait submission", () => {
    const breakdown = rateSubmission(submissions[0]);

    expect(breakdown).toMatchObject({
      baseRate: 520,
      classFactor: 1,
      territoryFactor: 1.12,
      revenueFactor: 1,
      claimsFactor: 1,
      deductibleFactor: 0.96,
      annualPremium: 559.1,
      policyFee: 85,
      stateTax: 19.57,
      stampingFee: 4.47,
      totalDue: 668.14
    });
  });
});

describe("platform commands", () => {
  it("quotes through the workflow and enforces idempotent bind", () => {
    const quotedSubmission = quoteSubmission({ ...submissions[0], status: "draft" });
    const quote = buildQuote(quotedSubmission);
    const state: PlatformState = {
      submissions: [quotedSubmission],
      policies: [],
      auditEvents,
      webhookEvents,
      documents: [],
      idempotencyLedger: {}
    };

    const boundOnce = bindSubmission(state, quotedSubmission.id, quote.options[1].id, "Agent", "bind-key-1");
    const boundTwice = bindSubmission(boundOnce, quotedSubmission.id, quote.options[1].id, "Agent", "bind-key-1");

    expect(quotedSubmission.status).toBe("quoted");
    expect(boundOnce.policies).toHaveLength(1);
    expect(boundOnce.documents[0].status).toBe("generated");
    expect(boundTwice.policies).toHaveLength(1);
    expect(boundTwice.auditEvents[0].action).toBe("bind.idempotent_replay");
  });

  it("rejects invalid workflow jumps", () => {
    const quote = buildQuote(submissions[0]);
    const state: PlatformState = {
      submissions: [{ ...submissions[0], status: "submitted" }],
      policies,
      auditEvents,
      webhookEvents,
      documents: [],
      idempotencyLedger: {}
    };

    expect(() => bindSubmission(state, submissions[0].id, quote.options[1].id, "Agent", "bad-jump")).toThrow("Invalid transition");
  });
});

describe("underwriting rules", () => {
  it("refers drone work with prior claims and declines pyrotechnics", () => {
    expect(evaluateEligibility(submissions[1]).map((trigger) => trigger.code)).toEqual(["DRONE_WORK", "PRIOR_CLAIMS"]);
    expect(evaluateEligibility(submissions[3]).map((trigger) => trigger.code)).toEqual(["PYROTECHNICS"]);
  });
});

describe("workflow state machine", () => {
  it("permits only declared lifecycle transitions", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("quoted", "issued")).toBe(false);
    expect(canTransition("bound", "issued")).toBe(true);
  });
});

describe("policy snapshots", () => {
  it("copies the bound rating and rule versions into an immutable issue snapshot", () => {
    const submission = submissions[0];
    const quote = buildQuote(submission);
    const policy = bindPolicy(submission, quote, quote.options[1]);

    submission.ratingVersion = "RT-FUTURE";

    expect(policy.snapshot.ratingVersion).toBe("RT-2026.05.01");
    expect(policy.snapshot.submission.ratingVersion).toBe("RT-2026.05.01");
  });
});
