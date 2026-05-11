class Quote < ApplicationRecord
  include AuditableChanges

  belongs_to :submission
  has_many :quote_options, dependent: :destroy
  has_one :underwriting_referral, dependent: :nullify
  has_many :underwriting_decisions, dependent: :nullify
end
