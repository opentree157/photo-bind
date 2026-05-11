class DocumentGenerationJob < ApplicationJob
  queue_as :default

  def perform(policy_id)
    policy = Policy.find(policy_id)
    document = policy.documents.find_or_create_by!(document_type: "declarations") do |doc|
      doc.status = "generating"
    end
    return if document.status == "generated" && document.file_data.present?

    document.update!(status: "generating")
    pdf = Prawn::Document.new
    pdf.text "PhotoBind General Liability Declarations", size: 18, style: :bold
    pdf.move_down 16
    pdf.text "Policy Number: #{policy.policy_number}"
    pdf.text "Named Insured: #{policy.submission.business.legal_name}"
    pdf.text "Effective: #{policy.effective_date} to #{policy.expiration_date}"
    pdf.text "Coverage Tier: #{policy.quote_option.tier}"
    pdf.text "Limit: $#{policy.quote_option.limit_cents / 100}"
    pdf.text "Total Due: $#{policy.quote_option.total_due_cents / 100}"
    pdf.move_down 16
    pdf.text "Rating version #{policy.quote.rating_version}; underwriting rules #{policy.quote.rules_version}."
    document.update!(status: "generated", file_data: pdf.render)
    policy.update!(status: "issued")
    WorkflowTransition.apply!(policy.submission, to: "issued", metadata: { document_id: document.id }) unless policy.submission.status == "issued"
    AuditLog.record!(subject: document, event_type: "document.generated", message: "Declaration PDF generated", metadata: { policy_number: policy.policy_number })
    WebhookEmitter.emit!("policy.issued", policy)
  end
end
