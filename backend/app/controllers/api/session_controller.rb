module Api
  class SessionController < ApplicationController
    skip_before_action :set_current_user, only: :create

    def create
      role = params[:role].presence || "agent"
      raise ArgumentError, "Unsupported role" unless User::ROLES.include?(role)

      organization = Organization.first_or_create!(name: "PhotoBind Demo Carrier")
      agency = Agency.first_or_create!(organization:, name: "Northlight Agency", producer_code: "NLA-001")
      user = User.find_or_create_by!(email: params[:email].presence || "#{role}@photobind.test") do |record|
        record.organization = organization
        record.agency = role == "agent" ? agency : nil
        record.name = params[:name].presence || role.titleize
        record.role = role
      end
      user.update!(role:, agency: role == "agent" ? agency : nil)
      render json: { token: encode_token(user), user: user.as_json(only: %i[id name email role]) }
    end

    def show
      render json: { user: current_user.as_json(only: %i[id name email role]) }
    end
  end
end
