module Api
  class PoliciesController < ApplicationController
    def index
      render json: Policy.order(created_at: :desc).map { |policy| serialize_policy(policy) }
    end

    def show
      render json: serialize_policy(policy).merge(
        endorsements: policy.endorsements,
        policy_terms: policy.policy_terms
      )
    end

    private

    def policy
      @policy ||= Policy.find(params[:id])
    end

    def serialize_policy(policy)
      policy.as_json(except: :policy_snapshot).merge(
        policy_snapshot: policy.policy_snapshot,
        submission: policy.submission.as_json(include: { business: { include: :locations }, risk: {} }),
        quote_option: policy.quote_option,
        documents: policy.documents.map { |document| document.as_json(except: :file_data) }
      )
    end
  end
end
