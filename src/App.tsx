import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Camera,
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
import { useEffect, useMemo, useState } from "react";
import { auditEvents, endorsements, policies, quotes, referrals, submissions, webhookEvents } from "./data";
import { Policy, Role, Submission, buildQuote, canTransition, dollars, evaluateEligibility, rateSubmission, underwritingRules } from "./domain";
import { DocumentRecord, PlatformState, apiEndpoints, bindSubmission, quoteSubmission, upsertSubmission } from "./platform";

type View = "dashboard" | "submission" | "quotes" | "underwriting" | "policy" | "admin" | "analytics";
type Workspace = "frontoffice" | "backoffice";

const navItems: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "submission", label: "Submission", icon: ClipboardList },
  { view: "quotes", label: "Quotes", icon: SlidersHorizontal },
  { view: "underwriting", label: "Underwriting", icon: UserCheck },
  { view: "policy", label: "Policy", icon: FileBadge },
  { view: "admin", label: "Admin", icon: Settings },
  { view: "analytics", label: "Analytics", icon: BarChart3 }
];

const roleCapabilities: Record<Role, string> = {
  agent: "Create submissions, compare quotes, request bind.",
  underwriter: "Review referrals, approve/decline, adjust terms.",
  admin: "Configure rates, rules, appetite, and forms.",
  applicant: "Use the public quote flow with internal actions hidden."
};

const storageKey = "photobind.platformState.v1";

function initialPlatformState(): PlatformState {
  const seededDocuments = policies.map((policy) => ({
    id: `DOC-DEC-${policy.policyNumber}`,
    policyId: policy.id,
    name: "Declaration page PDF",
    status: "generated" as const,
    generatedAt: policy.snapshot.issuedAt,
    html: `<h1>${policy.policyNumber}</h1><p>${policy.insured}</p>`
  }));

  return {
    submissions,
    policies,
    auditEvents,
    webhookEvents,
    documents: seededDocuments,
    idempotencyLedger: {}
  };
}

function loadPlatformState() {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return initialPlatformState();
    const parsed = JSON.parse(stored) as Partial<PlatformState>;
    const seed = initialPlatformState();
    return {
      submissions: parsed.submissions ?? seed.submissions,
      policies: parsed.policies ?? seed.policies,
      auditEvents: parsed.auditEvents ?? seed.auditEvents,
      webhookEvents: parsed.webhookEvents ?? seed.webhookEvents,
      documents: parsed.documents ?? seed.documents,
      idempotencyLedger: parsed.idempotencyLedger ?? {}
    };
  } catch {
    return initialPlatformState();
  }
}

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [role, setRole] = useState<Role>("agent");
  const [workspace, setWorkspace] = useState<Workspace>("backoffice");
  const [platformState, setPlatformState] = useState<PlatformState>(loadPlatformState());
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("SUB-1007");
  const [selectedQuoteOptionId, setSelectedQuoteOptionId] = useState("SUB-1007-OPT-2");
  const allSubmissions = platformState.submissions;
  const selectedSubmission = allSubmissions.find((submission) => submission.id === selectedSubmissionId) ?? allSubmissions[0];
  const selectedQuote = useMemo(() => buildQuote(selectedSubmission), [selectedSubmission]);
  const selectedOption = selectedQuote.options.find((option) => option.id === selectedQuoteOptionId) ?? selectedQuote.options[1];

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(platformState));
  }, [platformState]);

  function upsertApplicantSubmission(submission: Submission) {
    setPlatformState((current) => upsertSubmission(current, submission, "Applicant"));
    setSelectedSubmissionId(submission.id);
  }

  function requestBind(submissionId: string, optionId: string, actor: string) {
    const idempotencyKey = `bind:${submissionId}:${optionId}`;
    setPlatformState((current) => bindSubmission(current, submissionId, optionId, actor, idempotencyKey));
    setSelectedSubmissionId(submissionId);
  }

  function switchRole(nextRole: Role) {
    setRole(nextRole);
    setWorkspace(nextRole === "applicant" ? "frontoffice" : "backoffice");
  }

  if (workspace === "frontoffice") {
    return (
      <FrontofficePortal
        onBackoffice={() => switchRole("agent")}
        onRoleChange={switchRole}
        onBindRequest={(submissionId, optionId) => requestBind(submissionId, optionId, "Applicant")}
        onSubmissionChange={upsertApplicantSubmission}
        role={role}
      />
    );
  }

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
          <span>Workspace</span>
          <div className="workspaceSwitch">
            <button className="active" type="button" onClick={() => setWorkspace("backoffice")}>Backoffice</button>
            <button type="button" onClick={() => switchRole("applicant")}>Frontoffice</button>
          </div>
          <span>Current role</span>
          <select aria-label="Current role" value={role} onChange={(event: { target: { value: Role } }) => switchRole(event.target.value)}>
            <option value="agent">Agent</option>
            <option value="underwriter">Underwriter</option>
            <option value="admin">Admin/Product</option>
          </select>
          <small>{roleCapabilities[role]}</small>
        </div>
      </aside>

      <main>
        <Topbar selectedSubmission={selectedSubmission} setSelectedSubmissionId={setSelectedSubmissionId} submissions={allSubmissions} />
        {view === "dashboard" && <Dashboard role={role} setView={setView} setSelectedSubmissionId={setSelectedSubmissionId} submissions={allSubmissions} />}
        {view === "submission" && <SubmissionWizard role={role} submission={selectedSubmission} />}
        {view === "quotes" && (
          <QuoteCompare
            onBindRequest={(optionId) => requestBind(selectedSubmission.id, optionId, labelize(role))}
            role={role}
            selectedOptionId={selectedQuoteOptionId}
            setSelectedOptionId={setSelectedQuoteOptionId}
            quote={selectedQuote}
            submission={selectedSubmission}
          />
        )}
        {view === "underwriting" && <UnderwritingQueue role={role} />}
        {view === "policy" && <PolicyDetail documents={platformState.documents} policies={platformState.policies} />}
        {view === "admin" && <AdminEditor auditEvents={platformState.auditEvents} role={role} webhookEvents={platformState.webhookEvents} />}
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
            {platformState.auditEvents.slice(0, 4).map((event) => (
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

function FrontofficePortal({
  onBindRequest,
  onBackoffice,
  onRoleChange,
  onSubmissionChange,
  role
}: {
  onBindRequest: (submissionId: string, optionId: string) => void;
  onBackoffice: () => void;
  onRoleChange: (role: Role) => void;
  onSubmissionChange: (submission: Submission) => void;
  role: Role;
}) {
  type FrontStep = "questions" | "loading" | "quotes" | "bind";
  const [form, setForm] = useState({
    businessName: "North Shore Portrait Co.",
    email: "elena@northshoreportraits.example",
    state: "MA",
    annualRevenue: "640000",
    yearsInBusiness: "7",
    priorClaimsCount: "0",
    classCode: "PHOTO-PORTRAIT",
    eventWorkPercent: "18",
    usesDrones: false,
    pyrotechnics: false,
    effectiveDate: "2026-06-01",
    signatureName: "",
    paymentIntent: "card"
  });
  const [frontStep, setFrontStep] = useState<FrontStep>("questions");
  const [selectedOptionId, setSelectedOptionId] = useState("PUBLIC-QUOTE-OPT-2");
  const [bindRequested, setBindRequested] = useState(false);

  const publicSubmission: Submission = {
    id: "PUBLIC-QUOTE",
    agency: "Direct",
    producer: "Applicant portal",
    status: "submitted",
    business: {
      name: form.businessName,
      contact: form.businessName,
      email: form.email,
      state: form.state as Submission["business"]["state"],
      city: "Applicant city",
      annualRevenue: Number(form.annualRevenue) || 0,
      payroll: Math.round((Number(form.annualRevenue) || 0) * 0.32),
      yearsInBusiness: Number(form.yearsInBusiness) || 0,
      priorClaimsCount: Number(form.priorClaimsCount) || 0
    },
    risk: {
      classCode: form.classCode as Submission["risk"]["classCode"],
      usesDrones: form.usesDrones,
      pyrotechnics: form.pyrotechnics,
      eventWorkPercent: Number(form.eventWorkPercent) || 0,
      limit: 1_000_000,
      deductible: 1000
    },
    effectiveDate: form.effectiveDate,
    createdAt: "2026-05-06T17:30:00Z",
    ruleVersion: "UW-2026.05-v3",
    ratingVersion: "RT-2026.05.01"
  };
  const quote = buildQuote(publicSubmission);
  const triggers = evaluateEligibility(publicSubmission);
  const declineTriggers = triggers.filter((trigger) => trigger.action === "decline");
  const referTriggers = triggers.filter((trigger) => trigger.action === "refer");
  const selectedOption = quote.options.find((option) => option.id === selectedOptionId) ?? quote.options[1];
  const quotedStatus: Submission["status"] = declineTriggers.length > 0 ? "ineligible" : referTriggers.length > 0 ? "referred" : "quoted";

  function updateField(name: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
    if (name !== "signatureName" && name !== "paymentIntent") {
      setFrontStep("questions");
      setBindRequested(false);
    }
  }

  function submitQuote() {
    onSubmissionChange(quoteSubmission({ ...publicSubmission, status: "draft" }));
    setFrontStep("loading");
    setBindRequested(false);
    window.setTimeout(() => setFrontStep("quotes"), 5000);
  }

  return (
    <div className="frontofficeShell">
      <header className="frontofficeTopbar">
        <div className="frontofficeBrand">
          <div className="brandMark">PB</div>
          <div>
            <strong>PhotoBind</strong>
            <span>General liability for photographers</span>
          </div>
        </div>
        <div className="frontofficeActions">
          <select aria-label="Customer role" value={role} onChange={(event: { target: { value: Role } }) => onRoleChange(event.target.value)}>
            <option value="applicant">Applicant</option>
            <option value="agent">Agent</option>
            <option value="underwriter">Underwriter</option>
            <option value="admin">Admin/Product</option>
          </select>
          <button className="secondaryButton" type="button" onClick={onBackoffice}>Backoffice</button>
        </div>
      </header>

      <main className="frontofficeMain">
        <section className="frontHero">
          <div className="frontHeroCopy">
            <p>Customer quote flow</p>
            <h1>Coverage for photographers who work on location, in studio, and at events</h1>
            <span>Answer a few business questions, see your options, and request bind when you are ready.</span>
          </div>
          <div className="frontHeroPhoto" aria-label="Photographer preparing a client shoot">
            <div className="frontQuoteSummary">
              <Camera size={24} />
              <span>{frontStep === "quotes" || frontStep === "bind" ? "Selected annual due" : "Quote not submitted"}</span>
              <strong>{frontStep === "quotes" || frontStep === "bind" ? dollars(selectedOption.breakdown.totalDue) : "--"}</strong>
              <small>{frontStep === "quotes" || frontStep === "bind" ? `${selectedOption.tier} / ${selectedOption.limit}` : "Complete the questions below"}</small>
            </div>
          </div>
        </section>

        <section className="frontProgress">
          {[
            ["questions", "Questions"],
            ["quotes", "Quote results"],
            ["bind", "Purchase and bind"]
          ].map(([step, label], index) => (
            <div className={frontStep === step || (frontStep === "loading" && step === "quotes") ? "active" : ""} key={step}>
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </section>

        <section className="frontTrustStrip">
          <div>
            <strong>Fast appetite check</strong>
            <span>State, claims, drones, and pyrotechnics are screened before quote.</span>
          </div>
          <div>
            <strong>Bindable options</strong>
            <span>Basic, Standard, and Premium packages use the same rating engine as backoffice.</span>
          </div>
          <div>
            <strong>Clean handoff</strong>
            <span>Purchase creates a bind request for issuance and policy documents.</span>
          </div>
        </section>

        {frontStep === "questions" && (
        <section className="frontQuoteLayout singlePageFlow">
          <form
            className="frontPanel quoteQuestionnaire"
            onSubmit={(event: { preventDefault: () => void }) => {
              event.preventDefault();
              submitQuote();
            }}
          >
            <div className="panelHeader">
              <h2>Tell us about your business</h2>
              <span>Step 1</span>
            </div>
            <div className="questionGrid">
              <label className="questionField">
                <span>What is your photography business called?</span>
                <input value={form.businessName} onChange={(event: { target: { value: string } }) => updateField("businessName", event.target.value)} />
              </label>
              <label className="questionField">
                <span>Where should we send quote updates?</span>
                <input value={form.email} onChange={(event: { target: { value: string } }) => updateField("email", event.target.value)} />
              </label>
              <label className="questionField">
                <span>What state is your business based in?</span>
                <select value={form.state} onChange={(event: { target: { value: string } }) => updateField("state", event.target.value)}>
                  {["MA", "CT", "RI", "NH", "NY", "VT"].map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </label>
              <label className="questionField">
                <span>About how much annual revenue do you expect?</span>
                <div className="moneyInput">
                  <span>$</span>
                  <input inputMode="numeric" value={formatMoneyInput(form.annualRevenue)} onChange={(event: { target: { value: string } }) => updateField("annualRevenue", digitsOnly(event.target.value))} />
                </div>
              </label>
              <label className="questionField">
                <span>How many years have you been in business?</span>
                <input min="0" type="number" value={form.yearsInBusiness} onChange={(event: { target: { value: string } }) => updateField("yearsInBusiness", event.target.value)} />
              </label>
              <label className="questionField">
                <span>How many claims have you had in the last 3 years?</span>
                <input min="0" type="number" value={form.priorClaimsCount} onChange={(event: { target: { value: string } }) => updateField("priorClaimsCount", event.target.value)} />
              </label>
              <label className="questionField">
                <span>What kind of photography do you do most?</span>
                <select value={form.classCode} onChange={(event: { target: { value: string } }) => updateField("classCode", event.target.value)}>
                  <option value="PHOTO-PORTRAIT">Portrait</option>
                  <option value="PHOTO-WEDDING">Wedding and events</option>
                  <option value="PHOTO-STUDIO">Studio</option>
                  <option value="PHOTO-DRONE">Drone photography</option>
                </select>
              </label>
              <label className="questionField">
                <span>How much of your work is at events?</span>
                <select value={form.eventWorkPercent} onChange={(event: { target: { value: string } }) => updateField("eventWorkPercent", event.target.value)}>
                  {["0", "25", "50", "75", "100"].map((percent) => (
                    <option key={percent} value={percent}>{percent}%</option>
                  ))}
                </select>
              </label>
              <label className="questionField">
                <span>When should coverage start?</span>
                <input type="date" value={form.effectiveDate} onChange={(event: { target: { value: string } }) => updateField("effectiveDate", event.target.value)} />
              </label>
            </div>

            <div className="riskToggleGrid">
              <label>
                <input checked={form.usesDrones} type="checkbox" onChange={(event: { target: { checked: boolean } }) => updateField("usesDrones", event.target.checked)} />
                I use drones for paid shoots
              </label>
              <label>
                <input checked={form.pyrotechnics} type="checkbox" onChange={(event: { target: { checked: boolean } }) => updateField("pyrotechnics", event.target.checked)} />
                I work around pyrotechnics or flame effects
              </label>
            </div>

            <button
              className="primaryButton"
              type="submit"
            >
              Submit and get quote
              <ArrowRight size={18} />
            </button>
          </form>
        </section>
        )}

        {frontStep === "loading" && (
          <section className="frontLoadingPage">
            <div className="loadingCard">
              <div className="loadingLens">
                <Camera size={30} />
              </div>
              <p>Building your quote</p>
              <h2>Checking appetite, rating factors, and bind eligibility</h2>
              <div className="loadingSteps">
                <span>Verifying state availability</span>
                <span>Reviewing claims and business exposures</span>
                <span>Calculating Basic, Standard, and Premium options</span>
              </div>
            </div>
          </section>
        )}

        {frontStep === "quotes" && (
          <section className="frontResultPage">
          <div className="frontPanel quoteResultPanel resultHeroPanel">
            <div className="panelHeader">
              <h2>Your quote results</h2>
              <span>Step 2</span>
            </div>

            {declineTriggers.length > 0 ? (
              <div className="ruleList">
                {declineTriggers.map((trigger) => (
                  <div className="ruleItem decline" key={trigger.code}>
                    <AlertTriangle size={18} />
                    <span>
                      <strong>{trigger.code}</strong>
                      <small>{trigger.label}</small>
                    </span>
                    <b>decline</b>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="frontStatus">
                  {referTriggers.length > 0 ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
                  <strong>{referTriggers.length > 0 ? "Quote available with underwriter review" : "Eligible for instant quote"}</strong>
                  <span>
                    {referTriggers.length > 0
                      ? referTriggers.map((trigger) => trigger.code).join(", ")
                      : "No referral or decline rules triggered."}
                  </span>
                </div>
                <div className="frontQuoteOptions">
                  {quote.options.map((option) => (
                    <button
                      className={selectedOption.id === option.id ? "selected" : ""}
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedOptionId(option.id)}
                    >
                      <span>{option.tier}</span>
                      <strong>{dollars(option.breakdown.totalDue)}</strong>
                      <small>{option.limit} / {dollars(option.deductible)} deductible</small>
                    </button>
                  ))}
                </div>
                <div className="frontPageActions">
                  <button className="secondaryButton" type="button" onClick={() => setFrontStep("questions")}>Edit answers</button>
                  <button className="primaryButton" type="button" onClick={() => setFrontStep("bind")}>
                    Continue to purchase
                    <ArrowRight size={18} />
                  </button>
                </div>
              </>
            )}
          </div>
          </section>
        )}

        {frontStep === "bind" && (
          <section className="frontResultPage">
          <div className="frontPanel bindPanel">
            <div className="panelHeader">
              <h2>Purchase and bind</h2>
              <span>Step 3</span>
            </div>
            {declineTriggers.length > 0 ? (
              <div className="frontStatus muted">
                <LockKeyhole size={22} />
                <strong>Bind unavailable</strong>
                <span>Submit an eligible quote before purchase.</span>
              </div>
            ) : bindRequested ? (
              <div className="frontStatus">
                <ShieldCheck size={22} />
                <strong>Bind request received</strong>
                <span>Policy issuance and declaration documents are queued for the backoffice.</span>
              </div>
            ) : (
              <>
                <div className="bindSummary">
                  <span>Selected option</span>
                  <strong>{selectedOption.tier} / {dollars(selectedOption.breakdown.totalDue)}</strong>
                  <small>{publicSubmission.effectiveDate} effective date</small>
                </div>
                <label className="questionField">
                  <span>Signature name</span>
                  <input value={form.signatureName} onChange={(event: { target: { value: string } }) => updateField("signatureName", event.target.value)} />
                </label>
                <label className="questionField">
                  <span>Payment intent</span>
                  <select value={form.paymentIntent} onChange={(event: { target: { value: string } }) => updateField("paymentIntent", event.target.value)}>
                    <option value="card">Card ending later</option>
                    <option value="ach">ACH authorization</option>
                    <option value="invoice">Invoice me</option>
                  </select>
                </label>
                <button
                  className="primaryButton"
                  disabled={form.signatureName.trim().length === 0}
                  type="button"
                  onClick={() => {
                    onSubmissionChange({ ...publicSubmission, status: quotedStatus, selectedQuoteOptionId: selectedOption.id });
                    onBindRequest(publicSubmission.id, selectedOption.id);
                    setBindRequested(true);
                  }}
                >
                  Purchase and request bind
                  <LockKeyhole size={18} />
                </button>
                <button className="secondaryButton" type="button" onClick={() => setFrontStep("quotes")}>Back to quote options</button>
              </>
            )}
          </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Topbar({
  selectedSubmission,
  setSelectedSubmissionId,
  submissions
}: {
  selectedSubmission: Submission;
  setSelectedSubmissionId: (id: string) => void;
  submissions: Submission[];
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
  role,
  setView,
  setSelectedSubmissionId,
  submissions
}: {
  role: Role;
  setView: (view: View) => void;
  setSelectedSubmissionId: (id: string) => void;
  submissions: Submission[];
}) {
  const funnel = ["draft", "submitted", "quoted", "referred", "bound", "issued"].map((status) => ({
    label: labelize(status),
    value: submissions.filter((submission) => submission.status === status).length
  }));
  const openCount = submissions.filter((submission) => !["issued", "cancelled", "declined", "ineligible"].includes(submission.status)).length;
  const referralRate = Math.round((submissions.filter((submission) => submission.status === "referred").length / submissions.length) * 100);
  const quoteToBind = Math.round((policies.length / quotes.length) * 100);
  const averagePremium = Math.round(submissions.reduce((sum, submission) => sum + rateSubmission(submission).totalDue, 0) / submissions.length);

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>{labelize(role)} workspace</p>
          <h2>Submission intake, quoting, bind, and issuance</h2>
        </div>
        <button className="primaryButton" disabled={role === "underwriter"} onClick={() => setView("submission")}>
          <ClipboardList size={18} />
          New submission
        </button>
      </section>

      <section className="metricGrid">
        <Metric label="Open submissions" value={`${openCount}`} trend="Current book" />
        <Metric label="Referral rate" value={`${referralRate}%`} trend="Current book" />
        <Metric label="Quote-to-bind" value={`${quoteToBind}%`} trend="Current book" />
        <Metric label="Avg premium" value={dollars(averagePremium)} trend="Current book" />
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

function SubmissionWizard({ role, submission }: { role: Role; submission: Submission }) {
  const triggers = evaluateEligibility(submission);
  const quote = buildQuote(submission);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>New submission wizard</p>
          <h2>{submission.business.name}</h2>
        </div>
        <button className="secondaryButton" disabled={role === "underwriter" || role === "admin"} onClick={() => setSubmitted(true)}>
          {submitted ? <Check size={18} /> : <ArrowRight size={18} />}
          {submitted ? "Submitted" : "Submit risk"}
        </button>
      </section>

      {submitted && (
        <div className="actionNotice">
          <ShieldCheck size={18} />
          Submission moved through eligibility and quote preview using {submission.ruleVersion}.
        </div>
      )}

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
  onBindRequest,
  role,
  submission,
  quote,
  selectedOptionId,
  setSelectedOptionId
}: {
  onBindRequest: (optionId: string) => void;
  role: Role;
  submission: Submission;
  quote: ReturnType<typeof buildQuote>;
  selectedOptionId: string;
  setSelectedOptionId: (id: string) => void;
}) {
  const [bindRequested, setBindRequested] = useState(false);
  const selectedOption = quote.options.find((option) => option.id === selectedOptionId) ?? quote.options[0];

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Quote comparison</p>
          <h2>{submission.business.name}</h2>
        </div>
        <button
          className="primaryButton"
          disabled={role === "underwriter" || role === "admin" || role === "applicant"}
          onClick={() => {
            onBindRequest(selectedOption.id);
            setBindRequested(true);
          }}
        >
          <LockKeyhole size={18} />
          {bindRequested ? "Bind requested" : "Request bind"}
        </button>
      </section>

      {bindRequested && (
        <div className="actionNotice">
          <LockKeyhole size={18} />
          Bind request queued for {selectedOption.tier} at {dollars(selectedOption.breakdown.totalDue)}.
        </div>
      )}

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

function UnderwritingQueue({ role }: { role: Role }) {
  const [showAuthorityMatrix, setShowAuthorityMatrix] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "declined">>({});

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Underwriter queue</p>
          <h2>Referrals awaiting review</h2>
        </div>
        <button className="secondaryButton" onClick={() => setShowAuthorityMatrix((visible) => !visible)}>
          <GitBranch size={18} />
          {showAuthorityMatrix ? "Hide matrix" : "Authority matrix"}
        </button>
      </section>

      {showAuthorityMatrix && (
        <section className="panel authorityMatrix">
          <div>
            <strong>Automatic quote authority</strong>
            <span>Supported states, revenue under $2M, fewer than 2 claims, no drone referral, no prohibited pyrotechnics.</span>
          </div>
          <div>
            <strong>Underwriter approval</strong>
            <span>Drones, 2+ claims, or revenue above auto authority can be approved with notes and terms.</span>
          </div>
          <div>
            <strong>Mandatory decline</strong>
            <span>Unsupported state or pyrotechnics exposure cannot be overridden by agents.</span>
          </div>
        </section>
      )}

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
                {decisions[referral.id] ? (
                  <div className={`decisionBadge ${decisions[referral.id]}`}>
                    {labelize(decisions[referral.id])}
                  </div>
                ) : (
                  <>
                    <button className="secondaryButton" disabled={role !== "underwriter"} onClick={() => setDecisions((current) => ({ ...current, [referral.id]: "declined" }))}>Decline</button>
                    <button className="primaryButton" disabled={role !== "underwriter"} onClick={() => setDecisions((current) => ({ ...current, [referral.id]: "approved" }))}>Approve with terms</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function PolicyDetail({ documents, policies }: { documents: DocumentRecord[]; policies: Policy[] }) {
  const policy = policies[0];
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const quoteOption = policy.snapshot.quoteOption;
  const insuredState = policy.snapshot.submission.business.state;
  const isDeclaration = selectedDocument === "Declaration page";

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Policy detail</p>
          <h2>{policy.policyNumber}</h2>
        </div>
        <button className="primaryButton" onClick={() => setSelectedDocument("Declaration page")}>
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
            <button className="documentRow" key={document} onClick={() => setSelectedDocument(document)}>
              <FileText size={18} />
              <span>{document}</span>
              <b>{documents.some((item) => item.policyId === policy.id) ? "Generated" : "Queued"}</b>
            </button>
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

      {selectedDocument && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={`${selectedDocument} preview`}>
          <div className="declarationModal">
            <div className="modalHeader">
              <div>
                <p>{selectedDocument}</p>
                <h2>{isDeclaration ? policy.policyNumber : policy.insured}</h2>
              </div>
              <button className="secondaryButton" onClick={() => setSelectedDocument(null)}>Close</button>
            </div>

            <section className="declarationSheet">
              <div className="declarationTitle">
                <div className="brandMark">PB</div>
                <div>
                  <strong>PhotoBind Commercial General Liability</strong>
                  <span>{isDeclaration ? "Declarations / Evidence of insurance" : "Generated policy document preview"}</span>
                </div>
              </div>

              {isDeclaration ? (
                <>
              <div className="declarationGrid">
                <div>
                  <span>Named insured</span>
                  <strong>{policy.insured}</strong>
                </div>
                <div>
                  <span>Policy number</span>
                  <strong>{policy.policyNumber}</strong>
                </div>
                <div>
                  <span>Policy period</span>
                  <strong>{policy.effectiveDate} to {policy.expirationDate}</strong>
                </div>
                <div>
                  <span>Rating state</span>
                  <strong>{insuredState}</strong>
                </div>
                <div>
                  <span>Coverage package</span>
                  <strong>{quoteOption.tier}</strong>
                </div>
                <div>
                  <span>Occurrence limit</span>
                  <strong>{quoteOption.limit}</strong>
                </div>
                <div>
                  <span>Deductible</span>
                  <strong>{dollars(quoteOption.deductible)}</strong>
                </div>
                <div>
                  <span>Total due</span>
                  <strong>{dollars(policy.premium)}</strong>
                </div>
              </div>

              <div className="declarationSection">
                <h3>Included coverages</h3>
                {quoteOption.endorsements.map((endorsement) => (
                  <p key={endorsement}>
                    <Check size={16} />
                    {endorsement}
                  </p>
                ))}
              </div>

              <div className="declarationSection">
                <h3>Rating snapshot</h3>
                <p>Rated using {policy.snapshot.ratingVersion} and underwriting rules {policy.snapshot.ruleVersion}.</p>
                <p>Issued at {new Date(policy.snapshot.issuedAt).toLocaleString("en-US")} from immutable bind snapshot.</p>
              </div>
                </>
              ) : (
                <div className="declarationSection documentPreview">
                  <h3>{selectedDocument}</h3>
                  <p>
                    <Check size={16} />
                    Generated for {policy.insured} under policy {policy.policyNumber}.
                  </p>
                  <p>
                    <Check size={16} />
                    Term: {policy.effectiveDate} to {policy.expirationDate}.
                  </p>
                  <p>
                    <Check size={16} />
                    Stored against the immutable policy snapshot for audit review.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminEditor({
  auditEvents,
  role,
  webhookEvents
}: {
  auditEvents: { action: string; detail: string; id: string }[];
  role: Role;
  webhookEvents: { id: string; payload: string; status: string; type: string }[];
}) {
  const [published, setPublished] = useState(false);
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
        <button className="primaryButton" disabled={role !== "admin"} onClick={() => setPublished(true)}>
          <Settings size={18} />
          {published ? "Published" : "Publish version"}
        </button>
      </section>

      {published && (
        <div className="actionNotice">
          <Settings size={18} />
          Rating table RT-2026.05.01 and underwriting rules UW-2026.05-v3 are published for new quotes.
        </div>
      )}

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

      <section className="panel">
        <div className="panelHeader">
          <h3>API Surface</h3>
          <span>{apiEndpoints.length} endpoints</span>
        </div>
        <div className="apiGrid">
          {apiEndpoints.map((endpoint) => (
            <code key={endpoint}>{endpoint}</code>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h3>Persisted Audit Events</h3>
          <span>{auditEvents.length} events</span>
        </div>
        <div className="auditEventTable">
          {auditEvents.slice(0, 6).map((event) => (
            <div key={event.id}>
              <strong>{event.action}</strong>
              <span>{event.detail}</span>
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

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatMoneyInput(value: string) {
  const numericValue = Number(digitsOnly(value));
  return numericValue ? numericValue.toLocaleString("en-US") : "";
}
