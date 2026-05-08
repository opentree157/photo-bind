class WorkflowTransition
  TRANSITIONS = {
    "draft" => %w[submitted cancelled],
    "submitted" => %w[quoted referred ineligible declined],
    "referred" => %w[approved declined],
    "approved" => %w[quoted],
    "quoted" => %w[bind_requested cancelled],
    "bind_requested" => %w[bound cancelled],
    "bound" => %w[issued cancelled],
    "issued" => %w[endorsement_pending cancelled],
    "endorsement_pending" => %w[issued cancelled]
  }.freeze

  def self.apply!(submission, to:, user: nil, metadata: {})
    from = submission.status
    raise ArgumentError, "Invalid transition #{from} -> #{to}" unless TRANSITIONS.fetch(from, []).include?(to)

    submission.update!(status: to)
    AuditLog.record!(
      subject: submission,
      user:,
      event_type: "submission.#{to}",
      message: "Submission moved from #{from} to #{to}",
      metadata: metadata.merge(from:, to:)
    )
    submission
  end
end
