import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, fetchPlatformState } from "./platform";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(body)
  } as unknown as Response);
}

describe("Rails platform adapter", () => {
  it("creates a signed session and maps Rails state into UI state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/session")) return jsonResponse({ token: "token-1", user: { id: 1, role: "agent", name: "Agent", email: "agent@test" } });
      if (url.endsWith("/api/submissions")) {
        return jsonResponse([
          {
            id: 7,
            status: "quoted",
            effective_date: "2026-06-01",
            created_at: "2026-05-08T00:00:00Z",
            business: { legal_name: "Adapter Photo", contact_name: "Ada", email: "ada@test", years_in_business: 2, locations: [{ city: "Boston", state: "MA" }] },
            risk: { state: "MA", annual_revenue_cents: 25000000, payroll_cents: 5000000, prior_claims_count: 0, class_code: "PHOTO-PORTRAIT", requested_limit_cents: 100000000, requested_deductible_cents: 100000, uses_drones: false, uses_pyrotechnics: false, event_work_percent: 25 },
            quotes: [{ rating_version: "2026.05.01", rules_version: "v3" }]
          }
        ]);
      }
      if (url.endsWith("/api/policies")) return jsonResponse([]);
      if (url.endsWith("/api/audit-events")) return jsonResponse([]);
      if (url.endsWith("/api/webhook-events")) return jsonResponse([]);
      if (url.endsWith("/api/renewals")) return jsonResponse({ expiring_policies: [], renewal_submissions: [] });
      throw new Error(`Unexpected URL ${url}`);
    });

    const session = await createSession("agent");
    const state = await fetchPlatformState(session.token);

    expect(session.token).toBe("token-1");
    expect(state.submissions[0].business.name).toBe("Adapter Photo");
    expect(state.submissions[0].business.annualRevenue).toBe(250000);
    expect(state.renewalWorkItems?.expiringPolicies).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });
});
