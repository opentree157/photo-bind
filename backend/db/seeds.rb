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
  ["UNSUPPORTED_STATE", "decline", "State is outside appetite", { field: "state", operator: "not_in", value: %w[MA CT RI NH] }],
  ["HIGH_REVENUE", "refer", "Annual revenue is over $2M", { field: "annual_revenue_cents", operator: ">", value: 200_000_000 }],
  ["PRIOR_CLAIMS", "refer", "Prior claims require underwriter review", { field: "prior_claims_count", operator: ">=", value: 2 }],
  ["DRONE_WORK", "refer", "Drone operations require review", { field: "uses_drones", operator: "==", value: true }],
  ["PYROTECHNICS", "decline", "Pyrotechnics are outside appetite", { field: "uses_pyrotechnics", operator: "==", value: true }]
].each do |code, action, description, condition|
  UnderwritingRule.find_or_create_by!(version: "v3", code:) do |rule|
    rule.action = action
    rule.description = description
    rule.condition = condition
  end
end

%w[MA CT RI NH].each do |state|
  RatingFactor.find_or_create_by!(version: RatingEngine::RATING_VERSION, state:, class_code: "PHOTO_GL", factor_type: "territory", band: "default") do |factor|
    factor.factor = RatingEngine::TERRITORY.fetch(state)
  end
end
