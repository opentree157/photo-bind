class Quote < ApplicationRecord
  belongs_to :submission
  has_many :quote_options, dependent: :destroy
  has_one :underwriting_referral, dependent: :nullify
end
