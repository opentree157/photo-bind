import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  ClipboardList,
  FileBadge,
  FileText,
  GitBranch,
  LayoutDashboard,
  LockKeyhole,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Webhook
} from "lucide-react";
import { useMemo, useState } from "react";
import { auditEvents, endorsements, policies, quotes, referrals, submissions, webhookEvents } from "./data";
import { Submission, buildQuote, canTransition, dollars, evaluateEligibility, rateSubmission, underwritingRules } from "./domain";

type View = "dashboard" | "submission" | "quotes" | "underwriting" | "policy" | "admin" | "analytics";

const navItems: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "submission", label: "Submission", icon: ClipboardList },
  { view: "quotes", label: "Quotes", icon: SlidersHorizontal },
  { view: "underwriting", label: "Underwriting", icon: UserCheck },
  { view: "policy", label: "Policy", icon: FileBadge },
  { view: "admin", label: "Admin", icon: Settings },
  { view: "analytics", label: "Analytics", icon: BarChart3 }
];

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("SUB-1007");
  const [selectedQuoteOptionId, setSelectedQuoteOptionId] = useState("SUB-1007-OPT-2");
  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0];
  const selectedQuote = useMemo(() => buildQuote(selectedSubmission), [selectedSubmission]);
  const selectedOption = selectedQuote.options.find((option) => option.id === selectedQuoteOptionId) ?? selectedQuote.options[1];

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">PB</div>
          <div>
            <h1>PhotoBind</h1>
            <span>Small commercial GL</span>
          </div>
        </div>

        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.view ? "active" : ""} key={item.view} onClick={() => setView(item.view)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="rolePanel">
          <span>Current role</span>
          <strong>Agent</strong>
          <small>Bind requests enabled. Referral approvals locked.</small>
        </div>
      </aside>

      <main>
        <Topbar selectedSubmission={selectedSubmission} setSelectedSubmissionId={setSelectedSubmissionId} />
        {view === "dashboard" && <Dashboard setView={setView} setSelectedSubmissionId={setSelectedSubmissionId} />}
        {view === "submission" && <SubmissionWizard submission={selectedSubmission} />}
        {view === "quotes" && (
          <QuoteCompare
            selectedOptionId={selectedQuoteOptionId}
            setSelectedOptionId={setSelectedQuoteOptionId}
            quote={selectedQuote}
            submission={selectedSubmission}
          />
        )}
        {view === "underwriting" && <UnderwritingQueue />}
        {view === "policy" && <PolicyDetail />}
        {view === "admin" && <AdminEditor />}
        {view === "analytics" && <Analytics />}
      </main>

      <aside className="rightRail">
        <section className="railSection">
          <h2>Lifecycle</h2>
          <Lifecycle status={selectedSubmission.status} />
        </section>

        <section className="railSection">
          <h2>Selected Option</h2>
          <div className="selectedOption">
            <strong>{selectedOption.tier}</strong>
            <span>{selectedOption.limit}</span>
            <b>{dollars(selectedOption.breakdown.totalDue)}</b>
          </div>
        </section>

        <section className="railSection">
          <h2>Audit Stream</h2>
          <div className="auditList">
            {auditEvents.slice(0, 4).map((event) => (
              <div className="auditItem" key={event.id}>
                <span>{event.action}</span>
                <p>{event.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function Topbar({
  selectedSubmission,
  setSelectedSubmissionId
}: {
  selectedSubmission: Submission;
  setSelectedSubmissionId: (id: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="searchBox">
        <Search size={18} />
        <select value={selectedSubmission.id} onChange={(event: { target: { value: string } }) => setSelectedSubmissionId(event.target.value)}>
          {submissions.map((submission) => (
            <option key={submission.id} value={submission.id}>
              {submission.id} - {submission.business.name}
            </option>
          ))}
        </select>
      </div>
      <div className="topbarMeta">
        <span>Rules {selectedSubmission.ruleVersion}</span>
        <span>Rates {selectedSubmission.ratingVersion}</span>
      </div>
    </header>
  );
}

function Dashboard({
  setView,
  setSelectedSubmissionId
}: {
  setView: (view: View) => void;
  setSelectedSubmissionId: (id: string) => void;
}) {
  const funnel = [
    { label: "Draft", value: 18 },
    { label: "Submitted", value: 42 },
    { label: "Quoted", value: 31 },
    { label: "Referred", value: 9 },
    { label: "Bound", value: 12 },
    { label: "Issued", value: 10 }
  ];

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Agent workspace</p>
          <h2>Submission intake, quoting, bind, and issuance</h2>
        </div>
        <button className="primaryButton" onClick={() => setView("submission")}>
          <ClipboardList size={18} />
          New submission
        </button>
      </section>

      <section className="metricGrid">
        <Metric label="Open submissions" value="74" trend="+12%" />
        <Metric label="Referral rate" value="21%" trend="-4%" />
        <Metric label="Quote-to-bind" value="38%" trend="+7%" />
        <Metric label="Avg premium" value="$1,184" trend="+3%" />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Pipeline</h3>
            <span>May 2026</span>
          </div>
          <div className="funnel">
            {funnel.map((step) => (
              <div key={step.label}>
                <span>{step.label}</span>
                <div>
                  <i style={{ width: `${Math.max(step.value * 2, 12)}px` }} />
                </div>
                <b>{step.value}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h3>Submissions</h3>
            <span>{submissions.length} active</span>
          </div>
          <div className="table">
            {submissions.map((submission) => (
              <button
                className="tableRow"
                key={submission.id}
                onClick={() => {
                  setSelectedSubmissionId(submission.id);
                  setView(submission.status === "referred" ? "underwriting" : "quotes");
                }}
              >
                <span>
                  <strong>{submission.business.name}</strong>
                  <small>{submission.id} / {submission.producer}</small>
                </span>
                <StatusPill status={submission.status} />
                <b>{dollars(rateSubmission(submission).totalDue)}</b>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SubmissionWizard({ submission }: { submission: Submission }) {
  const triggers = evaluateEligibility(submission);
  const quote = buildQuote(submission);

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>New submission wizard</p>
          <h2>{submission.business.name}</h2>
        </div>
        <button className="secondaryButton">
          Submit risk
          <ArrowRight size={18} />
        </button>
      </section>

      <section className="wizard">
        <div className="wizardSteps">
          {["Business", "Risk", "Coverage", "Review"].map((step, index) => (
            <div className="step activeStep" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>

        <div className="formGrid">
          <Field label="Business name" value={submission.business.name} />
          <Field label="Primary contact" value={submission.business.contact} />
          <Field label="State" value={submission.business.state} />
          <Field label="Class code" value={submission.risk.classCode} />
          <Field label="Annual revenue" value={dollars(submission.business.annualRevenue)} />
          <Field label="Payroll" value={dollars(submission.business.payroll)} />
          <Field label="Years in business" value={`${submission.business.yearsInBusiness}`} />
          <Field label="Prior claims" value={`${submission.business.priorClaimsCount}`} />
          <Field label="Limit" value={`$${submission.risk.limit.toLocaleString()}`} />
          <Field label="Deductible" value={dollars(submission.risk.deductible)} />
          <Field label="Drone work" value={submission.risk.usesDrones ? "Yes" : "No"} />
          <Field label="Pyrotechnics" value={submission.risk.pyrotechnics ? "Yes" : "No"} />
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Eligibility</h3>
            <span>{submission.ruleVersion}</span>
          </div>
          {triggers.length === 0 ? (
            <div className="emptyState">
              <ShieldCheck size={24} />
              <strong>Automatic appetite match</strong>
              <span>No referral or decline rules triggered.</span>
            </div>
          ) : (
            <div className="ruleList">
              {triggers.map((trigger) => (
                <div className={`ruleItem ${trigger.action}`} key={trigger.code}>
                  <AlertTriangle size={18} />
                  <span>
                    <strong>{trigger.code}</strong>
                    <small>{trigger.label}</small>
                  </span>
                  <b>{trigger.action}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h3>Instant Quote Preview</h3>
            <span>{quote.ratingVersion}</span>
          </div>
          <div className="quoteMini">
            {quote.options.map((option) => (
              <div key={option.id}>
                <span>{option.tier}</span>
                <strong>{dollars(option.breakdown.totalDue)}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function QuoteCompare({
  submission,
  quote,
  selectedOptionId,
  setSelectedOptionId
}: {
  submission: Submission;
  quote: ReturnType<typeof buildQuote>;
  selectedOptionId: string;
  setSelectedOptionId: (id: string) => void;
}) {
  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Quote comparison</p>
          <h2>{submission.business.name}</h2>
        </div>
        <button className="primaryButton">
          <LockKeyhole size={18} />
          Request bind
        </button>
      </section>

      <section className="quoteGrid">
        {quote.options.map((option) => (
          <button
            className={`quoteCard ${selectedOptionId === option.id ? "selected" : ""}`}
            key={option.id}
            onClick={() => setSelectedOptionId(option.id)}
          >
            <span>{option.tier}</span>
            <strong>{dollars(option.breakdown.totalDue)}</strong>
            <small>{option.limit} / {dollars(option.deductible)} deductible</small>
            <div className="coverageList">
              {option.endorsements.map((endorsement) => (
                <p key={endorsement}>
                  <Check size={15} />
                  {endorsement}
                </p>
              ))}
            </div>
          </button>
        ))}
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h3>Premium Breakdown</h3>
          <span>{quote.ratingVersion}</span>
        </div>
        <div className="breakdownGrid">
          {Object.entries(quote.options.find((option) => option.id === selectedOptionId)?.breakdown ?? quote.options[0].breakdown).map(([key, value]) => (
            <div key={key}>
              <span>{labelize(key)}</span>
              <strong>{key.toLowerCase().includes("factor") ? Number(value).toFixed(2) : dollars(Number(value))}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function UnderwritingQueue() {
  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Underwriter queue</p>
          <h2>Referrals awaiting review</h2>
        </div>
        <button className="secondaryButton">
          <GitBranch size={18} />
          Authority matrix
        </button>
      </section>

      <section className="queue">
        {referrals.map((referral) => {
          const submission = submissions.find((item) => item.id === referral.submissionId)!;
          return (
            <div className="referralCard" key={referral.id}>
              <div>
                <span>{referral.id}</span>
                <h3>{submission.business.name}</h3>
                <p>{dollars(submission.business.annualRevenue)} revenue / {submission.risk.classCode}</p>
              </div>
              <div className="ruleList">
                {referral.triggers.map((trigger) => (
                  <div className={`ruleItem ${trigger.action}`} key={trigger.code}>
                    <AlertTriangle size={18} />
                    <span>
                      <strong>{trigger.code}</strong>
                      <small>{trigger.label}</small>
                    </span>
                    <b>{trigger.action}</b>
                  </div>
                ))}
              </div>
              <textarea defaultValue={referral.notes.join("\n")} aria-label="Underwriting notes" />
              <div className="buttonRow">
                <button className="secondaryButton">Decline</button>
                <button className="primaryButton">Approve with terms</button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function PolicyDetail() {
  const policy = policies[0];

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Policy detail</p>
          <h2>{policy.policyNumber}</h2>
        </div>
        <button className="primaryButton">
          <FileText size={18} />
          Declaration PDF
        </button>
      </section>

      <section className="policyHero">
        <div>
          <span>Named insured</span>
          <strong>{policy.insured}</strong>
        </div>
        <div>
          <span>Term</span>
          <strong>{policy.effectiveDate} to {policy.expirationDate}</strong>
        </div>
        <div>
          <span>Total premium</span>
          <strong>{dollars(policy.premium)}</strong>
        </div>
        <div>
          <span>Snapshot</span>
          <strong>{policy.snapshot.ratingVersion}</strong>
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Documents</h3>
            <span>Async jobs</span>
          </div>
          {["Declaration page", "Policy jacket", "Additional insured schedule"].map((document) => (
            <div className="documentRow" key={document}>
              <FileText size={18} />
              <span>{document}</span>
              <b>Generated</b>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h3>Endorsements</h3>
            <span>{endorsements.length} open</span>
          </div>
          {endorsements.map((endorsement) => (
            <div className="documentRow" key={endorsement.id}>
              <Sparkles size={18} />
              <span>{labelize(endorsement.type)}</span>
              <b>{dollars(endorsement.premiumDelta)}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminEditor() {
  const factors = [
    ["MA", "PHOTO-PORTRAIT", "1.12", "1.00", "active"],
    ["CT", "PHOTO-DRONE", "1.06", "1.35", "review"],
    ["RI", "PHOTO-WEDDING", "1.02", "1.18", "active"],
    ["NH", "PHOTO-STUDIO", "0.96", "0.94", "active"]
  ];

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Admin/Product manager</p>
          <h2>Rating tables, forms, appetite, and rule versions</h2>
        </div>
        <button className="primaryButton">
          <Settings size={18} />
          Publish version
        </button>
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Rating Table</h3>
            <span>RT-2026.05.01</span>
          </div>
          <div className="factorTable">
            {factors.map((row) => (
              <div key={row.join("-")}>
                {row.map((cell) => (
                  <span key={cell}>{cell}</span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h3>Underwriting Rules</h3>
            <span>UW-2026.05-v3</span>
          </div>
          <div className="ruleList">
            {underwritingRules.map((rule) => (
              <div className={`ruleItem ${rule.action}`} key={rule.code}>
                <ShieldCheck size={18} />
                <span>
                  <strong>{rule.code}</strong>
                  <small>{rule.label}</small>
                </span>
                <b>{rule.action}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h3>Partner API Events</h3>
          <span>Embedded quote flow</span>
        </div>
        <div className="webhookGrid">
          {webhookEvents.map((event) => (
            <div key={event.id}>
              <Webhook size={18} />
              <span>
                <strong>{event.type}</strong>
                <small>{event.payload}</small>
              </span>
              <b>{event.status}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Analytics() {
  const quoteToBind = Math.round((policies.length / quotes.length) * 100);
  const referralRate = Math.round((referrals.length / submissions.length) * 100);

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Portfolio analytics</p>
          <h2>Submission flow, workload, and portfolio risk</h2>
        </div>
      </section>

      <section className="metricGrid">
        <Metric label="Submission volume" value="146" trend="+18%" />
        <Metric label="Referral rate" value={`${referralRate}%`} trend="-2%" />
        <Metric label="Quote-to-bind" value={`${quoteToBind}%`} trend="+5%" />
        <Metric label="Portfolio premium" value="$172k" trend="+11%" />
      </section>

      <section className="analyticsGrid">
        {[
          ["Portrait", 34],
          ["Wedding", 28],
          ["Studio", 22],
          ["Drone", 16]
        ].map(([label, value]) => (
          <div className="analyticsBar" key={label}>
            <span>{label}</span>
            <div><i style={{ width: `${value}%` }} /></div>
            <b>{value}%</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function Lifecycle({ status }: { status: Submission["status"] }) {
  const states: Submission["status"][] = ["draft", "submitted", "quoted", "referred", "approved", "bind_requested", "bound", "issued"];

  return (
    <div className="lifecycle">
      {states.map((item, index) => (
        <div className={item === status ? "current" : ""} key={item}>
          <span>{index + 1}</span>
          <strong>{labelize(item)}</strong>
          <small>{item === status ? "Current" : canTransition(item, status) ? "Allowed" : "Guarded"}</small>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function StatusPill({ status }: { status: Submission["status"] }) {
  return <span className={`statusPill ${status}`}>{labelize(status)}</span>;
}

function labelize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase());
}
