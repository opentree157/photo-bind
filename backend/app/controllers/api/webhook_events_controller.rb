module Api
  class WebhookEventsController < ApplicationController
    before_action :require_not_applicant!

    def index
      render json: WebhookEvent.order(created_at: :desc).limit(100)
    end
  end
end
