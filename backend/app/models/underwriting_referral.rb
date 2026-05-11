class UnderwritingReferral < ApplicationRecord
  include AuditableChanges

  belongs_to :submission
  belongs_to :quote, optional: true
  belongs_to :assigned_to, class_name: "User", optional: true
  has_many :underwriting_decisions, dependent: :nullify
end
