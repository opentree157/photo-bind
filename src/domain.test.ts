import { describe, expect, it } from "vitest";
import { submissions } from "./data";
import { bindPolicy, buildQuote, canTransition, evaluateEligibility, rateSubmission } from "./domain";

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
