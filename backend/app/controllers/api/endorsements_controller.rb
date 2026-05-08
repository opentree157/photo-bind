module Api
  class EndorsementsController < ApplicationController
    def create
      policy = Policy.find(params[:policy_id])
      delta = EndorsementPricer.delta_cents(policy, params.require(:change_request).permit!.to_h)
      endorsement = policy.endorsements.create!(
        change_type: params.require(:change_type),
        effective_date: Date.parse(params.require(:effective_date)),
        change_request: params.require(:change_request).permit!.to_h,
        premium_delta_cents: delta
      )
      policy.submission.update!(status: "endorsement_pending")
      AuditLog.record!(subject: endorsement, user: current_user, event_type: "endorsement.created", message: "Endorsement created", metadata: { premium_delta_cents: delta })
      WebhookEmitter.emit!("endorsement.created", endorsement)
      render json: endorsement, status: :created
    end
  end
end
