class EndorsementPricer
  def self.price(policy, change_request, effective_date)
    annual_delta = annual_delta_cents(policy, change_request)
    factor = Financials.proration_factor(policy.effective_date, effective_date, policy.expiration_date)
    {
      annual_delta_cents: annual_delta,
      proration_factor: factor,
      premium_delta_cents: Financials.prorate_cents(annual_delta, factor)
    }
  end

  def self.delta_cents(policy, change_request)
    price(policy, change_request, Date.current)[:premium_delta_cents]
  end

  def self.annual_delta_cents(policy, change_request)
    return limit_delta(policy, change_request) if change_request["limit_cents"].present?
    return address_delta(policy, change_request) if change_request["state"].present?

    new_revenue = change_request["annual_revenue_cents"].presence&.to_i
    return 0 unless new_revenue

    current = policy.policy_snapshot.dig("submission", "risk", "annual_revenue_cents").to_i
    ((new_revenue - current) * 0.004).round
  end

  def self.limit_delta(policy, change_request)
    current = policy.quote_option.limit_cents
    requested = change_request["limit_cents"].to_i
    return 0 if requested == current

    ((requested - current) * 0.0012).round
  end

  def self.address_delta(policy, change_request)
    current_state = policy.submission.risk.state
    new_state = change_request["state"]
    return 0 if new_state == current_state

    current_factor = territory_factor(current_state)
    new_factor = territory_factor(new_state)
    ((policy.quote_option.annual_premium_cents * (new_factor - current_factor)) / current_factor).round
  end

  def self.territory_factor(state)
    RatingFactor.find_by(version: RatingEngine::RATING_VERSION, state:, class_code: "PHOTO_GL", factor_type: "territory", band: "default", active: true)&.factor&.to_f ||
      RatingFactor.find_by!(version: RatingEngine::RATING_VERSION, state: "ALL", class_code: "PHOTO_GL", factor_type: "territory", band: "default", active: true).factor.to_f
  end
end
