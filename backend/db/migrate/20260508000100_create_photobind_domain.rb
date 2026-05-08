class CreatePhotobindDomain < ActiveRecord::Migration[8.1]
  def change
    create_table :organizations do |t|
      t.string :name, null: false
      t.timestamps
    end

    create_table :agencies do |t|
      t.references :organization, null: false, foreign_key: true
      t.string :name, null: false
      t.string :producer_code, null: false
      t.timestamps
    end
    add_index :agencies, :producer_code, unique: true

    create_table :users do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agency, foreign_key: true
      t.string :name, null: false
      t.string :email, null: false
      t.string :role, null: false
      t.timestamps
    end
    add_index :users, :email, unique: true

    create_table :businesses do |t|
      t.string :legal_name, null: false
      t.string :contact_name
      t.string :email
      t.string :phone
      t.string :business_class, null: false, default: "photographer"
      t.integer :years_in_business, null: false, default: 0
      t.timestamps
    end

    create_table :locations do |t|
      t.references :business, null: false, foreign_key: true
      t.string :line1, null: false, default: "Unknown"
      t.string :city, null: false, default: "Unknown"
      t.string :state, null: false
      t.string :postal_code, null: false, default: "00000"
      t.boolean :primary, null: false, default: true
      t.timestamps
    end

    create_table :submissions do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agency, foreign_key: true
      t.references :created_by, foreign_key: { to_table: :users }
      t.references :business, null: false, foreign_key: true
      t.string :submission_number, null: false
      t.string :status, null: false, default: "draft"
      t.string :source, null: false, default: "agent"
      t.date :effective_date
      t.jsonb :applicant_answers, null: false, default: {}
      t.timestamps
    end
    add_index :submissions, :submission_number, unique: true
    add_index :submissions, :status

    create_table :risks do |t|
      t.references :submission, null: false, foreign_key: true
      t.integer :annual_revenue_cents, null: false, default: 0
      t.integer :payroll_cents, null: false, default: 0
      t.integer :prior_claims_count, null: false, default: 0
      t.boolean :uses_drones, null: false, default: false
      t.boolean :uses_pyrotechnics, null: false, default: false
      t.integer :event_work_percent, null: false, default: 0
      t.string :state, null: false
      t.string :class_code, null: false, default: "PHOTO_GL"
      t.integer :requested_limit_cents, null: false, default: 1_000_000_00
      t.integer :requested_deductible_cents, null: false, default: 1_000_00
      t.timestamps
    end

    create_table :quotes do |t|
      t.references :submission, null: false, foreign_key: true
      t.string :quote_number, null: false
      t.string :status, null: false, default: "draft"
      t.string :rating_version, null: false
      t.string :rules_version, null: false
      t.jsonb :rating_input_snapshot, null: false, default: {}
      t.jsonb :rating_breakdown, null: false, default: {}
      t.timestamps
    end
    add_index :quotes, :quote_number, unique: true

    create_table :quote_options do |t|
      t.references :quote, null: false, foreign_key: true
      t.string :tier, null: false
      t.integer :limit_cents, null: false
      t.integer :deductible_cents, null: false
      t.integer :annual_premium_cents, null: false
      t.integer :policy_fee_cents, null: false
      t.integer :state_tax_cents, null: false
      t.integer :stamping_fee_cents, null: false
      t.integer :total_due_cents, null: false
      t.jsonb :breakdown, null: false, default: {}
      t.timestamps
    end

    create_table :rating_factors do |t|
      t.string :version, null: false
      t.string :state, null: false
      t.string :class_code, null: false
      t.string :factor_type, null: false
      t.string :band, null: false
      t.decimal :factor, precision: 10, scale: 4, null: false
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :rating_factors, %i[version state class_code factor_type band], unique: true, name: "idx_rating_factors_lookup"

    create_table :underwriting_rules do |t|
      t.string :version, null: false
      t.string :code, null: false
      t.string :action, null: false
      t.string :description, null: false
      t.jsonb :condition, null: false, default: {}
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :underwriting_rules, %i[version code], unique: true

    create_table :underwriting_referrals do |t|
      t.references :submission, null: false, foreign_key: true
      t.references :quote, foreign_key: true
      t.references :assigned_to, foreign_key: { to_table: :users }
      t.string :status, null: false, default: "open"
      t.jsonb :triggered_rules, null: false, default: []
      t.text :notes
      t.datetime :decided_at
      t.timestamps
    end

    create_table :policies do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agency, foreign_key: true
      t.references :submission, null: false, foreign_key: true
      t.references :quote, null: false, foreign_key: true
      t.references :quote_option, null: false, foreign_key: true
      t.string :policy_number, null: false
      t.string :status, null: false, default: "bound"
      t.date :effective_date, null: false
      t.date :expiration_date, null: false
      t.jsonb :policy_snapshot, null: false, default: {}
      t.timestamps
    end
    add_index :policies, :policy_number, unique: true

    create_table :policy_terms do |t|
      t.references :policy, null: false, foreign_key: true
      t.date :effective_date, null: false
      t.date :expiration_date, null: false
      t.integer :written_premium_cents, null: false
      t.jsonb :snapshot, null: false, default: {}
      t.timestamps
    end

    create_table :endorsements do |t|
      t.references :policy, null: false, foreign_key: true
      t.string :status, null: false, default: "pending"
      t.string :change_type, null: false
      t.date :effective_date, null: false
      t.jsonb :change_request, null: false, default: {}
      t.integer :premium_delta_cents, null: false, default: 0
      t.timestamps
    end

    create_table :documents do |t|
      t.references :policy, null: false, foreign_key: true
      t.string :document_type, null: false
      t.string :status, null: false, default: "pending"
      t.string :content_type, null: false, default: "application/pdf"
      t.binary :file_data
      t.timestamps
    end

    create_table :audit_events do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :user, foreign_key: true
      t.references :subject, polymorphic: true, null: false
      t.string :event_type, null: false
      t.text :message, null: false
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    create_table :payments do |t|
      t.references :policy, foreign_key: true
      t.references :quote, foreign_key: true
      t.string :provider, null: false, default: "demo"
      t.string :payment_intent_id, null: false
      t.string :status, null: false, default: "requires_confirmation"
      t.integer :amount_cents, null: false, default: 0
      t.timestamps
    end
    add_index :payments, :payment_intent_id, unique: true

    create_table :webhook_events do |t|
      t.references :organization, null: false, foreign_key: true
      t.string :event_type, null: false
      t.references :subject, polymorphic: true, null: false
      t.jsonb :payload, null: false, default: {}
      t.string :status, null: false, default: "pending"
      t.timestamps
    end

    create_table :idempotency_keys do |t|
      t.string :key, null: false
      t.string :scope, null: false
      t.string :request_hash, null: false
      t.integer :status_code
      t.jsonb :response_body, null: false, default: {}
      t.timestamps
    end
    add_index :idempotency_keys, %i[key scope], unique: true
  end
end
