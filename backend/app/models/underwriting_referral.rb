class UnderwritingReferral < ApplicationRecord
  belongs_to :submission
  belongs_to :quote, optional: true
  belongs_to :assigned_to, class_name: "User", optional: true
end
