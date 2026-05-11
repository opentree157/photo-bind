class Document < ApplicationRecord
  include AuditableChanges

  belongs_to :policy
end
