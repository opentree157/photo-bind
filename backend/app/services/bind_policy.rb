class BindPolicy
  def self.call!(quote_option:, user:, idempotency_key:, payment_intent_id:, effective_date:)
    OpenTelemetry.tracer_provider.tracer("photobind.bind").in_span("policy.bind") do |span|
      span.set_attribute("quote_option.id", quote_option.id)
      span.set_attribute("payment.provider", payment_intent_id.start_with?("pi_") ? "stripe" : "demo")
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

        payment = PaymentAuthorization.call!(
          quote:,
          amount_cents: quote_option.total_due_cents,
          payment_intent_id:,
          idempotency_key: "#{idempotency_key}:payment"
        )
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
        AuditLog.record!(
          subject: policy,
          user:,
          event_type: "policy.snapshot_created",
          message: "Immutable policy snapshot created at bind",
          metadata: { quote_option_id: quote_option.id, payment_id: payment.id }
        )
        WorkflowTransition.apply!(submission, to: "bound", user:, metadata: { policy_number: policy.policy_number })
        WebhookEmitter.emit!("policy.bound", policy)
        DocumentGenerationJob.perform_later(policy.id)
        response = { policy_id: policy.id, policy_number: policy.policy_number, status: policy.status }
        IdempotencyKey.create!(key: idempotency_key, scope:, request_hash:, status_code: 201, response_body: response)
      end
      response
    end
  end

  def self.snapshot(submission, quote, option)
    {
      submission: submission.as_json(include: { business: {}, risk: {} }),
      quote: quote.as_json(include: :quote_options),
      selected_option: option.as_json,
      financials: {
        annual_premium_cents: option.annual_premium_cents,
        premium_subtotal_cents: option.respond_to?(:premium_subtotal_cents) ? option.premium_subtotal_cents : option.annual_premium_cents + option.policy_fee_cents,
        policy_fee_cents: option.policy_fee_cents,
        state_tax_cents: option.state_tax_cents,
        stamping_fee_cents: option.stamping_fee_cents,
        total_due_cents: option.total_due_cents,
        tax_rate_bps: option.respond_to?(:tax_rate_bps) ? option.tax_rate_bps : Financials::STATE_TAX_BPS,
        stamping_fee_rate_bps: option.respond_to?(:stamping_fee_rate_bps) ? option.stamping_fee_rate_bps : Financials::STAMPING_FEE_BPS,
        financial_version: option.respond_to?(:financial_version) ? option.financial_version : Financials::VERSION
      },
      rating_version: quote.rating_version,
      rules_version: quote.rules_version,
      bound_at: Time.current.iso8601
    }
  end
end
