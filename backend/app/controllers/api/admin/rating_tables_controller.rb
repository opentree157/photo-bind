module Api
  module Admin
    class RatingTablesController < ApplicationController
      before_action -> { require_role!("admin") }

      def index
        render json: {
          rating_version: RatingEngine::RATING_VERSION,
          factors: RatingFactor.order(:state, :class_code, :factor_type, :band),
          product_parameters: ProductParameter.order(:key)
        }
      end

      def create
        if params[:product_parameter].present?
          attrs = params.require(:product_parameter).permit(:version, :key, :value, :active)
          parameter = ProductParameter.find_or_initialize_by(attrs.slice(:version, :key))
          parameter.assign_attributes(attrs)
          parameter.save!
          AuditLog.record!(subject: parameter, user: current_user, organization: current_user.organization, event_type: "product_parameter.updated", message: "Product parameter #{parameter.key} updated")
          render json: parameter, status: :created
        else
          attrs = params.require(:rating_factor).permit(:version, :state, :class_code, :factor_type, :band, :factor, :active)
          factor = RatingFactor.find_or_initialize_by(attrs.slice(:version, :state, :class_code, :factor_type, :band))
          factor.assign_attributes(attrs)
          factor.save!
          AuditLog.record!(subject: factor, user: current_user, organization: current_user.organization, event_type: "rating_factor.updated", message: "Rating factor #{factor.factor_type}/#{factor.band} updated")
          render json: factor, status: :created
        end
      end
    end
  end
end
