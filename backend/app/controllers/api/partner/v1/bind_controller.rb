module Api
  module Partner
    module V1
      class BindController < ApplicationController
        def create
          option = QuoteOption.find(params.require(:quote_option_id))
          result = BindPolicy.call!(
            quote_option: option,
            user: current_user,
            idempotency_key: request.headers["Idempotency-Key"].presence || params[:idempotency_key].presence || SecureRandom.uuid,
            payment_intent_id: params.require(:payment_intent_id),
            effective_date: Date.parse(params.require(:effective_date))
          )
          render json: result, status: :created
        end
      end
    end
  end
end
