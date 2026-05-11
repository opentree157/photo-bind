class PaymentIntentCreator
  CURRENCY = "usd"

  def self.call!(quote_option:, user:, idempotency_key:)
    quote = quote_option.quote
    amount_cents = quote_option.total_due_cents
    request_hash = Digest::SHA256.hexdigest({ quote_option_id: quote_option.id, amount_cents:, user_id: user.id }.to_json)
    existing = IdempotencyKey.find_by(key: idempotency_key, scope: scope(quote_option))
    return existing.response_body if existing&.request_hash == request_hash
    raise ArgumentError, "Payment intent idempotency key reused with different request" if existing

    response = if stripe_enabled?
      create_stripe_intent!(quote_option:, user:, idempotency_key:)
    else
      simulated_intent(quote_option:, user:, idempotency_key:)
    end

    IdempotencyKey.create!(key: idempotency_key, scope: scope(quote_option), request_hash:, status_code: 201, response_body: response)
    AuditLog.record!(
      subject: quote,
      user:,
      event_type: "payment_intent.created",
      message: "Payment intent created for quote option #{quote_option.id}",
      metadata: response.except(:client_secret)
    )
    response
  end

  def self.stripe_enabled?
    ENV["STRIPE_SECRET_KEY"].present?
  end

  def self.create_stripe_intent!(quote_option:, user:, idempotency_key:)
    intent = Stripe::PaymentIntent.create(
      {
        amount: quote_option.total_due_cents,
        currency: CURRENCY,
        automatic_payment_methods: { enabled: true },
        receipt_email: user.email,
        metadata: {
          photobind_quote_id: quote_option.quote_id,
          photobind_quote_option_id: quote_option.id,
          photobind_tier: quote_option.tier
        }
      },
      { idempotency_key: }
    )
    serialize_intent(intent, provider: "stripe")
  end

  def self.simulated_intent(quote_option:, user:, idempotency_key:)
    {
      provider: "stripe_test_mode",
      payment_intent_id: "pi_sim_#{SecureRandom.hex(12)}",
      client_secret: "pi_sim_secret_#{SecureRandom.hex(18)}",
      status: "requires_confirmation",
      amount_cents: quote_option.total_due_cents,
      currency: CURRENCY,
      publishable_key: ENV.fetch("STRIPE_PUBLISHABLE_KEY", "pk_test_photobind_demo"),
      customer_email: user.email,
      idempotency_key:
    }
  end

  def self.serialize_intent(intent, provider:)
    {
      provider:,
      payment_intent_id: intent.id,
      client_secret: intent.client_secret,
      status: intent.status,
      amount_cents: intent.amount,
      currency: intent.currency,
      publishable_key: ENV["STRIPE_PUBLISHABLE_KEY"]
    }
  end

  def self.scope(quote_option)
    "quote_option:#{quote_option.id}:payment_intent"
  end
end
