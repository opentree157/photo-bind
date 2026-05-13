class CreateProductParameters < ActiveRecord::Migration[8.1]
  def change
    create_table :product_parameters do |t|
      t.string :version, null: false
      t.string :key, null: false
      t.decimal :value, precision: 14, scale: 4, null: false
      t.boolean :active, null: false, default: true
      t.timestamps
    end

    add_index :product_parameters, %i[version key], unique: true
  end
end
