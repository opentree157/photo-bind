class Payment < ApplicationRecord
  include AuditableChanges

  belongs_to :policy, optional: true
  belongs_to :quote, optional: true
end
