class Business < ApplicationRecord
  has_many :locations, dependent: :destroy
  has_many :submissions, dependent: :destroy
end
