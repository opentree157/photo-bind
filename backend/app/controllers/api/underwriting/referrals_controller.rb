module Api
  module Underwriting
    class ReferralsController < ApplicationController
      before_action -> { require_role!("underwriter", "admin") }

      def index
        render json: UnderwritingReferral.order(created_at: :desc).as_json(include: { submission: { include: %i[business risk underwriting_decisions] }, quote: {} })
      end

      def show
        render json: referral.as_json(include: { submission: { include: %i[business risk underwriting_decisions] }, quote: { include: :quote_options }, underwriting_decisions: {} })
      end

      def approve
        raise ArgumentError, "Agent cannot approve their own referral" if referral.submission.created_by_id == current_user.id

        referral.update!(status: "approved", assigned_to: current_user, notes: params[:notes], decided_at: Time.current)
        UnderwritingDecisionRecorder.record_referral_decision!(referral:, user: current_user, outcome: "approved", reason: params[:notes])
        WorkflowTransition.apply!(referral.submission, to: "approved", user: current_user)
        WorkflowTransition.apply!(referral.submission, to: "quoted", user: current_user)
        AuditLog.record!(subject: referral, user: current_user, event_type: "referral.approved", message: "Underwriter approved referral")
        render json: referral
      end

      def decline
        referral.update!(status: "declined", assigned_to: current_user, notes: params[:notes], decided_at: Time.current)
        UnderwritingDecisionRecorder.record_referral_decision!(referral:, user: current_user, outcome: "declined", reason: params[:notes])
        WorkflowTransition.apply!(referral.submission, to: "declined", user: current_user)
        AuditLog.record!(subject: referral, user: current_user, event_type: "referral.declined", message: "Underwriter declined referral")
        render json: referral
      end

      private

      def referral
        @referral ||= UnderwritingReferral.find(params[:id])
      end
    end
  end
end
