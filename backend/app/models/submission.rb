class Submission < ApplicationRecord
  include AuditableChanges

  STATUSES = %w[draft submitted ineligible quoted referred approved declined bind_requested bound issued cancelled endorsement_pending].freeze

  belongs_to :organization
  belongs_to :agency, optional: true
  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :business
  has_one :risk, dependent: :destroy
  has_many :quotes, dependent: :destroy
  has_many :underwriting_referrals, dependent: :destroy
  has_many :underwriting_decisions, dependent: :destroy
  has_one :policy, dependent: :restrict_with_error

  validates :status, inclusion: { in: STATUSES }
end
