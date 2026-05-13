# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end
organization = Organization.first_or_create!(name: "PhotoBind Demo Carrier")
agency = Agency.first_or_create!(organization:, name: "Northlight Agency", producer_code: "NLA-001")
rating_version = ProductConfig::VERSION

[
  ["agent", "Avery Agent", "agent@photobind.test", agency],
  ["underwriter", "Uma Underwriter", "underwriter@photobind.test", nil],
  ["admin", "Priya Product", "admin@photobind.test", nil]
].each do |role, name, email, user_agency|
  User.find_or_create_by!(email:) do |user|
    user.organization = organization
    user.agency = user_agency
    user.role = role
    user.name = name
  end
end

[
  ["UNSUPPORTED_STATE", "decline", "South Dakota is outside appetite", { field: "state", operator: "==", value: "SD" }],
  ["STATE_REFERRAL", "refer", "Wyoming and North Dakota require underwriting review", { field: "state", operator: "in", value: %w[WY ND] }],
  ["HIGH_REVENUE", "refer", "Annual revenue is over $2M", { field: "annual_revenue_cents", operator: ">", value: 200_000_000 }],
  ["PRIOR_CLAIMS", "refer", "Prior claims require underwriter review", { field: "prior_claims_count", operator: ">=", value: 2 }],
  ["DRONE_WORK", "refer", "Drone operations require review", { field: "uses_drones", operator: "==", value: true }],
  ["PYROTECHNICS", "decline", "Pyrotechnics are outside appetite", { field: "uses_pyrotechnics", operator: "==", value: true }]
].each do |code, action, description, condition|
  rule = UnderwritingRule.find_or_initialize_by(version: "v3", code:)
  rule.update!(action:, description:, condition:, active: true)
end

UnderwritingRule.where(version: "v3", code: "EXPANSION_STATE").update_all(active: false, updated_at: Time.current)

[
  ["rating.base_rate", 500],
  ["rating.claims_surcharge_per_claim", 0.12],
  ["rating.event_work_surcharge", 0.18],
  ["financial.policy_fee", 75],
  ["financial.state_tax_bps", 300],
  ["financial.stamping_fee_bps", 80],
  ["option.basic.limit", 500_000],
  ["option.basic.deductible", 2_500],
  ["option.basic.limit_factor", 0.88],
  ["option.basic.deductible_factor", 0.86],
  ["option.standard.limit", 1_000_000],
  ["option.standard.deductible", 1_000],
  ["option.standard.limit_factor", 1.0],
  ["option.standard.deductible_factor", 1.0],
  ["option.premium.limit", 2_000_000],
  ["option.premium.deductible", 500],
  ["option.premium.limit_factor", 1.28],
  ["option.premium.deductible_factor", 1.08]
].each do |key, value|
  ProductParameter.find_or_create_by!(version: rating_version, key:) do |parameter|
    parameter.value = value
  end
end

territory_factors = { "MA" => 1.1, "CT" => 1.06, "RI" => 1.02, "NH" => 0.96 }

%w[MA CT RI NH].each do |state|
  [
    ["territory", "PHOTO_GL", "default", territory_factors.fetch(state)],
    ["class", "PHOTO_GL", "default", 1.25],
    ["class", "PHOTO-PORTRAIT", "default", 1.0],
    ["class", "PHOTO-WEDDING", "default", 1.18],
    ["class", "PHOTO-STUDIO", "default", 0.94],
    ["class", "PHOTO-DRONE", "default", 1.35],
    ["revenue", "PHOTO_GL", "lt_100k", 0.82],
    ["revenue", "PHOTO_GL", "100k_300k", 1.0],
    ["revenue", "PHOTO_GL", "300k_750k", 1.18],
    ["revenue", "PHOTO_GL", "750k_1_5m", 1.4],
    ["revenue", "PHOTO_GL", "gte_1_5m", 1.7]
  ].each do |factor_type, class_code, band, value|
    RatingFactor.find_or_create_by!(version: rating_version, state:, class_code:, factor_type:, band:) do |factor|
      factor.factor = value
    end
  end
end

[
  ["territory", "default", 1.35],
  ["class", "default", 1.25],
  ["revenue", "lt_100k", 0.82],
  ["revenue", "100k_300k", 1.0],
  ["revenue", "300k_750k", 1.18],
  ["revenue", "750k_1_5m", 1.4],
  ["revenue", "gte_1_5m", 1.7]
].each do |factor_type, band, value|
  RatingFactor.find_or_create_by!(version: rating_version, state: "ALL", class_code: "PHOTO_GL", factor_type:, band:) do |factor|
    factor.factor = value
  end
end
