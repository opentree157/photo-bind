module Api
  class SubmissionsController < ApplicationController
    def index
      render json: Submission.order(created_at: :desc).includes(:business, :risk).as_json(include: %i[business risk])
    end

    def show
      render json: submission.as_json(include: { business: { include: :locations }, risk: {}, quotes: { include: :quote_options }, underwriting_referrals: {}, policy: { include: %i[documents endorsements] } })
    end

    def create
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
      WorkflowTransition.apply!(submission, to: "submitted", user: current_user)
      render json: submission
    end

    def quote
      WorkflowTransition.apply!(submission, to: "submitted", user: current_user) if submission.status == "draft"
      quote = RatingEngine.quote!(submission)
      render json: quote ? quote.as_json(include: :quote_options) : submission.as_json(include: :underwriting_referrals)
    end

    private

    def submission
      @submission ||= Submission.find(params[:id])
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
