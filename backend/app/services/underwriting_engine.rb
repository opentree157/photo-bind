require "ostruct"

class UnderwritingEngine
  DEFAULT_RULE_VERSION = "v3"

  def self.evaluate(submission)
    risk = submission.risk
    rules = active_rules
    triggered = rules.select { |rule| matches?(rule.condition, submission, risk) }
    action = triggered.any? { |rule| rule.action == "decline" } ? "decline" : triggered.any? ? "refer" : "quote"
    { action:, rules_version: DEFAULT_RULE_VERSION, triggered_rules: triggered.map { |rule| rule.slice(:code, :action, :description) } }
  end

  def self.active_rules
    rules = UnderwritingRule.where(version: DEFAULT_RULE_VERSION, active: true).to_a
    return rules if rules.any?

    [
      OpenStruct.new(code: "UNSUPPORTED_STATE", action: "decline", description: "State is outside appetite", condition: { "field" => "state", "operator" => "not_in", "value" => %w[MA CT RI NH] }),
      OpenStruct.new(code: "HIGH_REVENUE", action: "refer", description: "Annual revenue is over $2M", condition: { "field" => "annual_revenue_cents", "operator" => ">", "value" => 200_000_000 }),
      OpenStruct.new(code: "PRIOR_CLAIMS", action: "refer", description: "Prior claims require underwriter review", condition: { "field" => "prior_claims_count", "operator" => ">=", "value" => 2 }),
      OpenStruct.new(code: "DRONE_WORK", action: "refer", description: "Drone operations require review", condition: { "field" => "uses_drones", "operator" => "==", "value" => true }),
      OpenStruct.new(code: "PYROTECHNICS", action: "decline", description: "Pyrotechnics are outside appetite", condition: { "field" => "uses_pyrotechnics", "operator" => "==", "value" => true })
    ]
  end

  def self.matches?(condition, submission, risk)
    actual = case condition["field"]
    when "state" then risk.state
    when "business_class" then submission.business.business_class
    else risk.public_send(condition["field"])
    end

    expected = condition["value"]
    case condition["operator"]
    when ">" then actual > expected
    when ">=" then actual >= expected
    when "==" then actual == expected
    when "in" then expected.include?(actual)
    when "not_in" then !expected.include?(actual)
    else false
    end
  end
end
