class RenewalQuote
  def self.create_from_policy!(policy, user:)
    submission = nil
    ActiveRecord::Base.transaction do
      source = policy.submission
      business = Business.create!(
        legal_name: source.business.legal_name,
        contact_name: source.business.contact_name,
        email: source.business.email,
        phone: source.business.phone,
        business_class: source.business.business_class,
        years_in_business: source.business.years_in_business + 1
      )
      source.business.locations.each do |location|
        business.locations.create!(location.attributes.slice("line1", "city", "state", "postal_code", "primary"))
      end
      submission = Submission.create!(
        organization: policy.organization,
        agency: policy.agency,
        created_by: user,
        business:,
        submission_number: "R-#{Time.current.strftime('%y%m')}-#{SecureRandom.hex(3).upcase}",
        status: "draft",
        source: "renewal",
        effective_date: policy.expiration_date,
        applicant_answers: { renewal_of: policy.policy_number }
      )
      risk = source.risk
      submission.create_risk!(risk.attributes.except("id", "submission_id", "created_at", "updated_at"))
      WorkflowTransition.apply!(submission, to: "submitted", user:, metadata: { renewal_of: policy.policy_number })
    end
    RatingEngine.quote!(submission)
  end
end
