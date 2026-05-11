class AddDecisionsAndFinancialControls < ActiveRecord::Migration[8.1]
  def change
    create_table :underwriting_decisions do |t|
      t.references :submission, null: false, foreign_key: true
      t.references :quote, foreign_key: true
      t.references :underwriting_referral, foreign_key: true
      t.references :decided_by, foreign_key: { to_table: :users }
      t.string :decision_type, null: false
      t.string :rule_code
      t.string :action, null: false
      t.string :outcome, null: false
      t.text :reason, null: false
      t.jsonb :metadata, null: false, default: {}
      t.datetime :decided_at, null: false
      t.timestamps
    end
    add_index :underwriting_decisions, %i[submission_id decision_type]
    add_index :underwriting_decisions, :rule_code

    add_column :quote_options, :premium_subtotal_cents, :integer, null: false, default: 0
    add_column :quote_options, :tax_rate_bps, :integer, null: false, default: 300
    add_column :quote_options, :stamping_fee_rate_bps, :integer, null: false, default: 80
    add_column :quote_options, :financial_version, :string, null: false, default: "2026.05.01"

    add_column :payments, :idempotency_key, :string
    add_column :payments, :request_hash, :string
    add_column :payments, :authorized_at, :datetime
    add_column :payments, :metadata, :jsonb, null: false, default: {}
    add_index :payments, %i[quote_id idempotency_key], unique: true, where: "idempotency_key IS NOT NULL"

    add_column :endorsements, :proration_factor, :decimal, precision: 10, scale: 6, null: false, default: 1
    add_column :endorsements, :annual_delta_cents, :integer, null: false, default: 0
  end
end
