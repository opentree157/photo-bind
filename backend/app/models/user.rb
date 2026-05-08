class User < ApplicationRecord
  ROLES = %w[agent underwriter admin applicant].freeze

  belongs_to :organization
  belongs_to :agency, optional: true

  validates :role, inclusion: { in: ROLES }

  def agent? = role == "agent"
  def underwriter? = role == "underwriter"
  def admin? = role == "admin"
end
