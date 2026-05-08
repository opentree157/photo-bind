module Api
  class PoliciesController < ApplicationController
    def index
      render json: Policy.order(created_at: :desc).as_json(include: %i[submission quote_option documents])
    end

    def show
      render json: policy.as_json(include: { submission: { include: %i[business risk] }, quote_option: {}, documents: {}, endorsements: {}, policy_terms: {} })
    end

    private

    def policy
      @policy ||= Policy.find(params[:id])
    end
  end
end
