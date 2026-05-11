class UnderwritingDecision < ApplicationRecord
  belongs_to :submission
  belongs_to :quote, optional: true
  belongs_to :underwriting_referral, optional: true
  belongs_to :decided_by, class_name: "User", optional: true

  validates :decision_type, :action, :outcome, :reason, :decided_at, presence: true
end
