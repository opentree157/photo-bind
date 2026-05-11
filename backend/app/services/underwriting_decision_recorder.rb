class UnderwritingDecisionRecorder
  def self.record_rule_evaluation!(submission:, quote:, evaluation:)
    triggered = evaluation.fetch(:triggered_rules)
    if triggered.empty?
      create!(
        submission:,
        quote:,
        decision_type: "system_evaluation",
        action: "quote",
        outcome: "accepted",
        reason: "No underwriting rules triggered",
        metadata: { rules_version: evaluation[:rules_version] }
      )
      return
    end

    triggered.each do |rule|
      create!(
        submission:,
        quote:,
        decision_type: "rule_trigger",
        rule_code: rule[:code] || rule["code"],
        action: rule[:action] || rule["action"],
        outcome: evaluation[:action],
        reason: rule[:description] || rule["description"],
        metadata: { rules_version: evaluation[:rules_version], rule: }
      )
    end
  end

  def self.record_referral_decision!(referral:, user:, outcome:, reason:)
    create!(
      submission: referral.submission,
      quote: referral.quote,
      underwriting_referral: referral,
      decided_by: user,
      decision_type: "underwriter_decision",
      action: outcome,
      outcome:,
      reason: reason.presence || "Underwriter #{outcome}",
      metadata: { referral_status: referral.status }
    )
  end

  def self.create!(attributes)
    decision = UnderwritingDecision.create!(attributes.merge(decided_at: Time.current))
    AuditLog.record!(
      subject: decision,
      user: decision.decided_by,
      organization: decision.submission.organization,
      event_type: "underwriting_decision.#{decision.outcome}",
      message: decision.reason,
      metadata: decision.metadata.merge(rule_code: decision.rule_code, action: decision.action)
    )
    decision
  end
end
