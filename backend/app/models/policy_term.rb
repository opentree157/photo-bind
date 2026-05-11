class PolicyTerm < ApplicationRecord
  include AuditableChanges

  belongs_to :policy
end
