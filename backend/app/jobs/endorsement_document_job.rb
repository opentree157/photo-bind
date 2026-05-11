class EndorsementDocumentJob < ApplicationJob
  queue_as :default

  def perform(endorsement_id)
    endorsement = Endorsement.find(endorsement_id)
    policy = endorsement.policy
    document = policy.documents.create!(document_type: "endorsement_#{endorsement.change_type}", status: "generating")
    pdf = Prawn::Document.new
    pdf.text "PhotoBind Policy Endorsement", size: 18, style: :bold
    pdf.move_down 16
    pdf.text "Policy Number: #{policy.policy_number}"
    pdf.text "Named Insured: #{policy.submission.business.legal_name}"
    pdf.text "Endorsement Type: #{endorsement.change_type.humanize}"
    pdf.text "Effective Date: #{endorsement.effective_date}"
    pdf.text "Premium Delta: $#{endorsement.premium_delta_cents / 100}"
    pdf.move_down 12
    pdf.text "Change Request"
    endorsement.change_request.each { |key, value| pdf.text "#{key.humanize}: #{value}" }
    document.update!(status: "generated", file_data: pdf.render)
    AuditLog.record!(subject: document, event_type: "document.generated", message: "Endorsement PDF generated", metadata: { endorsement_id: endorsement.id })
  end
end
