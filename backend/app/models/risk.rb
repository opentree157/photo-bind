class Risk < ApplicationRecord
  include AuditableChanges

  belongs_to :submission
end
