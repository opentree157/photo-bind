# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_05_08_000300) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "agencies", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.string "producer_code", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id"], name: "index_agencies_on_organization_id"
    t.index ["producer_code"], name: "index_agencies_on_producer_code", unique: true
  end

  create_table "audit_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "event_type", null: false
    t.text "message", null: false
    t.jsonb "metadata", default: {}, null: false
    t.bigint "organization_id", null: false
    t.bigint "subject_id", null: false
    t.string "subject_type", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["organization_id"], name: "index_audit_events_on_organization_id"
    t.index ["subject_type", "subject_id"], name: "index_audit_events_on_subject"
    t.index ["user_id"], name: "index_audit_events_on_user_id"
  end

  create_table "businesses", force: :cascade do |t|
    t.string "business_class", default: "photographer", null: false
    t.string "contact_name"
    t.datetime "created_at", null: false
    t.string "email"
    t.string "legal_name", null: false
    t.string "phone"
    t.datetime "updated_at", null: false
    t.integer "years_in_business", default: 0, null: false
  end

  create_table "documents", force: :cascade do |t|
    t.string "content_type", default: "application/pdf", null: false
    t.datetime "created_at", null: false
    t.string "document_type", null: false
    t.binary "file_data"
    t.bigint "policy_id", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["policy_id"], name: "index_documents_on_policy_id"
  end

  create_table "endorsements", force: :cascade do |t|
    t.integer "annual_delta_cents", default: 0, null: false
    t.jsonb "change_request", default: {}, null: false
    t.string "change_type", null: false
    t.datetime "created_at", null: false
    t.date "effective_date", null: false
    t.bigint "policy_id", null: false
    t.integer "premium_delta_cents", default: 0, null: false
    t.decimal "proration_factor", precision: 10, scale: 6, default: "1.0", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["policy_id"], name: "index_endorsements_on_policy_id"
  end

  create_table "idempotency_keys", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "key", null: false
    t.string "request_hash", null: false
    t.jsonb "response_body", default: {}, null: false
    t.string "scope", null: false
    t.integer "status_code"
    t.datetime "updated_at", null: false
    t.index ["key", "scope"], name: "index_idempotency_keys_on_key_and_scope", unique: true
  end

  create_table "locations", force: :cascade do |t|
    t.bigint "business_id", null: false
    t.string "city", default: "Unknown", null: false
    t.datetime "created_at", null: false
    t.string "line1", default: "Unknown", null: false
    t.string "postal_code", default: "00000", null: false
    t.boolean "primary", default: true, null: false
    t.string "state", null: false
    t.datetime "updated_at", null: false
    t.index ["business_id"], name: "index_locations_on_business_id"
  end

  create_table "organizations", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
  end

  create_table "payments", force: :cascade do |t|
    t.integer "amount_cents", default: 0, null: false
    t.datetime "authorized_at"
    t.datetime "created_at", null: false
    t.string "idempotency_key"
    t.jsonb "metadata", default: {}, null: false
    t.string "payment_intent_id", null: false
    t.bigint "policy_id"
    t.string "provider", default: "demo", null: false
    t.bigint "quote_id"
    t.string "request_hash"
    t.string "status", default: "requires_confirmation", null: false
    t.datetime "updated_at", null: false
    t.index ["payment_intent_id"], name: "index_payments_on_payment_intent_id", unique: true
    t.index ["policy_id"], name: "index_payments_on_policy_id"
    t.index ["quote_id", "idempotency_key"], name: "index_payments_on_quote_id_and_idempotency_key", unique: true, where: "(idempotency_key IS NOT NULL)"
    t.index ["quote_id"], name: "index_payments_on_quote_id"
  end

  create_table "policies", force: :cascade do |t|
    t.bigint "agency_id"
    t.datetime "created_at", null: false
    t.date "effective_date", null: false
    t.date "expiration_date", null: false
    t.bigint "organization_id", null: false
    t.string "policy_number", null: false
    t.jsonb "policy_snapshot", default: {}, null: false
    t.bigint "quote_id", null: false
    t.bigint "quote_option_id", null: false
    t.string "status", default: "bound", null: false
    t.bigint "submission_id", null: false
    t.datetime "updated_at", null: false
    t.index ["agency_id"], name: "index_policies_on_agency_id"
    t.index ["organization_id"], name: "index_policies_on_organization_id"
    t.index ["policy_number"], name: "index_policies_on_policy_number", unique: true
    t.index ["quote_id"], name: "index_policies_on_quote_id"
    t.index ["quote_option_id"], name: "index_policies_on_quote_option_id"
    t.index ["submission_id"], name: "index_policies_on_submission_id"
  end

  create_table "policy_terms", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.date "effective_date", null: false
    t.date "expiration_date", null: false
    t.bigint "policy_id", null: false
    t.jsonb "snapshot", default: {}, null: false
    t.datetime "updated_at", null: false
    t.integer "written_premium_cents", null: false
    t.index ["policy_id"], name: "index_policy_terms_on_policy_id"
  end

  create_table "product_parameters", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.string "key", null: false
    t.datetime "updated_at", null: false
    t.decimal "value", precision: 14, scale: 4, null: false
    t.string "version", null: false
    t.index ["version", "key"], name: "index_product_parameters_on_version_and_key", unique: true
  end

  create_table "quote_options", force: :cascade do |t|
    t.integer "annual_premium_cents", null: false
    t.jsonb "breakdown", default: {}, null: false
    t.datetime "created_at", null: false
    t.integer "deductible_cents", null: false
    t.string "financial_version", default: "2026.05.01", null: false
    t.integer "limit_cents", null: false
    t.integer "policy_fee_cents", null: false
    t.integer "premium_subtotal_cents", default: 0, null: false
    t.bigint "quote_id", null: false
    t.integer "stamping_fee_cents", null: false
    t.integer "stamping_fee_rate_bps", default: 80, null: false
    t.integer "state_tax_cents", null: false
    t.integer "tax_rate_bps", default: 300, null: false
    t.string "tier", null: false
    t.integer "total_due_cents", null: false
    t.datetime "updated_at", null: false
    t.index ["quote_id"], name: "index_quote_options_on_quote_id"
  end

  create_table "quotes", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "quote_number", null: false
    t.jsonb "rating_breakdown", default: {}, null: false
    t.jsonb "rating_input_snapshot", default: {}, null: false
    t.string "rating_version", null: false
    t.string "rules_version", null: false
    t.string "status", default: "draft", null: false
    t.bigint "submission_id", null: false
    t.datetime "updated_at", null: false
    t.index ["quote_number"], name: "index_quotes_on_quote_number", unique: true
    t.index ["submission_id"], name: "index_quotes_on_submission_id"
  end

  create_table "rating_factors", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.string "band", null: false
    t.string "class_code", null: false
    t.datetime "created_at", null: false
    t.decimal "factor", precision: 10, scale: 4, null: false
    t.string "factor_type", null: false
    t.string "state", null: false
    t.datetime "updated_at", null: false
    t.string "version", null: false
    t.index ["version", "state", "class_code", "factor_type", "band"], name: "idx_rating_factors_lookup", unique: true
  end

  create_table "risks", force: :cascade do |t|
    t.integer "annual_revenue_cents", default: 0, null: false
    t.string "class_code", default: "PHOTO_GL", null: false
    t.datetime "created_at", null: false
    t.integer "event_work_percent", default: 0, null: false
    t.integer "payroll_cents", default: 0, null: false
    t.integer "prior_claims_count", default: 0, null: false
    t.integer "requested_deductible_cents", default: 100000, null: false
    t.integer "requested_limit_cents", default: 100000000, null: false
    t.string "state", null: false
    t.bigint "submission_id", null: false
    t.datetime "updated_at", null: false
    t.boolean "uses_drones", default: false, null: false
    t.boolean "uses_pyrotechnics", default: false, null: false
    t.index ["submission_id"], name: "index_risks_on_submission_id"
  end

  create_table "submissions", force: :cascade do |t|
    t.bigint "agency_id"
    t.jsonb "applicant_answers", default: {}, null: false
    t.bigint "business_id", null: false
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.date "effective_date"
    t.bigint "organization_id", null: false
    t.string "source", default: "agent", null: false
    t.string "status", default: "draft", null: false
    t.string "submission_number", null: false
    t.datetime "updated_at", null: false
    t.index ["agency_id"], name: "index_submissions_on_agency_id"
    t.index ["business_id"], name: "index_submissions_on_business_id"
    t.index ["created_by_id"], name: "index_submissions_on_created_by_id"
    t.index ["organization_id"], name: "index_submissions_on_organization_id"
    t.index ["status"], name: "index_submissions_on_status"
    t.index ["submission_number"], name: "index_submissions_on_submission_number", unique: true
  end

  create_table "underwriting_decisions", force: :cascade do |t|
    t.string "action", null: false
    t.datetime "created_at", null: false
    t.datetime "decided_at", null: false
    t.bigint "decided_by_id"
    t.string "decision_type", null: false
    t.jsonb "metadata", default: {}, null: false
    t.string "outcome", null: false
    t.bigint "quote_id"
    t.text "reason", null: false
    t.string "rule_code"
    t.bigint "submission_id", null: false
    t.bigint "underwriting_referral_id"
    t.datetime "updated_at", null: false
    t.index ["decided_by_id"], name: "index_underwriting_decisions_on_decided_by_id"
    t.index ["quote_id"], name: "index_underwriting_decisions_on_quote_id"
    t.index ["rule_code"], name: "index_underwriting_decisions_on_rule_code"
    t.index ["submission_id", "decision_type"], name: "idx_on_submission_id_decision_type_d6eaf9469b"
    t.index ["submission_id"], name: "index_underwriting_decisions_on_submission_id"
    t.index ["underwriting_referral_id"], name: "index_underwriting_decisions_on_underwriting_referral_id"
  end

  create_table "underwriting_referrals", force: :cascade do |t|
    t.bigint "assigned_to_id"
    t.datetime "created_at", null: false
    t.datetime "decided_at"
    t.text "notes"
    t.bigint "quote_id"
    t.string "status", default: "open", null: false
    t.bigint "submission_id", null: false
    t.jsonb "triggered_rules", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["assigned_to_id"], name: "index_underwriting_referrals_on_assigned_to_id"
    t.index ["quote_id"], name: "index_underwriting_referrals_on_quote_id"
    t.index ["submission_id"], name: "index_underwriting_referrals_on_submission_id"
  end

  create_table "underwriting_rules", force: :cascade do |t|
    t.string "action", null: false
    t.boolean "active", default: true, null: false
    t.string "code", null: false
    t.jsonb "condition", default: {}, null: false
    t.datetime "created_at", null: false
    t.string "description", null: false
    t.datetime "updated_at", null: false
    t.string "version", null: false
    t.index ["version", "code"], name: "index_underwriting_rules_on_version_and_code", unique: true
  end

  create_table "users", force: :cascade do |t|
    t.bigint "agency_id"
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.string "role", null: false
    t.datetime "updated_at", null: false
    t.index ["agency_id"], name: "index_users_on_agency_id"
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["organization_id"], name: "index_users_on_organization_id"
  end

  create_table "webhook_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "event_type", null: false
    t.bigint "organization_id", null: false
    t.jsonb "payload", default: {}, null: false
    t.string "status", default: "pending", null: false
    t.bigint "subject_id", null: false
    t.string "subject_type", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id"], name: "index_webhook_events_on_organization_id"
    t.index ["subject_type", "subject_id"], name: "index_webhook_events_on_subject"
  end

  add_foreign_key "agencies", "organizations"
  add_foreign_key "audit_events", "organizations"
  add_foreign_key "audit_events", "users"
  add_foreign_key "documents", "policies"
  add_foreign_key "endorsements", "policies"
  add_foreign_key "locations", "businesses"
  add_foreign_key "payments", "policies"
  add_foreign_key "payments", "quotes"
  add_foreign_key "policies", "agencies"
  add_foreign_key "policies", "organizations"
  add_foreign_key "policies", "quote_options"
  add_foreign_key "policies", "quotes"
  add_foreign_key "policies", "submissions"
  add_foreign_key "policy_terms", "policies"
  add_foreign_key "quote_options", "quotes"
  add_foreign_key "quotes", "submissions"
  add_foreign_key "risks", "submissions"
  add_foreign_key "submissions", "agencies"
  add_foreign_key "submissions", "businesses"
  add_foreign_key "submissions", "organizations"
  add_foreign_key "submissions", "users", column: "created_by_id"
  add_foreign_key "underwriting_decisions", "quotes"
  add_foreign_key "underwriting_decisions", "submissions"
  add_foreign_key "underwriting_decisions", "underwriting_referrals"
  add_foreign_key "underwriting_decisions", "users", column: "decided_by_id"
  add_foreign_key "underwriting_referrals", "quotes"
  add_foreign_key "underwriting_referrals", "submissions"
  add_foreign_key "underwriting_referrals", "users", column: "assigned_to_id"
  add_foreign_key "users", "agencies"
  add_foreign_key "users", "organizations"
  add_foreign_key "webhook_events", "organizations"
end
