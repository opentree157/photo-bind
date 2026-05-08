class Organization < ApplicationRecord
  has_many :agencies, dependent: :destroy
  has_many :users, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :policies, dependent: :destroy
end
