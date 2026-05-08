class EndorsementPricer
  def self.delta_cents(policy, change_request)
    new_revenue = change_request["annual_revenue_cents"].presence&.to_i
    return 0 unless new_revenue

    current = policy.policy_snapshot.dig("submission", "risk", "annual_revenue_cents").to_i
    ((new_revenue - current) * 0.004).round
  end
end
