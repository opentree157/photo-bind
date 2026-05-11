module Api
  class DocumentsController < ApplicationController
    def index
      policy = Policy.find(params[:policy_id])
      render json: policy.documents.order(created_at: :desc).map { |document| document.as_json(except: :file_data) }
    end

    def show
      document = Policy.find(params[:policy_id]).documents.find(params[:document_id])
      return render json: document unless document.file_data.present?

      send_data document.file_data, filename: "declarations-#{document.policy.policy_number}.pdf", type: document.content_type, disposition: "inline"
    end
  end
end
