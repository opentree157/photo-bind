module Api
  module Partner
    module V1
      class PoliciesController < ApplicationController
        def show
          policy = Policy.find_by!(policy_number: params[:policy_number])
          render json: policy.as_json(include: %i[quote_option documents])
        end
      end
    end
  end
end
