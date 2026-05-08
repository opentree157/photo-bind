class Payment < ApplicationRecord
  belongs_to :policy, optional: true
  belongs_to :quote, optional: true
end
