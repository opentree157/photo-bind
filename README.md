# PhotoBind

PhotoBind is a quote-to-bind platform prototype for small commercial general liability insurance for photographers.

It models the lifecycle that real insurance systems care about:

- Submission intake
- Eligibility and underwriting referral
- Configurable rating and quote comparison
- Bind request and policy issuance
- Immutable policy snapshots
- Endorsement hooks
- Audit events, webhooks, and admin rate/rule versions

## Run it

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
```

## Portfolio talking points

- Rating is isolated in `src/domain.ts` and produces explainable premium breakdowns.
- Underwriting rules are versioned and return referral or decline triggers.
- The state machine blocks invalid lifecycle transitions.
- Policy issuance snapshots the exact submission, quote option, rating version, and rule version used at bind time.
- The UI includes agent, underwriter, admin, policy, analytics, audit, webhook, and endorsement surfaces.
