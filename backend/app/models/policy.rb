class Policy < ApplicationRecord
  include AuditableChanges

  belongs_to :organization
  belongs_to :agency, optional: true
  belongs_to :submission
  belongs_to :quote
  belongs_to :quote_option
  has_many :policy_terms, dependent: :destroy
  has_many :endorsements, dependent: :destroy
  has_many :documents, dependent: :destroy
end
