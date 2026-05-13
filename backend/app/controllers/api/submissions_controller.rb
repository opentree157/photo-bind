module Api
  class SubmissionsController < ApplicationController
    before_action :authorize_backoffice!, only: %i[index show]

    def index
      render json: Submission.order(created_at: :desc)
        .includes(:business, :risk, quotes: :quote_options)
        .as_json(include: { business: {}, risk: {}, quotes: { include: :quote_options } })
    end

    def show
      render json: submission.as_json(include: { business: { include: :locations }, risk: {}, quotes: { include: :quote_options }, underwriting_referrals: {}, underwriting_decisions: {}, policy: { include: %i[documents endorsements] } })
    end

    def create
      raise ArgumentError, "Underwriter cannot create submissions" if current_user.underwriter?

      ActiveRecord::Base.transaction do
        organization = current_user.organization
        business = Business.create!(business_params)
        business.locations.create!(location_params)
        sub = Submission.create!(
          organization:,
          agency: current_user.agency,
          created_by: current_user,
          business:,
          submission_number: "S-#{Time.current.strftime('%y%m')}-#{SecureRandom.hex(3).upcase}",
          source: params[:source].presence || "agent",
          effective_date: params[:effective_date],
          applicant_answers: params[:applicant_answers] || {}
        )
        sub.create_risk!(risk_params.merge(state: location_params[:state]))
        AuditLog.record!(subject: sub, user: current_user, event_type: "submission.created", message: "Submission created")
        render json: sub.as_json(include: %i[business risk]), status: :created
      end
    end

    def submit
      raise ArgumentError, "Only agents and admins can submit backoffice submissions" unless %w[agent admin].include?(current_user.role)

      WorkflowTransition.apply!(submission, to: "submitted", user: current_user)
      render json: submission
    end

    def quote
      raise ArgumentError, "Only agents and admins can request quotes" unless %w[agent admin applicant].include?(current_user.role)

      WorkflowTransition.apply!(submission, to: "submitted", user: current_user) if submission.status == "draft"
      quote = RatingEngine.quote!(submission)
      render json: quote ? quote.as_json(include: :quote_options) : submission.as_json(include: :underwriting_referrals)
    end

    private

    def submission
      @submission ||= Submission.find(params[:id])
    end

    def authorize_backoffice!
      require_not_applicant!
    end

    def business_params
      params.require(:business).permit(:legal_name, :contact_name, :email, :phone, :business_class, :years_in_business)
    end

    def location_params
      params.require(:location).permit(:line1, :city, :state, :postal_code)
    end

    def risk_params
      params.require(:risk).permit(:annual_revenue_cents, :payroll_cents, :prior_claims_count, :uses_drones, :uses_pyrotechnics, :event_work_percent, :class_code, :requested_limit_cents, :requested_deductible_cents)
    end
  end
end
