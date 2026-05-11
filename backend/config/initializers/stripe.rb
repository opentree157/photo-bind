Stripe.api_key = ENV["STRIPE_SECRET_KEY"] if defined?(Stripe) && ENV["STRIPE_SECRET_KEY"].present?
