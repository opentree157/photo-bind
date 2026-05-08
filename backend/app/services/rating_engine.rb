class RatingEngine
  RATING_VERSION = "2026.05.01"

  OPTIONS = {
    "Basic" => { limit_cents: 500_000_00, deductible_cents: 2_500_00, limit_factor: 0.88, deductible_factor: 0.86 },
    "Standard" => { limit_cents: 1_000_000_00, deductible_cents: 1_000_00, limit_factor: 1.0, deductible_factor: 1.0 },
    "Premium" => { limit_cents: 2_000_000_00, deductible_cents: 500_00, limit_factor: 1.28, deductible_factor: 1.08 }
  }.freeze

  TERRITORY = { "MA" => 1.1, "CT" => 1.06, "RI" => 1.02, "NH" => 0.96 }.freeze

  def self.quote!(submission)
    risk = submission.risk
    evaluation = UnderwritingEngine.evaluate(submission)

    return decline!(submission, evaluation) if evaluation[:action] == "decline"

    quote = submission.quotes.create!(
      quote_number: "Q-#{Time.current.strftime('%y%m')}-#{SecureRandom.hex(3).upcase}",
      status: evaluation[:action] == "refer" ? "referred" : "quoted",
      rating_version: RATING_VERSION,
      rules_version: evaluation[:rules_version],
      rating_input_snapshot: risk.attributes.except("id", "created_at", "updated_at"),
      rating_breakdown: base_breakdown(risk)
    )

    OPTIONS.each do |tier, option|
      breakdown = calculate(risk, option)
      quote.quote_options.create!(
        tier:,
        limit_cents: option[:limit_cents],
        deductible_cents: option[:deductible_cents],
        annual_premium_cents: dollars_to_cents(breakdown[:annual_premium]),
        policy_fee_cents: 75_00,
        state_tax_cents: dollars_to_cents(breakdown[:state_tax]),
        stamping_fee_cents: dollars_to_cents(breakdown[:stamping_fee]),
        total_due_cents: dollars_to_cents(breakdown[:total_due]),
        breakdown:
      )
    end

    if evaluation[:action] == "refer"
      WorkflowTransition.apply!(submission, to: "referred", metadata: { triggered_rules: evaluation[:triggered_rules] })
      submission.underwriting_referrals.create!(quote:, triggered_rules: evaluation[:triggered_rules])
      WebhookEmitter.emit!("quote.referred", quote)
    else
      WorkflowTransition.apply!(submission, to: "quoted")
      WebhookEmitter.emit!("quote.created", quote)
    end

    quote
  end

  def self.calculate(risk, option)
    base = base_breakdown(risk).merge(option.slice(:limit_factor, :deductible_factor))
    annual = base.values_at(:base_rate, :class_factor, :territory_factor, :revenue_factor, :claims_factor, :event_factor, :limit_factor, :deductible_factor).reduce(:*)
    state_tax = annual * 0.03
    stamping_fee = annual * 0.008
    total_due = annual + 75 + state_tax + stamping_fee
    base.merge(annual_premium: annual.round(2), policy_fee: 75, state_tax: state_tax.round(2), stamping_fee: stamping_fee.round(2), total_due: total_due.round(2))
  end

  def self.base_breakdown(risk)
    {
      base_rate: 500,
      class_factor: 1.25,
      territory_factor: TERRITORY.fetch(risk.state, 1.35),
      revenue_factor: revenue_factor(risk.annual_revenue_cents),
      claims_factor: 1 + ([risk.prior_claims_count, 5].min * 0.12),
      event_factor: 1 + (risk.event_work_percent / 100.0 * 0.18)
    }
  end

  def self.revenue_factor(cents)
    dollars = cents / 100
    return 0.82 if dollars < 100_000
    return 1.0 if dollars < 300_000
    return 1.18 if dollars < 750_000
    return 1.4 if dollars < 1_500_000

    1.7
  end

  def self.decline!(submission, evaluation)
    WorkflowTransition.apply!(submission, to: "ineligible", metadata: { triggered_rules: evaluation[:triggered_rules] })
    nil
  end

  def self.dollars_to_cents(amount)
    (amount.to_d * 100).round
  end
end
