class WebhookEmitter
  def self.emit!(event_type, subject)
    organization = subject.try(:organization) || subject.try(:submission)&.organization || subject.try(:policy)&.organization
    WebhookEvent.create!(organization:, event_type:, subject:, payload: serialize(subject))
    Rails.logger.info({ event: "webhook.enqueued", type: event_type, subject: "#{subject.class}:#{subject.id}" }.to_json)
  end

  def self.serialize(subject)
    subject.as_json(except: %i[created_at updated_at])
  end
end
