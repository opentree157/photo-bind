module Api
  class DocumentsController < ApplicationController
    def show
      document = Policy.find(params[:policy_id]).documents.find(params[:document_id])
      return render json: document unless document.file_data.present?

      send_data document.file_data, filename: "declarations-#{document.policy.policy_number}.pdf", type: document.content_type, disposition: "inline"
    end
  end
end
