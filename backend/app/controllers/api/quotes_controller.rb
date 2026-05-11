module Api
  class QuotesController < ApplicationController
    def show
      render json: quote.as_json(include: { quote_options: {}, submission: { include: %i[business risk] } })
    end

    def request_bind
      raise ArgumentError, "Only agents and applicants can request bind" unless %w[agent applicant].include?(current_user.role)

      option = quote.quote_options.find(params.require(:quote_option_id))
      result = BindPolicy.call!(
        quote_option: option,
        user: current_user,
        idempotency_key: request.headers["Idempotency-Key"].presence || params[:idempotency_key].presence || SecureRandom.uuid,
        payment_intent_id: params.require(:payment_intent_id),
        effective_date: Date.parse(params.require(:effective_date))
      )
      render json: result, status: :created
    end

    private

    def quote
      @quote ||= Quote.find(params[:id])
    end
  end
end
