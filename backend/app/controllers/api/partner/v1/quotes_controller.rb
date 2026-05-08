module Api
  module Partner
    module V1
      class QuotesController < ApplicationController
        def create
          ActiveRecord::Base.transaction do
            organization = current_user.organization
            business = Business.create!(params.require(:business).permit(:legal_name, :contact_name, :email, :phone, :business_class, :years_in_business))
            location = business.locations.create!(params.require(:location).permit(:line1, :city, :state, :postal_code))
            submission = Submission.create!(
              organization:,
              agency: current_user.agency,
              created_by: current_user,
              business:,
              submission_number: "P-#{Time.current.strftime('%y%m')}-#{SecureRandom.hex(3).upcase}",
              source: "partner",
              effective_date: params[:effective_date],
              applicant_answers: params[:applicant_answers] || {}
            )
            submission.create_risk!(params.require(:risk).permit(:annual_revenue_cents, :payroll_cents, :prior_claims_count, :uses_drones, :uses_pyrotechnics, :event_work_percent, :class_code, :requested_limit_cents, :requested_deductible_cents).merge(state: location.state))
            WorkflowTransition.apply!(submission, to: "submitted", user: current_user)
            quote = RatingEngine.quote!(submission)
            render json: quote ? quote.as_json(include: :quote_options) : submission.as_json(include: :underwriting_referrals), status: :created
          end
        end
      end
    end
  end
end
