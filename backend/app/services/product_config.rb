class ProductConfig
  VERSION = "2026.05.01"

  def self.value(key, version: VERSION)
    ProductParameter.find_by!(version:, key:, active: true).value
  end

  def self.cents(key, version: VERSION)
    (value(key, version:) * 100).round.to_i
  end

  def self.integer(key, version: VERSION)
    value(key, version:).round.to_i
  end

  def self.decimal(key, version: VERSION)
    value(key, version:)
  end

  def self.option(tier, version: VERSION)
    normalized = tier.to_s.downcase
    {
      limit_cents: cents("option.#{normalized}.limit", version:),
      deductible_cents: cents("option.#{normalized}.deductible", version:),
      limit_factor: decimal("option.#{normalized}.limit_factor", version:),
      deductible_factor: decimal("option.#{normalized}.deductible_factor", version:)
    }
  end

  def self.options(version: VERSION)
    %w[Basic Standard Premium].index_with { |tier| option(tier, version:) }
  end
end
