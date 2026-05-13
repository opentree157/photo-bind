class RatingEngine
  RATING_VERSION = ProductConfig::VERSION

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

      ProductConfig.options(version: RATING_VERSION).each do |tier, option|
        breakdown = calculate(risk, option)
        totals = Financials.quote_totals(dollars_to_cents(breakdown[:annual_premium]), version: RATING_VERSION)
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
    totals = Financials.quote_totals(dollars_to_cents(annual), version: RATING_VERSION)
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
      base_rate: ProductConfig.decimal("rating.base_rate", version: RATING_VERSION),
      class_factor: factor_for!("class", risk.state, risk.class_code, "default"),
      territory_factor: factor_for!("territory", risk.state, risk.class_code, "default"),
      revenue_factor: factor_for!("revenue", risk.state, risk.class_code, revenue_band(risk.annual_revenue_cents)),
      claims_factor: 1 + ([risk.prior_claims_count, 5].min * ProductConfig.decimal("rating.claims_surcharge_per_claim", version: RATING_VERSION)),
      event_factor: 1 + (risk.event_work_percent / 100.0 * ProductConfig.decimal("rating.event_work_surcharge", version: RATING_VERSION))
    }
  end

  def self.factor_for!(type, state, class_code, band)
    RatingFactor.find_by(version: RATING_VERSION, state:, class_code:, factor_type: type, band:, active: true)&.factor&.to_f ||
      RatingFactor.find_by(version: RATING_VERSION, state:, class_code: "PHOTO_GL", factor_type: type, band:, active: true)&.factor&.to_f ||
      RatingFactor.find_by!(version: RATING_VERSION, state: "ALL", class_code: "PHOTO_GL", factor_type: type, band:, active: true).factor.to_f
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
