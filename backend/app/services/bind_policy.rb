class BindPolicy
  def self.call!(quote_option:, user:, idempotency_key:, payment_intent_id:, effective_date:)
    scope = "quote_option:#{quote_option.id}:bind"
    request_hash = Digest::SHA256.hexdigest({ quote_option_id: quote_option.id, payment_intent_id:, effective_date: }.to_json)
    existing = IdempotencyKey.find_by(key: idempotency_key, scope:)
    return existing.response_body if existing&.request_hash == request_hash
    raise ArgumentError, "Idempotency key reused with different request" if existing

    response = nil
    ActiveRecord::Base.transaction do
      quote = quote_option.quote
      submission = quote.submission
      WorkflowTransition.apply!(submission, to: "bind_requested", user:, metadata: { quote_option_id: quote_option.id })

      payment = Payment.create!(quote:, payment_intent_id:, status: "authorized", amount_cents: quote_option.total_due_cents)
      policy = Policy.create!(
        organization: submission.organization,
        agency: submission.agency,
        submission:,
        quote:,
        quote_option:,
        policy_number: "PBGL-#{Time.current.strftime('%Y')}-#{SecureRandom.hex(3).upcase}",
        status: "bound",
        effective_date:,
        expiration_date: effective_date.next_year,
        policy_snapshot: snapshot(submission, quote, quote_option)
      )
      policy.policy_terms.create!(effective_date:, expiration_date: effective_date.next_year, written_premium_cents: quote_option.annual_premium_cents, snapshot: policy.policy_snapshot)
      payment.update!(policy:)
      WorkflowTransition.apply!(submission, to: "bound", user:, metadata: { policy_number: policy.policy_number })
      WebhookEmitter.emit!("policy.bound", policy)
      DocumentGenerationJob.perform_later(policy.id)
      response = { policy_id: policy.id, policy_number: policy.policy_number, status: policy.status }
      IdempotencyKey.create!(key: idempotency_key, scope:, request_hash:, status_code: 201, response_body: response)
    end
    response
  end

  def self.snapshot(submission, quote, option)
    {
      submission: submission.as_json(include: { business: {}, risk: {} }),
      quote: quote.as_json(include: :quote_options),
      selected_option: option.as_json,
      rating_version: quote.rating_version,
      rules_version: quote.rules_version,
      bound_at: Time.current.iso8601
    }
  end
end
