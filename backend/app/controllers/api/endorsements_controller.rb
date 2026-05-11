module Api
  class EndorsementsController < ApplicationController
    before_action -> { require_role!("agent", "underwriter", "admin") }

    def create
      policy = Policy.find(params[:policy_id])
      effective_date = Date.parse(params.require(:effective_date))
      price = EndorsementPricer.price(policy, params.require(:change_request).permit!.to_h, effective_date)
      endorsement = policy.endorsements.create!(
        status: "quoted",
        change_type: params.require(:change_type),
        effective_date:,
        change_request: params.require(:change_request).permit!.to_h,
        annual_delta_cents: price[:annual_delta_cents],
        proration_factor: price[:proration_factor],
        premium_delta_cents: price[:premium_delta_cents]
      )
      WorkflowTransition.apply!(policy.submission, to: "endorsement_pending", user: current_user)
      AuditLog.record!(subject: endorsement, user: current_user, event_type: "endorsement.quoted", message: "Endorsement quoted", metadata: price)
      WebhookEmitter.emit!("endorsement.created", endorsement)
      render json: endorsement, status: :created
    end

    def issue
      endorsement = Endorsement.find(params[:id])
      policy = endorsement.policy
      raise ArgumentError, "Endorsement is not quoteable" unless endorsement.status == "quoted"

      endorsement.update!(status: "issued")
      WorkflowTransition.apply!(policy.submission, to: "issued", user: current_user, metadata: { endorsement_id: endorsement.id })
      EndorsementDocumentJob.perform_later(endorsement.id)
      AuditLog.record!(subject: endorsement, user: current_user, event_type: "endorsement.issued", message: "Endorsement issued", metadata: { premium_delta_cents: endorsement.premium_delta_cents })
      render json: endorsement
    end
  end
end
