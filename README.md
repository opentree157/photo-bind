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
- Rails 8.1 API backend on Ruby 4.0 with PostgreSQL persistence
- Real API controllers for quote, bind, documents, audit, webhooks, referrals, admin rating tables, and partner endpoints
- Idempotent bind requests

## Run it

```bash
npm install
npm run dev
```

## Rails API

The production-style backend lives in `backend/` and was generated with Rails 8.1.3 on a workspace-local Ruby 4.0.3 install.

```bash
cd backend
GEM_HOME=../.gems/ruby-4.0.3 GEM_PATH=../.gems/ruby-4.0.3 PATH=../.gems/ruby-4.0.3/bin:../.rubies/ruby-4.0.3/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH bundle exec rails server -p 3000
```

Key endpoints include:

- `POST /api/submissions`
- `POST /api/submissions/:id/quote`
- `POST /api/quotes/:id/request_bind`
- `POST /api/underwriting/referrals/:id/approve`
- `POST /api/policies/:policy_id/endorsements`
- `GET /api/policies/:policy_id/documents/:document_id`
- `GET /api/admin/rating-tables`
- `POST /api/partner/v1/quotes`
- `POST /api/partner/v1/bind`

## Verify

```bash
npm test
npm run build

cd backend
GEM_HOME=../.gems/ruby-4.0.3 GEM_PATH=../.gems/ruby-4.0.3 PATH=../.gems/ruby-4.0.3/bin:../.rubies/ruby-4.0.3/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH bundle exec rails test
```

## Portfolio talking points

- Rating is isolated in `src/domain.ts` and produces explainable premium breakdowns.
- Rails services handle workflow transitions, explainable rating, idempotent bind, policy snapshots, PDF generation, audit events, and webhook records.
- Underwriting rules are versioned and return referral or decline triggers.
- The state machine blocks invalid lifecycle transitions.
- Policy issuance snapshots the exact submission, quote option, rating version, and rule version used at bind time.
- PostgreSQL stores submissions, businesses, risks, quotes, quote options, referrals, policies, policy terms, documents, audit events, payments, webhook events, rating factors, rules, and idempotency keys.
- The UI includes agent, underwriter, admin, policy, analytics, audit, webhook, and endorsement surfaces.
