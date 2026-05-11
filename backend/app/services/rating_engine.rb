class RatingEngine
  RATING_VERSION = "2026.05.01"

  OPTIONS = {
    "Basic" => { limit_cents: 500_000_00, deductible_cents: 2_500_00, limit_factor: 0.88, deductible_factor: 0.86 },
    "Standard" => { limit_cents: 1_000_000_00, deductible_cents: 1_000_00, limit_factor: 1.0, deductible_factor: 1.0 },
    "Premium" => { limit_cents: 2_000_000_00, deductible_cents: 500_00, limit_factor: 1.28, deductible_factor: 1.08 }
  }.freeze

  TERRITORY = { "MA" => 1.1, "CT" => 1.06, "RI" => 1.02, "NH" => 0.96 }.freeze
  CLASS_FACTORS = {
    "PHOTO_GL" => 1.25,
    "PHOTO-PORTRAIT" => 1.0,
    "PHOTO-WEDDING" => 1.18,
    "PHOTO-STUDIO" => 0.94,
    "PHOTO-DRONE" => 1.35
  }.freeze

  def self.quote!(submission)
    OpenTelemetry.tracer_provider.tracer("photobind.rating").in_span("rating.quote") do |span|
      span.set_attribute("submission.id", submission.id)
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
      UnderwritingDecisionRecorder.record_rule_evaluation!(submission:, quote:, evaluation:)

      OPTIONS.each do |tier, option|
        breakdown = calculate(risk, option)
        totals = Financials.quote_totals(dollars_to_cents(breakdown[:annual_premium]))
        quote.quote_options.create!(
          tier:,
          limit_cents: option[:limit_cents],
          deductible_cents: option[:deductible_cents],
          annual_premium_cents: totals[:annual_premium_cents],
          premium_subtotal_cents: totals[:premium_subtotal_cents],
          policy_fee_cents: totals[:policy_fee_cents],
          state_tax_cents: totals[:state_tax_cents],
          stamping_fee_cents: totals[:stamping_fee_cents],
          total_due_cents: totals[:total_due_cents],
          tax_rate_bps: totals[:tax_rate_bps],
          stamping_fee_rate_bps: totals[:stamping_fee_rate_bps],
          financial_version: totals[:financial_version],
          breakdown: breakdown.merge(totals).transform_values { |value| value.is_a?(BigDecimal) ? value.to_f : value }
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
  end

  def self.calculate(risk, option)
    base = base_breakdown(risk).merge(option.slice(:limit_factor, :deductible_factor))
    annual = base.values_at(:base_rate, :class_factor, :territory_factor, :revenue_factor, :claims_factor, :event_factor, :limit_factor, :deductible_factor)
      .map { |value| BigDecimal(value.to_s) }
      .reduce(:*)
    totals = Financials.quote_totals(dollars_to_cents(annual))
    base.merge(
      annual_premium: cents_to_dollars(totals[:annual_premium_cents]),
      policy_fee: cents_to_dollars(totals[:policy_fee_cents]),
      state_tax: cents_to_dollars(totals[:state_tax_cents]),
      stamping_fee: cents_to_dollars(totals[:stamping_fee_cents]),
      total_due: cents_to_dollars(totals[:total_due_cents])
    )
  end

  def self.base_breakdown(risk)
    {
      base_rate: 500,
      class_factor: factor_for("class", risk.state, risk.class_code, "default", CLASS_FACTORS.fetch(risk.class_code, 1.25)),
      territory_factor: factor_for("territory", risk.state, risk.class_code, "default", TERRITORY.fetch(risk.state, 1.35)),
      revenue_factor: factor_for("revenue", risk.state, risk.class_code, revenue_band(risk.annual_revenue_cents), revenue_factor(risk.annual_revenue_cents)),
      claims_factor: 1 + ([risk.prior_claims_count, 5].min * 0.12),
      event_factor: 1 + (risk.event_work_percent / 100.0 * 0.18)
    }
  end

  def self.factor_for(type, state, class_code, band, fallback)
    RatingFactor.find_by(version: RATING_VERSION, state:, class_code:, factor_type: type, band:, active: true)&.factor&.to_f ||
      RatingFactor.find_by(version: RATING_VERSION, state:, class_code: "PHOTO_GL", factor_type: type, band:, active: true)&.factor&.to_f ||
      fallback
  end

  def self.revenue_factor(cents)
    dollars = cents / 100
    return 0.82 if dollars < 100_000
    return 1.0 if dollars < 300_000
    return 1.18 if dollars < 750_000
    return 1.4 if dollars < 1_500_000

    1.7
  end

  def self.revenue_band(cents)
    dollars = cents / 100
    return "lt_100k" if dollars < 100_000
    return "100k_300k" if dollars < 300_000
    return "300k_750k" if dollars < 750_000
    return "750k_1_5m" if dollars < 1_500_000

    "gte_1_5m"
  end

  def self.decline!(submission, evaluation)
    UnderwritingDecisionRecorder.record_rule_evaluation!(submission:, quote: nil, evaluation:)
    WorkflowTransition.apply!(submission, to: "ineligible", metadata: { triggered_rules: evaluation[:triggered_rules] })
    nil
  end

  def self.dollars_to_cents(amount)
    (amount.to_d * 100).round
  end

  def self.cents_to_dollars(cents)
    (BigDecimal(cents.to_s) / 100).round(2).to_f
  end
end
