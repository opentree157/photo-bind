class Agency < ApplicationRecord
  belongs_to :organization
  has_many :users, dependent: :nullify
  has_many :submissions, dependent: :nullify
end
