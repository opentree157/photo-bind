class ProductParameter < ApplicationRecord
  validates :version, :key, :value, presence: true
  validates :key, uniqueness: { scope: :version }
end
