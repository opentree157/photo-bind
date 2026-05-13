class Financials
  VERSION = ProductConfig::VERSION

  def self.quote_totals(annual_premium_cents, version: VERSION)
    policy_fee_cents = ProductConfig.cents("financial.policy_fee", version:)
    state_tax_bps = ProductConfig.integer("financial.state_tax_bps", version:)
    stamping_fee_bps = ProductConfig.integer("financial.stamping_fee_bps", version:)
    state_tax_cents = bps(annual_premium_cents, state_tax_bps)
    stamping_fee_cents = bps(annual_premium_cents, stamping_fee_bps)
    premium_subtotal_cents = annual_premium_cents + policy_fee_cents
    total_due_cents = premium_subtotal_cents + state_tax_cents + stamping_fee_cents

    {
      annual_premium_cents:,
      premium_subtotal_cents:,
      policy_fee_cents:,
      state_tax_cents:,
      stamping_fee_cents:,
      total_due_cents:,
      tax_rate_bps: state_tax_bps,
      stamping_fee_rate_bps: stamping_fee_bps,
      financial_version: version
    }
  end

  def self.proration_factor(term_effective_date, endorsement_effective_date, expiration_date)
    total_days = [(expiration_date - term_effective_date).to_i, 1].max
    effective_date = [endorsement_effective_date, term_effective_date].max
    remaining_days = [(expiration_date - effective_date).to_i, 0].max
    (BigDecimal(remaining_days.to_s) / BigDecimal(total_days.to_s)).round(6)
  end

  def self.prorate_cents(annual_delta_cents, factor)
    (BigDecimal(annual_delta_cents.to_s) * BigDecimal(factor.to_s)).round(0).to_i
  end

  def self.bps(cents, basis_points)
    (BigDecimal(cents.to_s) * BigDecimal(basis_points.to_s) / 10_000).round(0).to_i
  end
end
