class ApplicationController < ActionController::API
  before_action :set_current_user

  attr_reader :current_user

  rescue_from ArgumentError, with: :bad_request
  rescue_from ActiveRecord::RecordNotFound, with: :not_found

  private

  def set_current_user
    role = request.headers["X-PhotoBind-Role"].presence || "agent"
    organization = Organization.first_or_create!(name: "PhotoBind Demo Carrier")
    agency = Agency.first_or_create!(organization:, name: "Northlight Agency", producer_code: "NLA-001")
    @current_user = User.find_or_create_by!(email: "#{role}@photobind.test") do |user|
      user.organization = organization
      user.agency = role == "agent" ? agency : nil
      user.name = role.titleize
      user.role = role
    end
  end

  def require_role!(*roles)
    return if roles.include?(current_user.role)

    render json: { error: "forbidden", required_roles: roles }, status: :forbidden
  end

  def bad_request(error)
    render json: { error: error.message }, status: :bad_request
  end

  def not_found
    render json: { error: "not_found" }, status: :not_found
  end
end
