module AuditableChanges
  extend ActiveSupport::Concern

  included do
    after_update_commit :record_auditable_changes
  end

  private

  def record_auditable_changes
    changes = previous_changes.except("updated_at", "created_at", "file_data")
    return if changes.empty?

    AuditLog.record!(
      subject: self,
      event_type: "#{self.class.name.underscore}.updated",
      message: "#{self.class.name} updated",
      metadata: { changes: changes.transform_values { |(before, after)| { before:, after: } } }
    )
  end
end
