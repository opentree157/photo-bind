class QuoteOption < ApplicationRecord
  include AuditableChanges

  belongs_to :quote
end
