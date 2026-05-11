class ApplicationController < ActionController::API
  before_action :set_current_user

  attr_reader :current_user

  rescue_from ArgumentError, with: :bad_request
  rescue_from ActiveRecord::RecordNotFound, with: :not_found

  private

  def set_current_user
    token_payload = decode_token
    role = token_payload&.fetch("role", nil).presence || request.headers["X-PhotoBind-Role"].presence || "agent"
    email = token_payload&.fetch("email", nil).presence || "#{role}@photobind.test"
    organization = Organization.first_or_create!(name: "PhotoBind Demo Carrier")
    agency = Agency.first_or_create!(organization:, name: "Northlight Agency", producer_code: "NLA-001")
    @current_user = User.find_or_create_by!(email:) do |user|
      user.organization = organization
      user.agency = role == "agent" ? agency : nil
      user.name = role.titleize
      user.role = role
    end
    @current_user.update!(role:, agency: role == "agent" ? agency : nil) if @current_user.role != role
  end

  def require_role!(*roles)
    return if roles.include?(current_user.role)

    render json: { error: "forbidden", required_roles: roles }, status: :forbidden
  end

  def require_not_applicant!
    return unless current_user.role == "applicant"

    render json: { error: "forbidden", message: "Applicant cannot access backoffice APIs" }, status: :forbidden
  end

  def auth_verifier
    secret = Rails.application.secret_key_base || "photobind-development-secret"
    ActiveSupport::MessageVerifier.new(secret, serializer: JSON, digest: "SHA256")
  end

  def encode_token(user)
    auth_verifier.generate({ "user_id" => user.id, "email" => user.email, "role" => user.role, "iat" => Time.current.to_i }, expires_in: 12.hours)
  end

  def decode_token
    header = request.authorization.to_s
    return nil unless header.start_with?("Bearer ")

    auth_verifier.verified(header.delete_prefix("Bearer "))
  end

  def bad_request(error)
    render json: { error: error.message }, status: :bad_request
  end

  def not_found
    render json: { error: "not_found" }, status: :not_found
  end
end
