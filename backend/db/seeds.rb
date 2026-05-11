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
  [
    ["territory", "PHOTO_GL", "default", RatingEngine::TERRITORY.fetch(state)],
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
    RatingFactor.find_or_create_by!(version: RatingEngine::RATING_VERSION, state:, class_code:, factor_type:, band:) do |factor|
      factor.factor = value
    end
  end
end
