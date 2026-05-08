module Api
  module Admin
    class RatingTablesController < ApplicationController
      before_action -> { require_role!("admin") }

      def index
        render json: { rating_version: RatingEngine::RATING_VERSION, factors: RatingFactor.order(:state, :factor_type, :band) }
      end

      def create
        factor = RatingFactor.create!(params.require(:rating_factor).permit(:version, :state, :class_code, :factor_type, :band, :factor, :active))
        AuditLog.record!(subject: factor, user: current_user, organization: current_user.organization, event_type: "rating_factor.created", message: "Rating factor created")
        render json: factor, status: :created
      end
    end
  end
end
