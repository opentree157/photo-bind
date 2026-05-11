class Endorsement < ApplicationRecord
  include AuditableChanges

  belongs_to :policy
end
