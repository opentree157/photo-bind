module Api
  class RenewalsController < ApplicationController
    before_action -> { require_role!("agent", "underwriter", "admin") }

    def index
      expiring = Policy.where(expiration_date: Date.current..90.days.from_now.to_date).order(:expiration_date)
      renewal_submissions = Submission.where(source: "renewal").order(created_at: :desc)
      render json: {
        expiring_policies: expiring.map { |policy| serialize_expiring(policy) },
        renewal_submissions: renewal_submissions.map { |submission| serialize_renewal_submission(submission) }
      }
    end

    def create
      policy = Policy.find(params[:policy_id])
      renewal = RenewalQuote.create_from_policy!(policy, user: current_user)
      render json: renewal.as_json(include: :quote_options), status: :created
    end

    def bind
      quote = Quote.find(params[:id])
      raise ArgumentError, "Quote is not a renewal quote" unless quote.submission.source == "renewal"

      option = quote.quote_options.find(params.require(:quote_option_id))
      result = BindPolicy.call!(
        quote_option: option,
        user: current_user,
        idempotency_key: request.headers["Idempotency-Key"].presence || params[:idempotency_key].presence || SecureRandom.uuid,
        payment_intent_id: params.require(:payment_intent_id),
        effective_date: Date.parse(params.require(:effective_date))
      )
      AuditLog.record!(subject: quote.submission, user: current_user, event_type: "renewal.bound", message: "Renewal quote bound", metadata: result)
      render json: result, status: :created
    end

    private

    def serialize_expiring(policy)
      policy.as_json(include: { submission: { include: :business }, quote_option: {} }).merge(
        days_to_expiration: (policy.expiration_date - Date.current).to_i,
        renewal_status: renewal_status_for(policy)
      )
    end

    def serialize_renewal_submission(submission)
      submission.as_json(include: { business: {}, risk: {}, quotes: { include: :quote_options }, policy: {} }).merge(
        renewal_of: submission.applicant_answers["renewal_of"],
        stage: submission.policy.present? ? "issued" : submission.quotes.any? ? "quoted" : submission.status,
        narrative: renewal_narrative(submission)
      )
    end

    def renewal_status_for(policy)
      renewal = Submission.where(source: "renewal").where("applicant_answers ->> 'renewal_of' = ?", policy.policy_number).order(created_at: :desc).first
      return "not_started" unless renewal
      return "issued" if renewal.policy.present?
      return "quoted" if renewal.quotes.any?

      renewal.status
    end

    def renewal_narrative(submission)
      source_policy = submission.applicant_answers["renewal_of"]
      return "Renewal #{submission.submission_number} issued from #{source_policy}." if submission.policy.present?
      return "Renewal quote ready for review and bind from #{source_policy}." if submission.quotes.any?

      "Renewal intake opened from #{source_policy}."
    end
  end
end
