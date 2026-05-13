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
import { auditEvents, policies, referrals, submissions, webhookEvents } from "./data";
import { Policy, Quote, Role, Submission, US_STATES, buildQuote, canTransition, dollars, evaluateEligibility, rateSubmission, underwritingRules } from "./domain";
import {
  DocumentRecord,
  PlatformState,
  apiBase,
  apiEndpoints,
  approveReferralApi,
  bindRenewalQuoteApi,
  createAndQuoteSubmission,
  createEndorsementApi,
  createRenewalApi,
  createSession,
  declineReferralApi,
  fetchPlatformState,
  fetchRatingTable,
  issueEndorsementApi,
  requestBindApi,
  saveRatingFactor,
  saveProductParameter
} from "./platform";

type View = "dashboard" | "submission" | "quotes" | "underwriting" | "policy" | "renewals" | "admin" | "analytics";
type Workspace = "frontoffice" | "backoffice";

const navItems: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "submission", label: "Submission", icon: ClipboardList },
  { view: "quotes", label: "Quotes", icon: SlidersHorizontal },
  { view: "underwriting", label: "Underwriting", icon: UserCheck },
  { view: "policy", label: "Policy", icon: FileBadge },
  { view: "renewals", label: "Renewals", icon: GitBranch },
  { view: "admin", label: "Admin", icon: Settings },
  { view: "analytics", label: "Analytics", icon: BarChart3 }
];

const roleCapabilities: Record<Role, string> = {
  agent: "Create submissions, compare quotes, request bind.",
  underwriter: "Review referrals, approve/decline, adjust terms.",
  admin: "Configure rates, rules, appetite, and forms.",
  applicant: "Use the public quote flow with internal actions hidden."
};

function latestRailsQuote(submission: Submission): Quote | undefined {
  return submission.quotes?.slice(-1)[0];
}

function quoteForSubmission(submission: Submission): Quote {
  return latestRailsQuote(submission) ?? buildQuote(submission);
}

function premiumForSubmission(submission: Submission) {
  return latestRailsQuote(submission)?.options[1]?.breakdown.totalDue ??
    latestRailsQuote(submission)?.options[0]?.breakdown.totalDue ??
    rateSubmission(submission).totalDue;
}

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
    idempotencyLedger: {},
    renewalWorkItems: { expiringPolicies: [], renewalSubmissions: [] }
  };
}

function loadPlatformState() {
  return initialPlatformState();
}

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [role, setRole] = useState<Role>("agent");
  const [workspace, setWorkspace] = useState<Workspace>("backoffice");
  const [platformState, setPlatformState] = useState<PlatformState>(loadPlatformState());
  const [apiToken, setApiToken] = useState("");
  const [apiStatus, setApiStatus] = useState("Connecting Rails API...");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("SUB-1007");
  const [selectedQuoteOptionId, setSelectedQuoteOptionId] = useState("SUB-1007-OPT-2");
  const allSubmissions = platformState.submissions;
  const selectedSubmission = allSubmissions.find((submission) => submission.id === selectedSubmissionId) ?? allSubmissions[0];
  const selectedQuote = useMemo(() => quoteForSubmission(selectedSubmission), [selectedSubmission]);
  const selectedOption = selectedQuote.options.find((option) => option.id === selectedQuoteOptionId) ?? selectedQuote.options[1];

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const session = await createSession(role);
        if (cancelled) return;
        setApiToken(session.token);
        const nextState = await fetchPlatformState(session.token);
        if (cancelled) return;
        if (nextState.submissions.length > 0) {
          setPlatformState(nextState);
          setSelectedSubmissionId(nextState.submissions[0].id);
          setSelectedQuoteOptionId(latestRailsQuote(nextState.submissions[0])?.options[1]?.id ?? latestRailsQuote(nextState.submissions[0])?.options[0]?.id ?? `${nextState.submissions[0].id}-OPT-2`);
        }
        setApiStatus(`Rails API connected as ${session.user.role}`);
      } catch (error) {
        setApiStatus(`Rails API unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function refreshFromRails(token = apiToken) {
    if (!token) return;
    const nextState = await fetchPlatformState(token);
    if (nextState.submissions.length > 0) {
      setPlatformState(nextState);
      setSelectedSubmissionId((current) => {
        const selected = nextState.submissions.find((item) => item.id === current) ?? nextState.submissions[0];
        setSelectedQuoteOptionId(latestRailsQuote(selected)?.options[1]?.id ?? latestRailsQuote(selected)?.options[0]?.id ?? `${selected.id}-OPT-2`);
        return selected.id;
      });
    }
  }

  async function upsertApplicantSubmission(submission: Submission) {
    if (!apiToken) {
      throw new Error("Rails API is required for customer quotes");
    }
    try {
      const created = await createAndQuoteSubmission(submission, apiToken);
      await refreshFromRails();
      setSelectedSubmissionId(created.id);
      setApiStatus("Rails API saved and quoted applicant submission");
      return created;
    } catch (error) {
      setApiStatus(`Rails API submission failed: ${error instanceof Error ? error.message : "unknown error"}`);
      throw error;
    }
  }

  async function requestBind(submissionId: string, optionId: string, actor: string, submissionOverride?: Submission) {
    const submission = submissionOverride ?? platformState.submissions.find((item) => item.id === submissionId);
    if (apiToken && submission) {
      try {
        await requestBindApi(submission, optionId, apiToken, actor.toLowerCase());
        await refreshFromRails();
        setApiStatus("Rails API accepted bind request and queued document generation");
        return;
      } catch (error) {
        setApiStatus(`Rails API bind failed: ${error instanceof Error ? error.message : "unknown error"}`);
        throw error;
      }
    }
    throw new Error(`Rails API is required to bind ${submissionId} as ${actor}`);
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
        onBindRequest={(submissionId, optionId, submission) => requestBind(submissionId, optionId, "Applicant", submission)}
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
        {view === "dashboard" && <Dashboard policyCount={platformState.policies.length} role={role} setView={setView} setSelectedSubmissionId={setSelectedSubmissionId} submissions={allSubmissions} />}
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
        {view === "underwriting" && <UnderwritingQueue onChanged={refreshFromRails} role={role} token={apiToken} />}
        {view === "policy" && <PolicyDetail documents={platformState.documents} onChanged={refreshFromRails} policies={platformState.policies} token={apiToken} />}
        {view === "renewals" && <RenewalWorkbench onChanged={refreshFromRails} renewalWorkItems={platformState.renewalWorkItems} token={apiToken} />}
        {view === "admin" && <AdminEditor auditEvents={platformState.auditEvents} role={role} token={apiToken} webhookEvents={platformState.webhookEvents} onChanged={refreshFromRails} />}
        {view === "analytics" && <Analytics policyCount={platformState.policies.length} renewalWorkItems={platformState.renewalWorkItems} submissions={allSubmissions} />}
      </main>

      <aside className="rightRail">
        <section className="railSection">
          <h2>Lifecycle</h2>
          <Lifecycle status={selectedSubmission.status} />
        </section>

        <section className="railSection">
          <h2>Selected Option</h2>
          <small>{apiStatus}</small>
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
  onBindRequest: (submissionId: string, optionId: string, submission?: Submission) => void | Promise<void>;
  onBackoffice: () => void;
  onRoleChange: (role: Role) => void;
  onSubmissionChange: (submission: Submission) => Submission | void | Promise<Submission | void>;
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
  const [frontSubmission, setFrontSubmission] = useState<Submission | null>(null);
  const [frontQuote, setFrontQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [bindRequested, setBindRequested] = useState(false);

  const publicSubmission: Submission = {
    id: "PUBLIC-DRAFT",
    agency: "Direct",
    producer: "Applicant portal",
    status: "draft",
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
    createdAt: new Date().toISOString(),
    ruleVersion: "",
    ratingVersion: ""
  };
  const quoteOptions = frontQuote?.options ?? [];
  const selectedOption = quoteOptions.find((option) => option.id === selectedOptionId) ?? quoteOptions[1] ?? quoteOptions[0];
  const isDeclined = frontSubmission?.status === "ineligible";
  const isReferred = frontSubmission?.status === "referred" || frontQuote?.status === "referred";
  const isBindable = Boolean(frontSubmission && frontQuote && selectedOption && !isDeclined && !isReferred);
  const selectedOptionIndex = quoteOptions.findIndex((option) => option.id === selectedOption?.id);
  const quoteHighlights: Record<string, string[]> = {
    Basic: ["Good for lower-volume studio work", "Certificates when a client asks", "$2,500 deductible"],
    Standard: ["Built for event and location work", "Equipment-related protection", "Balanced deductible"],
    Premium: ["Higher limit for larger jobs", "Extra flexibility for venues", "Support for shoots away from home"]
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (frontStep !== "questions") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [frontStep]);

  function scrollToQuestions() {
    setFrontStep("questions");
    window.requestAnimationFrame(() => {
      document.getElementById("front-questions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function updateField(name: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
    if (name !== "signatureName" && name !== "paymentIntent") {
      setFrontStep("questions");
      setBindRequested(false);
      setFrontSubmission(null);
      setFrontQuote(null);
      setSelectedOptionId("");
      setQuoteError("");
    }
  }

  async function submitQuote() {
    setFrontStep("loading");
    setBindRequested(false);
    setQuoteError("");
    setFrontSubmission(null);
    setFrontQuote(null);
    const delay = new Promise((resolve) => window.setTimeout(resolve, 5000));
    try {
      const [created] = await Promise.all([onSubmissionChange(publicSubmission), delay]);
      const saved = created ?? null;
      const savedQuote = saved?.quotes?.slice(-1)[0] ?? null;
      setFrontSubmission(saved);
      setFrontQuote(savedQuote);
      setSelectedOptionId(savedQuote?.options[1]?.id ?? savedQuote?.options[0]?.id ?? "");
    } catch (error) {
      await delay;
      setQuoteError(error instanceof Error ? error.message : "Quote request failed");
    } finally {
      setFrontStep("quotes");
    }
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
          <button className="secondaryButton" type="button" onClick={onBackoffice}>Agent workspace</button>
        </div>
      </header>

      <main className="frontofficeMain">
        <section className="frontHero">
          <div className="frontHeroCopy">
            <p>Photographer general liability</p>
            <h1>Coverage for photographers who work on location, in studio, and at events</h1>
            <span>Tell us how you work, compare clear coverage options, and choose a plan that helps protect your business.</span>
            <div className="frontHeroActions">
              <button className="primaryButton" type="button" onClick={scrollToQuestions}>
                Start quote
                <ArrowRight size={18} />
              </button>
              <button className="secondaryButton" type="button" onClick={onBackoffice}>Agent workspace</button>
            </div>
            <div className="frontHeroMetrics">
              <div>
                <strong>50</strong>
                <span>states screened</span>
              </div>
              <div>
                <strong>3</strong>
                <span>quote packages</span>
              </div>
              <div>
                <strong>Today</strong>
                <span>prices returned live</span>
              </div>
            </div>
          </div>
          <div className="frontHeroGuide" aria-label="What PhotoBind helps with">
            <div className="frontGuidePhoto" />
            <div className="frontGuideCard">
              <p>What you can sort out here</p>
              <h2>Coverage that helps when clients, venues, or contracts ask for proof of insurance.</h2>
              <div className="frontGuideList">
                <span><Check size={16} /> Compare three coverage levels</span>
                <span><Check size={16} /> See your estimated annual cost</span>
                <span><Check size={16} /> Choose a start date for coverage</span>
                <span><Check size={16} /> Save your selection for purchase</span>
              </div>
            </div>
          </div>
        </section>

        <section className="frontCoverageStory" aria-label="Coverage for different photography work">
          <div className="coverageTile studio">
            <strong>Studio shoots</strong>
            <span>For portrait sessions, rented studio time, and clients visiting your workspace.</span>
          </div>
          <div className="coverageTile event">
            <strong>Events and venues</strong>
            <span>For weddings, school shoots, and venues that ask for certificates before the day starts.</span>
          </div>
          <div className="coverageTile location">
            <strong>On-location work</strong>
            <span>For client sites, parks, rentals, and the places your camera takes you.</span>
          </div>
        </section>

        <section className="frontProgress">
          {[
            ["questions", "Questions"],
            ["quotes", "Compare options"],
            ["bind", "Checkout"]
          ].map(([step, label], index) => (
            <div className={frontStep === step || (frontStep === "loading" && step === "quotes") ? "active" : ""} key={step}>
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </section>

        <section className="frontTrustStrip">
          <div>
            <strong>Know where you stand</strong>
            <span>We check the details that can affect whether coverage is available.</span>
          </div>
          <div>
            <strong>Choose your fit</strong>
            <span>Compare Basic, Standard, and Premium without decoding insurance jargon.</span>
          </div>
          <div>
            <strong>Be ready for clients</strong>
            <span>Get coverage details you can use when a venue or client asks.</span>
          </div>
        </section>

        {frontStep === "questions" && (
        <section className="frontQuoteLayout frontQuestionStage" id="front-questions">
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
                  {US_STATES.map((state) => (
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
              <h2>Finding coverage options that fit your photography business</h2>
              <div className="loadingSteps">
                <span>Checking where your business is based</span>
                <span>Reviewing your work and claims history</span>
                <span>Preparing Basic, Standard, and Premium prices</span>
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

            {quoteError ? (
              <div className="frontStatus muted">
                <AlertTriangle size={22} />
                <strong>Quote request did not complete</strong>
                <span>{quoteError}</span>
              </div>
            ) : isDeclined ? (
              <div className="frontStatus muted">
                <AlertTriangle size={22} />
                <strong>We cannot offer coverage online</strong>
                <span>Based on your answers, this business needs a different coverage path than the one offered here.</span>
              </div>
            ) : (
              <>
                <div className="frontStatus">
                  {isReferred ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
                  <strong>{isReferred ? "This needs a closer look" : "Your options are ready"}</strong>
                  <span>
                    {isReferred
                      ? "Some details need review before you can purchase online. We saved your answers so the next step is easy."
                      : "Choose the package that matches how much protection you want for your work."}
                  </span>
                </div>
                <div className="frontQuoteOptions">
                  {quoteOptions.map((option, index) => (
                    <button
                      className={selectedOption?.id === option.id ? "selected" : ""}
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedOptionId(option.id)}
                    >
                      <span>{option.tier}</span>
                      {index === 1 && <b>Most selected</b>}
                      <strong>{dollars(option.breakdown.totalDue)}</strong>
                      <small>{option.limit} / {dollars(option.deductible)} deductible</small>
                      <em>
                        {(quoteHighlights[option.tier] ?? []).map((highlight) => (
                          <i key={highlight}>{highlight}</i>
                        ))}
                      </em>
                    </button>
                  ))}
                </div>
                {selectedOption && (
                  <div className="quoteDetailStrip">
                    <div>
                      <span>Selected package</span>
                      <strong>{selectedOption.tier}</strong>
                    </div>
                    <div>
                      <span>Annual due</span>
                      <strong>{dollars(selectedOption.breakdown.totalDue)}</strong>
                    </div>
                    <div>
                      <span>Package position</span>
                      <strong>Option {selectedOptionIndex + 1} of {quoteOptions.length}</strong>
                    </div>
                  </div>
                )}
                <div className="frontPageActions">
                  <button className="secondaryButton" type="button" onClick={() => setFrontStep("questions")}>Edit answers</button>
                  <button className="primaryButton" disabled={!isBindable} type="button" onClick={() => setFrontStep("bind")}>
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
              <h2>Review and purchase</h2>
              <span>Step 3</span>
            </div>
            {!isBindable || !frontSubmission || !selectedOption ? (
              <div className="frontStatus muted">
                <LockKeyhole size={22} />
                <strong>Purchase is not available yet</strong>
                <span>{isReferred ? "A coverage specialist needs to review this before you can continue." : "Get an eligible quote before checkout."}</span>
              </div>
            ) : bindRequested ? (
              <div className="frontStatus">
                <ShieldCheck size={22} />
                <strong>Your purchase request is in</strong>
                <span>We received your selection and are preparing your coverage documents.</span>
              </div>
            ) : (
              <>
                <div className="bindSummary">
                  <span>Selected option</span>
                  <strong>{selectedOption.tier} / {dollars(selectedOption.breakdown.totalDue)}</strong>
                  <small>{frontSubmission.effectiveDate} effective date</small>
                </div>
                <div className="bindChecklist">
                  <p><Check size={16} /> Your selected package is saved</p>
                  <p><Check size={16} /> Your payment preference is recorded</p>
                  <p><Check size={16} /> Coverage documents will be prepared after purchase</p>
                </div>
                <label className="questionField">
                  <span>Signature name</span>
                  <input value={form.signatureName} onChange={(event: { target: { value: string } }) => updateField("signatureName", event.target.value)} />
                </label>
                <label className="questionField">
                  <span>How would you like to pay?</span>
                  <select value={form.paymentIntent} onChange={(event: { target: { value: string } }) => updateField("paymentIntent", event.target.value)}>
                    <option value="card">Card</option>
                    <option value="ach">ACH authorization</option>
                    <option value="invoice">Invoice</option>
                  </select>
                </label>
                <button
                  className="primaryButton"
                  disabled={form.signatureName.trim().length === 0}
                  type="button"
                  onClick={() => {
                    void Promise.resolve(onBindRequest(frontSubmission.id, selectedOption.id, frontSubmission))
                      .then(() => setBindRequested(true))
                      .catch((error: unknown) => setQuoteError(error instanceof Error ? error.message : "Purchase request failed"));
                  }}
                >
                  Request purchase
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
  policyCount,
  setView,
  setSelectedSubmissionId,
  submissions
}: {
  policyCount: number;
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
  const quoteToBind = Math.round((policyCount / Math.max(submissions.length, 1)) * 100);
  const averagePremium = Math.round(submissions.reduce((sum, submission) => sum + premiumForSubmission(submission), 0) / submissions.length);

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
                <b>{dollars(premiumForSubmission(submission))}</b>
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
  const quote = quoteForSubmission(submission);
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
  onBindRequest: (optionId: string) => void | Promise<void>;
  role: Role;
  submission: Submission;
  quote: Quote;
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
            void onBindRequest(selectedOption.id);
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

function UnderwritingQueue({ onChanged, role, token }: { onChanged: () => void | Promise<void>; role: Role; token: string }) {
  const [showAuthorityMatrix, setShowAuthorityMatrix] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "declined">>({});
  const [serverReferrals, setServerReferrals] = useState<any[]>([]);

  useEffect(() => {
    if (!token || role !== "underwriter") return;
    void fetch(`${apiBase}/api/underwriting/referrals`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => (response.ok ? response.json() : []))
      .then(setServerReferrals);
  }, [role, token, decisions]);

  const queueItems: Array<{
    id: string;
    submissionId: string;
    submission: any;
    triggers: Array<{ action: "decline" | "refer"; code: string; label: string }>;
    notes: string[];
    assignedTo: string;
  }> = serverReferrals.length
    ? serverReferrals.map((referral) => ({
        id: String(referral.id),
        submissionId: String(referral.submission_id),
        submission: referral.submission,
        triggers: (referral.triggered_rules ?? []).map((rule: any) => ({
          code: rule.code,
          label: rule.description,
          action: rule.action
        })),
        notes: referral.notes ? [referral.notes] : [],
        assignedTo: referral.assigned_to_id ? `User ${referral.assigned_to_id}` : "Unassigned"
      }))
    : referrals.map((referral) => ({
        ...referral,
        submission: submissions.find((item) => item.id === referral.submissionId)
      }));

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
        {queueItems.map((referral) => {
          const submission = referral.submission;
          return (
            <div className="referralCard" key={referral.id}>
              <div>
                <span>{referral.id}</span>
                <h3>{submission.business?.name ?? submission.business?.legal_name ?? "Referral"}</h3>
                <p>{submission.business?.annualRevenue ? dollars(submission.business.annualRevenue) : "Rails referral"} revenue / {submission.risk?.classCode ?? submission.risk?.class_code}</p>
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
                    <button
                      className="secondaryButton"
                      disabled={role !== "underwriter" || !token}
                      onClick={async () => {
                        await declineReferralApi(referral.id, token, "Declined in underwriting queue");
                        setDecisions((current) => ({ ...current, [referral.id]: "declined" }));
                        await onChanged();
                      }}
                    >
                      Decline
                    </button>
                    <button
                      className="primaryButton"
                      disabled={role !== "underwriter" || !token}
                      onClick={async () => {
                        await approveReferralApi(referral.id, token, "Approved with standard terms");
                        setDecisions((current) => ({ ...current, [referral.id]: "approved" }));
                        await onChanged();
                      }}
                    >
                      Approve with terms
                    </button>
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

function PolicyDetail({
  documents,
  onChanged,
  policies,
  token
}: {
  documents: DocumentRecord[];
  onChanged: () => void | Promise<void>;
  policies: Policy[];
  token: string;
}) {
  const policy = policies[0];
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [endorsementKind, setEndorsementKind] = useState<"revenue_change" | "limit_change" | "address_change">("revenue_change");
  const [endorsementRevenue, setEndorsementRevenue] = useState("850000");
  const [endorsementLimit, setEndorsementLimit] = useState("2000000");
  const [endorsementState, setEndorsementState] = useState("CT");
  const [quotedEndorsement, setQuotedEndorsement] = useState<any | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  if (!policy) {
    return (
      <div className="content">
        <section className="pageHeader">
          <div>
            <p>Policy detail</p>
            <h2>No issued policies yet</h2>
          </div>
        </section>
      </div>
    );
  }
  const quoteOption = policy.snapshot.quoteOption;
  const insuredState = policy.snapshot.submission.business.state;
  const isDeclaration = selectedDocument === "Declaration page";
  const policyEndorsements = ((policy as any).endorsements ?? []) as Array<{ id: string | number; change_type: string; premium_delta_cents: number; status: string }>;

  function endorsementChangeRequest(): Record<string, string | number> {
    if (endorsementKind === "limit_change") {
      return { change_type: endorsementKind, limit_cents: Number(endorsementLimit) * 100, effective_date: new Date().toISOString().slice(0, 10) };
    }
    if (endorsementKind === "address_change") {
      return { change_type: endorsementKind, state: endorsementState, line1: "Updated address", city: "Updated city", effective_date: new Date().toISOString().slice(0, 10) };
    }
    return { change_type: endorsementKind, annual_revenue_cents: Number(endorsementRevenue) * 100, effective_date: new Date().toISOString().slice(0, 10) };
  }

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

      {actionMessage && (
        <div className="actionNotice">
          <Sparkles size={18} />
          {actionMessage}
        </div>
      )}

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
            <span>{policyEndorsements.length} policy endorsements</span>
          </div>
          <div className="endorsementComposer">
            <label className="questionField">
              <span>Change type</span>
              <select value={endorsementKind} onChange={(event: { target: { value: "revenue_change" | "limit_change" | "address_change" } }) => setEndorsementKind(event.target.value)}>
                <option value="revenue_change">Revenue change</option>
                <option value="limit_change">Limit change</option>
                <option value="address_change">Address change</option>
              </select>
            </label>
            {endorsementKind === "limit_change" && (
              <label className="questionField">
                <span>New occurrence limit</span>
                <select value={endorsementLimit} onChange={(event: { target: { value: string } }) => setEndorsementLimit(event.target.value)}>
                  <option value="1000000">$1,000,000</option>
                  <option value="2000000">$2,000,000</option>
                </select>
              </label>
            )}
            {endorsementKind === "address_change" && (
              <label className="questionField">
                <span>New rating state</span>
                <select value={endorsementState} onChange={(event: { target: { value: string } }) => setEndorsementState(event.target.value)}>
                  {US_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
            )}
            {endorsementKind === "revenue_change" && (
            <label className="questionField">
              <span>New annual revenue</span>
              <input value={endorsementRevenue} onChange={(event: { target: { value: string } }) => setEndorsementRevenue(digitsOnly(event.target.value))} />
            </label>
            )}
            <button
              className="primaryButton"
              disabled={!token}
              type="button"
              onClick={async () => {
                const endorsement = await createEndorsementApi(policy.id, token, endorsementChangeRequest());
                setQuotedEndorsement(endorsement);
                setActionMessage(`Endorsement quoted with premium delta ${dollars(Math.round((endorsement.premium_delta_cents ?? 0) / 100))}. Review it before issue.`);
                await onChanged();
              }}
            >
              Quote endorsement
            </button>
            <button
              className="secondaryButton"
              disabled={!token || !quotedEndorsement}
              type="button"
              onClick={async () => {
                await issueEndorsementApi(policy.id, String(quotedEndorsement.id), token);
                setQuotedEndorsement(null);
                setActionMessage("Endorsement issued, document generation queued, and policy returned to issued status.");
                await onChanged();
              }}
            >
              Issue quoted endorsement
            </button>
            <button
              className="secondaryButton"
              disabled={!token}
              type="button"
              onClick={async () => {
                await createRenewalApi(policy.id, token);
                setActionMessage("Renewal quote hook created a renewal submission and quote.");
                await onChanged();
              }}
            >
              Create renewal quote
            </button>
          </div>
          {policyEndorsements.map((endorsement) => (
            <div className="documentRow" key={endorsement.id}>
              <Sparkles size={18} />
              <span>{labelize(endorsement.change_type)}</span>
              <b>{dollars(Math.round(endorsement.premium_delta_cents / 100))} / {endorsement.status}</b>
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

function RenewalWorkbench({
  onChanged,
  renewalWorkItems,
  token
}: {
  onChanged: () => void | Promise<void>;
  renewalWorkItems?: { expiringPolicies: any[]; renewalSubmissions: any[] };
  token: string;
}) {
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const expiringPolicies = renewalWorkItems?.expiringPolicies ?? [];
  const renewalSubmissions = renewalWorkItems?.renewalSubmissions ?? [];

  async function createRenewal(policyId: string) {
    setBusyKey(`create-${policyId}`);
    try {
      await createRenewalApi(policyId, token);
      setMessage("Renewal submission created, rated, and placed into the renewal quote queue.");
      await onChanged();
    } finally {
      setBusyKey("");
    }
  }

  async function bindRenewal(submission: any, option: any) {
    setBusyKey(`bind-${submission.id}`);
    try {
      await bindRenewalQuoteApi(String(submission.quotes?.[0]?.id), String(option.id), submission.effective_date, token);
      setMessage(`Renewal for ${submission.business?.legal_name} bound and queued for issuance documents.`);
      await onChanged();
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Renewal workbench</p>
          <h2>Expiring-policy queue, renewal quote review, and renewal bind</h2>
        </div>
      </section>

      {message && (
        <div className="actionNotice">
          <GitBranch size={18} />
          {message}
        </div>
      )}

      <section className="metricGrid">
        <Metric label="Expiring in 90 days" value={`${expiringPolicies.length}`} trend="Renewal queue" />
        <Metric label="Renewal quotes" value={`${renewalSubmissions.length}`} trend="Created from expiring policies" />
        <Metric label="Issued renewals" value={`${renewalSubmissions.filter((submission) => submission.stage === "issued").length}`} trend="Bound renewal terms" />
        <Metric label="Open renewal work" value={`${renewalSubmissions.filter((submission) => submission.stage !== "issued").length}`} trend="Needs bind decision" />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Expiring Policy Queue</h3>
            <span>{expiringPolicies.length} policies</span>
          </div>
          <div className="table">
            {expiringPolicies.map((policy) => (
              <div className="documentRow" key={policy.id}>
                <FileBadge size={18} />
                <span>
                  {policy.policy_number}
                  <small>{policy.submission?.business?.legal_name} / {policy.days_to_expiration} days left</small>
                </span>
                <b>{policy.renewal_status}</b>
                <button className="secondaryButton" disabled={!token || busyKey === `create-${policy.id}` || policy.renewal_status !== "not_started"} onClick={() => createRenewal(String(policy.id))}>
                  Create renewal
                </button>
              </div>
            ))}
            {!expiringPolicies.length && <p className="emptyText">No policies expire in the next 90 days.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h3>Renewal Quote Queue</h3>
            <span>{renewalSubmissions.length} quotes</span>
          </div>
          <div className="table">
            {renewalSubmissions.map((submission) => {
              const quote = submission.quotes?.[0];
              const options = quote?.quote_options ?? [];
              const selected = options.find((option: any) => option.tier === "Standard") ?? options[0];
              return (
                <div className="renewalCard" key={submission.id}>
                  <div>
                    <strong>{submission.business?.legal_name}</strong>
                    <span>Renewal of {submission.renewal_of} / effective {submission.effective_date}</span>
                    <small>{submission.narrative}</small>
                  </div>
                  <div className="quoteMiniGrid">
                    {options.map((option: any) => (
                      <span key={option.id}>
                        {option.tier}
                        <b>{dollars(Math.round((option.total_due_cents ?? 0) / 100))}</b>
                      </span>
                    ))}
                  </div>
                  <button className="primaryButton" disabled={!token || !selected || submission.stage === "issued" || busyKey === `bind-${submission.id}`} onClick={() => bindRenewal(submission, selected)}>
                    Bind renewal
                  </button>
                </div>
              );
            })}
            {!renewalSubmissions.length && <p className="emptyText">Create a renewal quote from an expiring policy to start the renewal bind workflow.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function AdminEditor({
  auditEvents,
  onChanged,
  role,
  token,
  webhookEvents
}: {
  auditEvents: { action: string; detail: string; id: string }[];
  onChanged: () => void | Promise<void>;
  role: Role;
  token: string;
  webhookEvents: { id: string; payload: string; status: string; type: string }[];
}) {
  const [published, setPublished] = useState(false);
  const [ratingRows, setRatingRows] = useState<Array<Record<string, string>>>([]);
  const [parameterRows, setParameterRows] = useState<Array<Record<string, string>>>([]);
  const [factorDraft, setFactorDraft] = useState({
    state: "MA",
    class_code: "PHOTO_GL",
    factor_type: "territory",
    band: "default",
    factor: "1.10"
  });
  const [parameterDraft, setParameterDraft] = useState({
    key: "financial.policy_fee",
    value: "75"
  });

  useEffect(() => {
    if (!token || role !== "admin") return;
    void fetchRatingTable(token).then((table) => {
      setRatingRows((table.factors ?? []).slice(0, 12).map((factor: any) => ({
        state: factor.state,
        class_code: factor.class_code,
        factor_type: factor.factor_type,
        band: factor.band,
        factor: String(factor.factor),
        active: factor.active ? "active" : "inactive"
      })));
      setParameterRows((table.product_parameters ?? []).slice(0, 12).map((parameter: any) => ({
        key: parameter.key,
        value: String(parameter.value),
        active: parameter.active ? "active" : "inactive"
      })));
    });
  }, [role, token, published]);

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Admin/Product manager</p>
          <h2>Rating tables, forms, appetite, and rule versions</h2>
        </div>
        <button
          className="primaryButton"
          disabled={role !== "admin" || !token}
          onClick={async () => {
            await saveRatingFactor(token, {
              version: "2026.05.01",
              state: factorDraft.state,
              class_code: factorDraft.class_code,
              factor_type: factorDraft.factor_type,
              band: factorDraft.band,
              factor: Number(factorDraft.factor),
              active: true
            });
            setPublished(true);
            await onChanged();
          }}
        >
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
          <div className="factorEditor">
            {(["state", "class_code", "factor_type", "band", "factor"] as const).map((field) => (
              <label className="questionField" key={field}>
                <span>{labelize(field)}</span>
                <input value={factorDraft[field]} onChange={(event: { target: { value: string } }) => setFactorDraft((current) => ({ ...current, [field]: event.target.value }))} />
              </label>
            ))}
          </div>
          <div className="factorTable">
            {(ratingRows.length ? ratingRows : [
              { state: "MA", class_code: "PHOTO_GL", factor_type: "territory", band: "default", factor: "1.10", active: "active" }
            ]).map((row) => (
              <div key={Object.values(row).join("-")}>
                <span>{row.state}</span>
                <span>{row.class_code}</span>
                <span>{row.factor_type}</span>
                <span>{row.band}</span>
                <span>{row.factor}</span>
                <span>{row.active}</span>
              </div>
            ))}
          </div>
          <div className="panelHeader compactHeader">
            <h3>Product Parameters</h3>
            <span>Fees, taxes, options</span>
          </div>
          <div className="factorEditor twoColumnEditor">
            <label className="questionField">
              <span>Parameter key</span>
              <select value={parameterDraft.key} onChange={(event: { target: { value: string } }) => setParameterDraft((current) => ({ ...current, key: event.target.value }))}>
                {[
                  "rating.base_rate",
                  "rating.claims_surcharge_per_claim",
                  "rating.event_work_surcharge",
                  "financial.policy_fee",
                  "financial.state_tax_bps",
                  "financial.stamping_fee_bps",
                  "option.basic.limit",
                  "option.basic.deductible",
                  "option.basic.limit_factor",
                  "option.basic.deductible_factor",
                  "option.standard.limit",
                  "option.standard.deductible",
                  "option.standard.limit_factor",
                  "option.standard.deductible_factor",
                  "option.premium.limit",
                  "option.premium.deductible",
                  "option.premium.limit_factor",
                  "option.premium.deductible_factor"
                ].map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
            <label className="questionField">
              <span>Value</span>
              <input value={parameterDraft.value} onChange={(event: { target: { value: string } }) => setParameterDraft((current) => ({ ...current, value: event.target.value }))} />
            </label>
          </div>
          <button
            className="secondaryButton"
            disabled={role !== "admin" || !token}
            type="button"
            onClick={async () => {
              await saveProductParameter(token, {
                version: "2026.05.01",
                key: parameterDraft.key,
                value: Number(parameterDraft.value),
                active: true
              });
              setPublished(true);
              await onChanged();
            }}
          >
            Save product parameter
          </button>
          <div className="factorTable parameterTable">
            {parameterRows.map((row) => (
              <div key={row.key}>
                <span>{row.key}</span>
                <span>{row.value}</span>
                <span>{row.active}</span>
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

function Analytics({
  policyCount,
  renewalWorkItems,
  submissions
}: {
  policyCount: number;
  renewalWorkItems?: { expiringPolicies: any[]; renewalSubmissions: any[] };
  submissions: Submission[];
}) {
  const quoteToBind = Math.round((policyCount / Math.max(submissions.length, 1)) * 100);
  const referralRate = Math.round((submissions.filter((submission) => submission.status === "referred").length / Math.max(submissions.length, 1)) * 100);
  const portfolioPremium = submissions.reduce((sum, submission) => sum + premiumForSubmission(submission), 0);
  const classMix = ["PHOTO-PORTRAIT", "PHOTO-WEDDING", "PHOTO-STUDIO", "PHOTO-DRONE"].map((classCode) => {
    const count = submissions.filter((submission) => submission.risk.classCode === classCode).length;
    return [labelize(classCode.replace("PHOTO-", "")), Math.round((count / Math.max(submissions.length, 1)) * 100)] as const;
  });

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <p>Portfolio analytics</p>
          <h2>Submission flow, workload, and portfolio risk</h2>
        </div>
      </section>

      <section className="metricGrid">
        <Metric label="Submission volume" value={`${submissions.length}`} trend="Rails book" />
        <Metric label="Referral rate" value={`${referralRate}%`} trend="Rails book" />
        <Metric label="Quote-to-bind" value={`${quoteToBind}%`} trend="Rails book" />
        <Metric label="Portfolio premium" value={dollars(portfolioPremium)} trend="Rails book" />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panelHeader">
            <h3>Renewal Workload</h3>
            <span>{renewalWorkItems?.expiringPolicies.length ?? 0} expiring</span>
          </div>
          <div className="table">
            {(renewalWorkItems?.expiringPolicies ?? []).slice(0, 5).map((policy: any) => (
              <div className="documentRow" key={policy.id}>
                <FileBadge size={18} />
                <span>{policy.policy_number}</span>
                <b>{policy.expiration_date}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panelHeader">
            <h3>Renewal Quotes</h3>
            <span>{renewalWorkItems?.renewalSubmissions.length ?? 0} created</span>
          </div>
          <div className="table">
            {(renewalWorkItems?.renewalSubmissions ?? []).slice(0, 5).map((submission: any) => (
              <div className="documentRow" key={submission.id}>
                <ClipboardList size={18} />
                <span>{submission.business?.legal_name}</span>
                <b>{submission.status}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="analyticsGrid">
        {classMix.map(([label, value]) => (
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
