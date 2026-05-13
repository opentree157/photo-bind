require "test_helper"

class PhotobindApiTest < ActionDispatch::IntegrationTest
  setup do
    @organization = Organization.create!(name: "Test Carrier")
    @agency = Agency.create!(organization: @organization, name: "Test Agency", producer_code: "TST")
    @agent = User.create!(organization: @organization, agency: @agency, name: "Agent", email: "agent-test@example.test", role: "agent")
    @underwriter = User.create!(organization: @organization, name: "Underwriter", email: "uw-test@example.test", role: "underwriter")
    @admin = User.create!(organization: @organization, name: "Admin", email: "admin-test@example.test", role: "admin")
    seed_product_parameters
    seed_rules
    seed_factors
  end

  test "agent can quote and bind idempotently while document job is enqueued" do
    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    token = response.parsed_body["token"]

    post "/api/submissions", headers: auth(token), params: submission_payload(prior_claims_count: 0), as: :json
    assert_response :created
    submission_id = response.parsed_body["id"]

    post "/api/submissions/#{submission_id}/quote", headers: auth(token), as: :json
    assert_response :success
    quote = response.parsed_body
    option = quote["quote_options"].find { |row| row["tier"] == "Premium" }
    assert_equal 1, UnderwritingDecision.where(submission_id:, outcome: "accepted").count

    post "/api/payment-intents",
      headers: auth(token).merge("Idempotency-Key" => "intent-once"),
      params: { quote_id: quote["id"], quote_option_id: option["id"] },
      as: :json
    assert_response :created
    payment_intent = response.parsed_body["payment_intent_id"]
    assert_match(/^pi_/, payment_intent)

    assert_enqueued_with(job: DocumentGenerationJob) do
      post "/api/quotes/#{quote['id']}/request_bind",
        headers: auth(token).merge("Idempotency-Key" => "bind-once"),
        params: { quote_option_id: option["id"], payment_intent_id: payment_intent, effective_date: Date.current.next_month.to_s },
        as: :json
    end
    assert_response :created
    first_policy = response.parsed_body["policy_number"]
    assert_equal 1, Payment.where(quote_id: quote["id"], idempotency_key: "bind-once:payment").count

    post "/api/quotes/#{quote['id']}/request_bind",
      headers: auth(token).merge("Idempotency-Key" => "bind-once"),
      params: { quote_option_id: option["id"], payment_intent_id: payment_intent, effective_date: Date.current.next_month.to_s },
      as: :json
    assert_response :created
    assert_equal first_policy, response.parsed_body["policy_number"]
    assert_equal 1, Payment.where(quote_id: quote["id"], idempotency_key: "bind-once:payment").count
  end

  test "agent cannot approve own referral and underwriter can" do
    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    agent_token = response.parsed_body["token"]

    post "/api/submissions", headers: auth(agent_token), params: submission_payload(prior_claims_count: 2), as: :json
    submission_id = response.parsed_body["id"]
    post "/api/submissions/#{submission_id}/quote", headers: auth(agent_token), as: :json
    referral = UnderwritingReferral.last

    post "/api/underwriting/referrals/#{referral.id}/approve", headers: auth(agent_token), params: { notes: "try" }, as: :json
    assert_response :forbidden

    post "/api/session", params: { role: "underwriter", email: @underwriter.email }, as: :json
    underwriter_token = response.parsed_body["token"]
    post "/api/underwriting/referrals/#{referral.id}/approve", headers: auth(underwriter_token), params: { notes: "ok" }, as: :json
    assert_response :success
    assert_equal "approved", referral.reload.status
    assert_equal "approved", referral.underwriting_decisions.last.outcome
  end

  test "state appetite refers wyoming and north dakota and only declines south dakota" do
    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    token = response.parsed_body["token"]

    post "/api/submissions", headers: auth(token), params: submission_payload(prior_claims_count: 0, state: "WY"), as: :json
    wyoming_id = response.parsed_body["id"]
    post "/api/submissions/#{wyoming_id}/quote", headers: auth(token), as: :json
    assert_response :success
    assert_equal "referred", response.parsed_body["status"]
    assert_equal ["STATE_REFERRAL"], UnderwritingReferral.last.triggered_rules.map { |rule| rule["code"] }

    post "/api/submissions", headers: auth(token), params: submission_payload(prior_claims_count: 0, state: "ND"), as: :json
    north_dakota_id = response.parsed_body["id"]
    post "/api/submissions/#{north_dakota_id}/quote", headers: auth(token), as: :json
    assert_response :success
    assert_equal "referred", response.parsed_body["status"]
    assert_equal ["STATE_REFERRAL"], UnderwritingReferral.last.triggered_rules.map { |rule| rule["code"] }

    post "/api/submissions", headers: auth(token), params: submission_payload(prior_claims_count: 0, state: "SD"), as: :json
    south_dakota_id = response.parsed_body["id"]
    post "/api/submissions/#{south_dakota_id}/quote", headers: auth(token), as: :json
    assert_response :success
    assert_equal "ineligible", response.parsed_body["status"]

    post "/api/submissions", headers: auth(token), params: submission_payload(prior_claims_count: 0, state: "CA"), as: :json
    california_id = response.parsed_body["id"]
    post "/api/submissions/#{california_id}/quote", headers: auth(token), as: :json
    assert_response :success
    assert_equal "quoted", response.parsed_body["status"]
  end

  test "admin rating factor drives subsequent rating" do
    post "/api/session", params: { role: "admin", email: @admin.email }, as: :json
    admin_token = response.parsed_body["token"]
    post "/api/admin/rating-tables",
      headers: auth(admin_token),
      params: { rating_factor: { version: RatingEngine::RATING_VERSION, state: "MA", class_code: "PHOTO_GL", factor_type: "territory", band: "default", factor: 2.0, active: true } },
      as: :json
    assert_response :created

    submission = create_submission(prior_claims_count: 0)
    WorkflowTransition.apply!(submission, to: "submitted", user: @agent)
    quote = RatingEngine.quote!(submission)
    assert_equal 2.0, quote.rating_breakdown["territory_factor"]
  end

  test "admin product parameter drives subsequent rating" do
    post "/api/session", params: { role: "admin", email: @admin.email }, as: :json
    admin_token = response.parsed_body["token"]
    post "/api/admin/rating-tables",
      headers: auth(admin_token),
      params: { product_parameter: { version: RatingEngine::RATING_VERSION, key: "financial.policy_fee", value: 125, active: true } },
      as: :json
    assert_response :created

    submission = create_submission(prior_claims_count: 0)
    WorkflowTransition.apply!(submission, to: "submitted", user: @agent)
    quote = RatingEngine.quote!(submission)
    assert_equal 12_500, quote.quote_options.find_by!(tier: "Standard").policy_fee_cents
  end

  test "document collection omits binary data and document endpoint returns pdf" do
    policy = issued_policy
    DocumentGenerationJob.perform_now(policy.id)
    document = policy.documents.last

    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    token = response.parsed_body["token"]

    get "/api/policies/#{policy.id}/documents", headers: auth(token)
    assert_response :success
    assert_nil response.parsed_body.first["file_data"]

    get "/api/policies/#{policy.id}/documents/#{document.id}", headers: auth(token)
    assert_response :success
    assert_equal "application/pdf", response.media_type
  end

  test "endorsement is quoted, issued, and gets a generated document" do
    policy = issued_policy
    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    token = response.parsed_body["token"]

    post "/api/policies/#{policy.id}/endorsements",
      headers: auth(token),
      params: { change_type: "limit_change", effective_date: Date.current.to_s, change_request: { limit_cents: 2_000_000_00 } },
      as: :json
    assert_response :created
    endorsement_id = response.parsed_body["id"]
    assert_equal "quoted", response.parsed_body["status"]

    assert_enqueued_with(job: EndorsementDocumentJob) do
      post "/api/policies/#{policy.id}/endorsements/#{endorsement_id}/issue", headers: auth(token), as: :json
    end
    assert_response :success
    assert_equal "issued", response.parsed_body["status"]
  end

  test "renewal index exposes expiring policies and renewal quote creation" do
    policy = issued_policy
    post "/api/session", params: { role: "agent", email: @agent.email }, as: :json
    token = response.parsed_body["token"]

    get "/api/renewals", headers: auth(token)
    assert_response :success
    assert_equal policy.policy_number, response.parsed_body["expiring_policies"].first["policy_number"]

    post "/api/policies/#{policy.id}/renewals", headers: auth(token), as: :json
    assert_response :created
    renewal_quote = Quote.find(response.parsed_body["id"])
    assert_equal "renewal", renewal_quote.submission.source

    option = renewal_quote.quote_options.find_by!(tier: "Standard")
    post "/api/payment-intents",
      headers: auth(token).merge("Idempotency-Key" => "renewal-intent"),
      params: { quote_id: renewal_quote.id, quote_option_id: option.id },
      as: :json
    assert_response :created

    assert_enqueued_with(job: DocumentGenerationJob) do
      post "/api/renewals/#{renewal_quote.id}/request_bind",
        headers: auth(token).merge("Idempotency-Key" => "renewal-bind"),
        params: { quote_option_id: option.id, payment_intent_id: response.parsed_body["payment_intent_id"], effective_date: renewal_quote.submission.effective_date.to_s },
        as: :json
    end
    assert_response :created
  end

  private

  def auth(token)
    { "Authorization" => "Bearer #{token}" }
  end

  def create_submission(prior_claims_count:)
    business = Business.create!(legal_name: "Test Photo", contact_name: "Tess", email: "tess@example.test", business_class: "photographer", years_in_business: 3)
    business.locations.create!(line1: "1 Main", city: "Boston", state: "MA", postal_code: "02108")
    submission = Submission.create!(organization: @organization, agency: @agency, created_by: @agent, business:, submission_number: "S-T#{SecureRandom.hex(3)}", effective_date: Date.current.next_month)
    submission.create_risk!(annual_revenue_cents: 400_000_00, payroll_cents: 100_000_00, prior_claims_count:, state: "MA", class_code: "PHOTO_GL")
    submission
  end

  def issued_policy
    submission = create_submission(prior_claims_count: 0)
    WorkflowTransition.apply!(submission, to: "submitted", user: @agent)
    quote = RatingEngine.quote!(submission)
    option = quote.quote_options.find_by!(tier: "Standard")
    submission.update!(status: "issued")
    Policy.create!(
      organization: @organization,
      agency: @agency,
      submission:,
      quote:,
      quote_option: option,
      policy_number: "PBGL-T#{SecureRandom.hex(3)}",
      status: "issued",
      effective_date: Date.current,
      expiration_date: 45.days.from_now.to_date,
      policy_snapshot: BindPolicy.snapshot(submission, quote, option)
    )
  end

  def submission_payload(prior_claims_count:, state: "MA")
    {
      effective_date: Date.current.next_month.to_s,
      business: { legal_name: "Test Photo", contact_name: "Tess", email: "tess@example.test", business_class: "photographer", years_in_business: 3 },
      location: { line1: "1 Main", city: "Boston", state:, postal_code: "02108" },
      risk: { annual_revenue_cents: 400_000_00, payroll_cents: 100_000_00, prior_claims_count:, uses_drones: false, uses_pyrotechnics: false, event_work_percent: 50, class_code: "PHOTO_GL", requested_limit_cents: 1_000_000_00, requested_deductible_cents: 1_000_00 }
    }
  end

  def seed_rules
    UnderwritingRule.create!(version: "v3", code: "UNSUPPORTED_STATE", action: "decline", description: "South Dakota is outside appetite", condition: { field: "state", operator: "==", value: "SD" })
    UnderwritingRule.create!(version: "v3", code: "STATE_REFERRAL", action: "refer", description: "Wyoming and North Dakota require underwriting review", condition: { field: "state", operator: "in", value: %w[WY ND] })
    UnderwritingRule.create!(version: "v3", code: "PRIOR_CLAIMS", action: "refer", description: "Prior claims require review", condition: { field: "prior_claims_count", operator: ">=", value: 2 })
  end

  def seed_product_parameters
    {
      "rating.base_rate" => 500,
      "rating.claims_surcharge_per_claim" => 0.12,
      "rating.event_work_surcharge" => 0.18,
      "financial.policy_fee" => 75,
      "financial.state_tax_bps" => 300,
      "financial.stamping_fee_bps" => 80,
      "option.basic.limit" => 500_000,
      "option.basic.deductible" => 2_500,
      "option.basic.limit_factor" => 0.88,
      "option.basic.deductible_factor" => 0.86,
      "option.standard.limit" => 1_000_000,
      "option.standard.deductible" => 1_000,
      "option.standard.limit_factor" => 1.0,
      "option.standard.deductible_factor" => 1.0,
      "option.premium.limit" => 2_000_000,
      "option.premium.deductible" => 500,
      "option.premium.limit_factor" => 1.28,
      "option.premium.deductible_factor" => 1.08
    }.each do |key, value|
      ProductParameter.create!(version: RatingEngine::RATING_VERSION, key:, value:)
    end
  end

  def seed_factors
    RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "MA", class_code: "PHOTO_GL", factor_type: "territory", band: "default", factor: 1.1)
    RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "MA", class_code: "PHOTO_GL", factor_type: "class", band: "default", factor: 1.25)
    RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "MA", class_code: "PHOTO_GL", factor_type: "revenue", band: "300k_750k", factor: 1.18)
    RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "ALL", class_code: "PHOTO_GL", factor_type: "territory", band: "default", factor: 1.35)
    RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "ALL", class_code: "PHOTO_GL", factor_type: "class", band: "default", factor: 1.25)
    %w[lt_100k 100k_300k 300k_750k 750k_1_5m gte_1_5m].zip([0.82, 1.0, 1.18, 1.4, 1.7]).each do |band, factor|
      RatingFactor.create!(version: RatingEngine::RATING_VERSION, state: "ALL", class_code: "PHOTO_GL", factor_type: "revenue", band:, factor:)
    end
  end
end
