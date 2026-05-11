class PaymentAuthorization
  def self.call!(quote:, amount_cents:, payment_intent_id:, idempotency_key:)
    request_hash = Digest::SHA256.hexdigest({ quote_id: quote.id, amount_cents:, payment_intent_id: }.to_json)
    existing = Payment.find_by(quote:, idempotency_key:)

    return existing if existing&.request_hash == request_hash
    raise ArgumentError, "Payment idempotency key reused with different request" if existing

    payment = Payment.find_or_initialize_by(payment_intent_id:)
    if payment.persisted? && payment.request_hash.present? && payment.request_hash != request_hash
      raise ArgumentError, "Payment intent reused with different request"
    end

    payment.assign_attributes(
      quote:,
      amount_cents:,
      provider: provider_for(payment_intent_id),
      status: payment_status(payment_intent_id),
      idempotency_key:,
      request_hash:,
      authorized_at: Time.current,
      metadata: payment_metadata(payment_intent_id)
    )
    payment.save!
    AuditLog.record!(subject: payment, event_type: "payment.authorized", message: "Payment authorized idempotently", metadata: { amount_cents:, payment_intent_id: })
    payment
  end

  def self.provider_for(payment_intent_id)
    return "stripe" if ENV["STRIPE_SECRET_KEY"].present? && payment_intent_id.start_with?("pi_")
    return "stripe_test_mode" if payment_intent_id.start_with?("pi_sim_")

    "demo"
  end

  def self.payment_status(payment_intent_id)
    return "authorized" unless ENV["STRIPE_SECRET_KEY"].present? && payment_intent_id.start_with?("pi_")

    intent = Stripe::PaymentIntent.retrieve(payment_intent_id)
    unless %w[requires_capture processing succeeded requires_confirmation].include?(intent.status)
      raise ArgumentError, "Stripe payment intent is not in an authorizable state"
    end

    intent.status == "succeeded" ? "captured" : "authorized"
  end

  def self.payment_metadata(payment_intent_id)
    return { authorized_by: "stripe_test_mode", stripe_lifecycle: "simulated" } unless ENV["STRIPE_SECRET_KEY"].present? && payment_intent_id.start_with?("pi_")

    intent = Stripe::PaymentIntent.retrieve(payment_intent_id)
    {
      authorized_by: "stripe",
      stripe_status: intent.status,
      stripe_amount: intent.amount,
      stripe_currency: intent.currency
    }
  end
end
