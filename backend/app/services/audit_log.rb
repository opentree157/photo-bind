class AuditLog
  def self.record!(subject:, event_type:, message:, user: nil, organization: nil, metadata: {})
    organization ||= subject.try(:organization) || subject.try(:submission)&.organization || subject.try(:policy)&.organization
    AuditEvent.create!(organization:, user:, subject:, event_type:, message:, metadata:)
    Rails.logger.info({ event: event_type, subject: "#{subject.class.name}:#{subject.id}", message:, metadata: }.to_json)
  end
end
