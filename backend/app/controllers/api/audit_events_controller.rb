module Api
  class AuditEventsController < ApplicationController
    before_action :require_not_applicant!

    def index
      render json: AuditEvent.order(created_at: :desc).limit(100)
    end
  end
end
