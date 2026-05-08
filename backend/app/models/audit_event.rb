class AuditEvent < ApplicationRecord
  belongs_to :organization
  belongs_to :user, optional: true
  belongs_to :subject, polymorphic: true
end
