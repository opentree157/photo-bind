module Api
  class PaymentIntentsController < ApplicationController
    def create
      raise ArgumentError, "Only agents and applicants can create payment intents" unless %w[agent applicant].include?(current_user.role)

      quote = Quote.find(params.require(:quote_id))
      option = quote.quote_options.find(params.require(:quote_option_id))
      intent = PaymentIntentCreator.call!(
        quote_option: option,
        user: current_user,
        idempotency_key: request.headers["Idempotency-Key"].presence || params[:idempotency_key].presence || SecureRandom.uuid
      )
      render json: intent, status: :created
    end
  end
end
