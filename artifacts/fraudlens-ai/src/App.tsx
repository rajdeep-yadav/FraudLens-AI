import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen,
  BriefcaseBusiness, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  Command, FileText, Fingerprint, Gauge, LayoutDashboard, ListFilter, LockKeyhole,
  LogOut, Menu, Moon, Plus, Search, Settings2, Shield, ShieldAlert,
  ShieldCheck, Sun, Upload, X, Zap,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  useGetOverview, useListTransactions, useCreateTransaction, useGetTransaction,
  useReviewTransaction, useAnalyzeTransaction, useListAlerts, useUpdateAlert,
  useListInvestigations, useCreateInvestigation, useGetInvestigation, useUpdateInvestigation,
  useAddInvestigationNote, useGetAnalyticsTrends, useListAuditLogs, useGetSettings,
  useUpdateSettings, useImportTransactions, useExportTransactions,
  getGetOverviewQueryKey, getListTransactionsQueryKey, getGetTransactionQueryKey,
  getListAlertsQueryKey, getListInvestigationsQueryKey, getGetInvestigationQueryKey,
  getGetAnalyticsTrendsQueryKey, getListAuditLogsQueryKey, getGetSettingsQueryKey,
  getExportTransactionsQueryKey,
} from '@workspace/api-client-react';
import type { Transaction, TransactionInput } from '@workspace/api-client-react';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#236f58', colorForeground: '#252d38', colorMutedForeground: '#68717c',
    colorDanger: '#bd433e', colorBackground: '#fffefa', colorInput: '#fffefa',
    colorInputForeground: '#252d38', colorNeutral: '#ddd9d0', fontFamily: 'DM Sans, sans-serif', borderRadius: '0.45rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fffefa] rounded-xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#252d38] font-semibold', headerSubtitle: 'text-[#68717c]', socialButtonsBlockButtonText: 'text-[#252d38]',
    formFieldLabel: 'text-[#303a45]', footerActionLink: 'text-[#236f58]', footerActionText: 'text-[#68717c]',
    dividerText: 'text-[#68717c]', identityPreviewEditButton: 'text-[#236f58]', formFieldSuccessText: 'text-[#236f58]',
    alertText: 'text-[#8f302d]', logoBox: 'h-10', logoImage: 'h-8 w-auto', socialButtonsBlockButton: 'border-[#ddd9d0]',
    formButtonPrimary: 'bg-[#236f58] hover:bg-[#1b5947] text-white', formFieldInput: 'border-[#d8d4ca] bg-[#fffefa] text-[#252d38]',
    footerAction: 'text-[#68717c]', dividerLine: 'bg-[#e3dfd7]', alert: 'border-[#e6c5c1]',
    otpCodeFieldInput: 'border-[#d8d4ca]', formFieldRow: 'text-[#303a45]', main: 'text-[#252d38]',
  },
};

const navSections = [
  { title: 'WORKSPACE', items: [
    ['Dashboard', '/dashboard', LayoutDashboard], ['Transactions', '/transactions', Activity],
    ['Analysis lab', '/lab', Fingerprint], ['Alerts', '/alerts', Bell], ['Investigations', '/investigations', BriefcaseBusiness],
  ] },
  { title: 'INTELLIGENCE', items: [
    ['Analytics', '/analytics', Gauge], ['Scoring rules', '/model', ShieldCheck],
    ['Import data', '/import', Upload], ['Audit log', '/audit', FileText],
  ] },
  { title: 'ADMINISTRATION', items: [['Settings', '/settings', Settings2], ['Project notes', '/project', BookOpen]] },
];

type Risk = 'low' | 'medium' | 'high' | 'critical';
function money(value: number, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
function when(value?: string) { return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function riskClass(value?: string) { return `risk risk-${(value || 'low').toLowerCase()}`; }
function statusClass(value?: string) { return `state state-${(value || 'open').toLowerCase().replace('_', '-')}`; }

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark"><Shield size={16} strokeWidth={2.5} /></span><span>fraud<span>lens</span></span></span>;
}
function Button({ children, variant = 'solid', ...props }: { children: ReactNode; variant?: 'solid' | 'outline' | 'quiet' | 'danger'; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; 'data-testid'?: string }) {
  return <button className={`button button-${variant}`} {...props}>{children}</button>;
}
function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action && <div className="title-action">{action}</div>}</div>;
}
function LoadingBlock() { return <div className="skeleton-wrap"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton wide" /></div>; }
function QueryState({ loading, error, retry, empty, children }: { loading?: boolean; error?: boolean; retry?: () => void; empty?: boolean; children: ReactNode }) {
  if (loading) return <LoadingBlock />;
  if (error) return <div className="state-panel"><AlertTriangle size={18} /><b>Could not load this view</b><span>Check your connection, then try again.</span><Button variant="outline" onClick={retry}>Retry</Button></div>;
  if (empty) return <div className="empty-state"><div className="empty-icon"><ListFilter size={19} /></div><b>Nothing to review yet</b><span>New activity will appear here when the system has data.</span></div>;
  return <>{children}</>;
}
function RiskPill({ level }: { level: string }) { return <span className={riskClass(level)}><i />{level}</span>; }
function DataTable({ columns, children, min = '720px' }: { columns: string[]; children: ReactNode; min?: string }) {
  return <div className="table-scroll"><table style={{ minWidth: min }}><thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function PublicHome() {
  return <main className="landing">
    <header className="landing-nav"><Link href="/" className="no-link"><Logo /></Link><div className="landing-links"><a href="#approach">Approach</a><a href="#limits">Limitations</a><Link href="/sign-in" className="nav-signin">Sign in <ArrowRight size={14} /></Link></div></header>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> FINANCIAL SECURITY OPERATIONS</div>
        <h1>Signal first.<br /><em>Evidence always.</em></h1>
        <p>FraudLens helps teams inspect transaction risk, manage alerts, and document investigations — with every signal explained and every decision kept human.</p>
        <div className="hero-actions"><Link href="/sign-up" className="button button-solid">Open the workspace <ArrowRight size={15} /></Link><Link href="/sign-in" className="button button-outline">Sign in</Link></div>
        <div className="hero-footnote"><LockKeyhole size={13} /> Academic operations environment <span /> Human review remains the decision-maker</div>
      </div>
      <div className="hero-visual" aria-label="Risk operations dashboard preview">
        <div className="visual-top"><div><span className="terminal-dot" /> LIVE SIGNAL REVIEW</div><span className="mono">FL / 08.24</span></div>
        <div className="visual-number"><small>ASSESSMENT SCORE</small><strong>78<span>/100</span></strong><span className="risk risk-high"><i />HIGH SIGNAL</span></div>
        <div className="signal-lines"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <div className="visual-rule"><span><AlertTriangle size={14} /> Multiple failed attempts</span><span className="mono">+24 pts</span></div>
        <div className="visual-rule"><span><Clock3 size={14} /> Unusual transaction velocity</span><span className="mono">+18 pts</span></div>
        <div className="visual-foot"><ShieldCheck size={15} /><span>Risk signal only — requires human review</span></div>
        <div className="visual-corner">01 — EXPLAINABLE RULE ENGINE</div>
      </div>
    </section>
    <section className="proof-strip"><div><strong>01</strong><span>Traceable signals</span></div><div><strong>02</strong><span>Structured review</span></div><div><strong>03</strong><span>Auditable decisions</span></div><div className="proof-note">Built for clarity, not automation theater.</div></section>
    <section className="landing-section" id="approach"><div className="section-index">01 / OPERATING MODEL</div><div className="section-content"><h2>Move from noisy events<br />to <em>documented decisions.</em></h2><div className="approach-grid"><article><span className="step">A</span><h3>Collect</h3><p>Bring transaction records into a consistent review queue. Search, filter, and inspect without losing the original context.</p></article><article><span className="step">B</span><h3>Explain</h3><p>See which deterministic rules contributed to a score, what was recommended, and where thresholds currently sit.</p></article><article><span className="step">C</span><h3>Resolve</h3><p>Assign alerts, create investigation cases, add notes, and record a human outcome in the audit trail.</p></article></div></div></section>
    <section className="landing-callout" id="limits"><div><div className="eyebrow">IMPORTANT BY DESIGN</div><h2>A score is a prompt<br />to look closer.</h2></div><div><p>FraudLens uses an explainable rules-based scorer. It is not a trained machine-learning model. Scores are operational risk signals — not fraud probabilities and never proof of fraud.</p><Link href="/sign-up" className="text-link">Explore the workspace <ArrowRight size={15} /></Link></div></section>
    <footer className="landing-footer"><Logo /><span>FraudLens AI · Academic project</span><span>Human judgement stays in the loop.</span></footer>
  </main>;
}

function SignInPage() { return <div className="auth-page"><div className="auth-brand"><Link href="/" className="no-link"><Logo /></Link><span>SECURITY OPERATIONS / AUTHENTICATION</span></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { return <div className="auth-page"><div className="auth-brand"><Link href="/" className="no-link"><Logo /></Link><span>SECURITY OPERATIONS / AUTHENTICATION</span></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><PublicHome /></Show></>;
}
function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('fraudlens-theme') === 'dark');
  const { signOut } = useClerk();
  const { user } = useUser();
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('fraudlens-theme', dark ? 'dark' : 'light'); }, [dark]);
  const initials = user?.fullName?.split(' ').map((x) => x[0]).join('').slice(0, 2) || user?.primaryEmailAddress?.emailAddress?.slice(0, 1).toUpperCase() || 'FL';
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} data-testid="navigation-sidebar">
      <div className="sidebar-head"><Link href="/dashboard" className="no-link"><Logo inverse /></Link><span className="workspace-tag">ACADEMIC / DEV</span></div>
      <div className="workspace-switch"><span className="workspace-avatar">F</span><span><b>Financial Security</b><small>Research workspace</small></span><ChevronDown size={14} /></div>
      <nav>{navSections.map((section) => <div className="nav-section" key={section.title}><div className="nav-label">{section.title}</div>{section.items.map(([label, href, Icon]) => {
        const IconComponent = Icon as typeof LayoutDashboard;
        return <Link key={href as string} href={href as string} onClick={() => setMobileOpen(false)} className={`nav-item ${location === href ? 'nav-active' : ''}`} data-testid={`link-${(label as string).toLowerCase().replaceAll(' ', '-')}`}><IconComponent size={16} strokeWidth={1.8} /><span>{label as string}</span>{label === 'Alerts' && <span className="nav-count">!</span>}</Link>;
      })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className="live-dot" /><span><b>Rules engine active</b><small>Scoring version v1</small></span></div><button className="profile-control" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><span className="profile-initials">{initials}</span><span><b>{user?.fullName || 'Analyst'}</b><small>Sign out of workspace</small></span><LogOut size={14} /></button></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={18} /></button><div className="crumb"><span>FraudLens</span><span>/</span><b>{location.split('/').filter(Boolean).at(-1)?.replaceAll('-', ' ') || 'Overview'}</b></div></div><div className="topbar-right"><span className="system-health"><span className="live-dot" /> All systems operational</span><button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme" data-testid="button-toggle-theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button><span className="avatar-small">{initials}</span></div></header><div className="page-body page-enter">{children}</div></main>
  </div>;
}
function Portal({ children }: { children: ReactNode }) { return <Protected><AppShell>{children}</AppShell></Protected>; }

function Dashboard() {
  const q = useGetOverview();
  const d = q.data;
  return <div><PageTitle eyebrow="MONDAY, 24 JUNE 2024 · OPERATIONS" title="Overview" detail="A clear read on your current review queue." action={<Link href="/transactions" className="button button-outline">View transactions <ArrowRight size={14} /></Link>} />
    <QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>
      {d && <><div className="metric-grid">
        <Metric label="Transactions monitored" value={d.totalTransactions.toLocaleString()} caption="Across the current dataset" icon={<Activity size={16} />} />
        <Metric label="Flagged for review" value={d.flaggedTransactions.toLocaleString()} caption={`${d.awaitingReview.toLocaleString()} awaiting a human decision`} icon={<ShieldAlert size={16} />} tone="amber" />
        <Metric label="Confirmed fraud" value={d.confirmedFraud.toLocaleString()} caption="Recorded human outcomes" icon={<ShieldCheck size={16} />} tone="red" />
        <Metric label="Estimated fraud value" value={money(d.estimatedFraudValue)} caption="Value of confirmed cases" icon={<ArrowUpRight size={16} />} tone="green" />
      </div><div className="dashboard-columns"><section className="panel"><PanelHeader title="Recent transactions" meta="LATEST SIGNALS" link="/transactions" /><QueryState empty={!d.recentTransactions?.length}><DataTable columns={['REFERENCE', 'MERCHANT', 'AMOUNT', 'RISK', 'REVIEW']} min="640px">{d.recentTransactions.map((t) => <TransactionRow key={t.id} t={t} />)}</DataTable></QueryState></section><section className="panel"><PanelHeader title="Risk distribution" meta="CURRENT DATASET" /><RiskDistribution items={d.riskDistribution} total={d.totalTransactions} /><div className="panel-note"><CircleHelp size={14} /> Risk levels are configurable thresholds, not probabilities.</div></section></div>
      <section className="panel alert-panel"><PanelHeader title="Latest alerts" meta="NEEDS ATTENTION" link="/alerts" /><QueryState empty={!d.recentAlerts?.length}><DataTable columns={['REFERENCE', 'SEVERITY', 'REASON', 'STATUS', 'CREATED']} min="670px">{d.recentAlerts.map((a) => <tr key={a.id}><td className="mono">{a.reference}</td><td><RiskPill level={a.severity} /></td><td className="text-cell">{a.reason}</td><td><span className={statusClass(a.status)}>{a.status}</span></td><td>{when(a.createdAt)}</td></tr>)}</DataTable></QueryState></section></>}
    </QueryState>
  </div>;
}
function Metric({ label, value, caption, icon, tone = 'neutral' }: { label: string; value: string; caption: string; icon: ReactNode; tone?: string }) { return <section className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value}</strong><small>{caption}</small></section>; }
function PanelHeader({ title, meta, link }: { title: string; meta?: string; link?: string }) { return <div className="panel-header"><div><h2>{title}</h2>{meta && <span className="panel-meta">{meta}</span>}</div>{link && <Link href={link} className="small-link">View all <ArrowRight size={13} /></Link>}</div>; }
function TransactionRow({ t }: { t: Transaction }) { return <tr data-testid={`row-transaction-${t.id}`}><td><Link href={`/transactions?selected=${t.id}`} className="table-link mono">{t.reference}</Link><small className="sub-cell">{t.category}</small></td><td>{t.merchant}<small className="sub-cell">{t.paymentMethod}</small></td><td className="mono">{money(t.amount, t.currency)}</td><td><RiskPill level={t.riskLevel} /></td><td><span className={statusClass(t.reviewStatus)}>{t.reviewStatus.replaceAll('_', ' ')}</span></td></tr>; }
function RiskDistribution({ items, total }: { items: Array<{ riskLevel: string; count: number }>; total: number }) {
  const palette: Record<string, string> = { critical: 'var(--critical)', high: 'var(--high)', medium: 'var(--medium)', low: 'var(--low)' };
  return <div className="distribution"><div className="distribution-bar">{items.map((x) => <span key={x.riskLevel} style={{ width: `${total ? x.count / total * 100 : 0}%`, background: palette[x.riskLevel] || 'var(--low)' }} />)}</div>{items.map((x) => <div className="distribution-row" key={x.riskLevel}><span><i style={{ background: palette[x.riskLevel] }} />{x.riskLevel}</span><span className="mono">{x.count.toLocaleString()} <small>{total ? `${(100 * x.count / total).toFixed(1)}%` : '0%'}</small></span></div>)}</div>;
}

function Transactions() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.search).get('selected'));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [note, setNote] = useState('');
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined, risk: risk ? risk as 'low' | 'medium' | 'high' | 'critical' : undefined, page, pageSize: 10 }), [search, status, risk, page]);
  const q = useListTransactions(params, { query: { queryKey: getListTransactionsQueryKey(params) } });
  const details = useGetTransaction(selected || 0, { query: { enabled: !!selected, queryKey: getGetTransactionQueryKey(selected || 0) } });
  const review = useReviewTransaction();
  const createTransaction = useCreateTransaction();
  const createCase = useCreateInvestigation();
  const client = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTxn, setNewTxn] = useState({ amount: '', currency: 'USD', merchant: '', category: 'retail', paymentMethod: 'card', occurredAt: new Date().toISOString().slice(0, 16) });
  const rows = q.data?.items || [];
  function mark(statusValue: 'confirmed_fraud' | 'legitimate' | 'inconclusive') {
    if (!selected) return;
    review.mutate({ id: selected, data: { reviewStatus: statusValue, note: note || undefined } }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getListTransactionsQueryKey() }); void client.invalidateQueries({ queryKey: getGetTransactionQueryKey(selected) }); void client.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); setNote(''); } });
  }
  function createInvestigation() {
    if (!selected) return;
    createCase.mutate({ data: { transactionId: selected, priority: details.data?.transaction.riskLevel || 'medium' } }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getListInvestigationsQueryKey() }); } });
  }
  function addTransaction(e: FormEvent) {
    e.preventDefault();
    createTransaction.mutate({ data: { ...newTxn, amount: Number(newTxn.amount), occurredAt: new Date(newTxn.occurredAt).toISOString() } }, { onSuccess: () => { setShowCreate(false); setNewTxn({ amount: '', currency: 'USD', merchant: '', category: 'retail', paymentMethod: 'card', occurredAt: new Date().toISOString().slice(0, 16) }); void client.invalidateQueries({ queryKey: getListTransactionsQueryKey() }); void client.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); void client.invalidateQueries({ queryKey: getListAlertsQueryKey() }); } });
  }
  return <div><PageTitle eyebrow="REVIEW QUEUE" title="Transactions" detail="Search and inspect transaction risk signals. A score is not a finding." action={<><Button variant="outline" onClick={() => setShowCreate(true)} data-testid="button-new-transaction"><Plus size={14} /> New transaction</Button><ExportAction /></>} />
    <section className="panel"><div className="filterbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search reference, merchant, customer…" data-testid="input-transaction-search" /></label><select value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1); }} aria-label="Filter risk" data-testid="select-risk-filter"><option value="">All risk levels</option>{['critical', 'high', 'medium', 'low'].map((v) => <option key={v}>{v}</option>)}</select><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter review status" data-testid="select-review-filter"><option value="">All review statuses</option>{['pending', 'confirmed_fraud', 'legitimate', 'inconclusive'].map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select><span className="result-count">{q.data?.total ?? '—'} records</span></div>
      <QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()} empty={!rows.length}>{rows.length > 0 && <DataTable columns={['REFERENCE', 'MERCHANT', 'AMOUNT', 'OCCURRED', 'RISK SIGNAL', 'REVIEW STATUS', '']} min="900px">{rows.map((t) => <tr key={t.id} data-testid={`row-transaction-${t.id}`}><td className="mono">{t.reference}<small className="sub-cell">{t.customerId || `TX-${t.id}`}</small></td><td>{t.merchant}<small className="sub-cell">{t.category} · {t.paymentMethod}</small></td><td className="mono">{money(t.amount, t.currency)}</td><td>{when(t.occurredAt)}</td><td><RiskPill level={t.riskLevel} /><small className="sub-cell mono">{t.riskScore} / 100</small></td><td><span className={statusClass(t.reviewStatus)}>{t.reviewStatus.replaceAll('_', ' ')}</span></td><td><Button variant="quiet" onClick={() => setSelected(t.id)} data-testid={`button-review-${t.id}`}>Inspect <ArrowRight size={13} /></Button></td></tr>)}</DataTable>}</QueryState>
      <div className="table-footer"><span>Page {q.data?.page || page} of {Math.max(1, Math.ceil((q.data?.total || 0) / (q.data?.pageSize || 10)))}</span><div><Button variant="outline" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft size={14} /> Previous</Button><Button variant="outline" onClick={() => setPage(page + 1)} disabled={page * (q.data?.pageSize || 10) >= (q.data?.total || 0)}>Next <ChevronRight size={14} /></Button></div></div>
    </section>
    {showCreate && <div className="drawer-backdrop" onClick={() => setShowCreate(false)}><section className="create-modal panel" onClick={(e) => e.stopPropagation()}><div className="panel-header"><div><span className="eyebrow">NEW RECORD</span><h2>Submit transaction</h2></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close create form"><X size={17} /></button></div><form className="modal-form" onSubmit={addTransaction}><div className="form-grid"><Field label="Amount *"><input type="number" min="0.01" step="0.01" required value={newTxn.amount} onChange={(e) => setNewTxn({ ...newTxn, amount: e.target.value })} /></Field><Field label="Currency"><select value={newTxn.currency} onChange={(e) => setNewTxn({ ...newTxn, currency: e.target.value })}><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></Field><Field label="Merchant *"><input required value={newTxn.merchant} onChange={(e) => setNewTxn({ ...newTxn, merchant: e.target.value })} /></Field><Field label="Category"><input required value={newTxn.category} onChange={(e) => setNewTxn({ ...newTxn, category: e.target.value })} /></Field><Field label="Payment method"><select value={newTxn.paymentMethod} onChange={(e) => setNewTxn({ ...newTxn, paymentMethod: e.target.value })}>{['card', 'bank_transfer', 'digital_wallet', 'cash', 'other'].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Occurred at"><input type="datetime-local" required value={newTxn.occurredAt} onChange={(e) => setNewTxn({ ...newTxn, occurredAt: e.target.value })} /></Field></div>{createTransaction.isError && <div className="inline-error">Transaction could not be saved. Check the submitted values and retry.</div>}<div className="form-submit"><span>Submission saves a rules-based assessment.</span><Button type="submit" disabled={createTransaction.isPending} data-testid="button-submit-transaction">{createTransaction.isPending ? 'Saving…' : 'Save transaction'}</Button></div></form></section></div>}
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">TRANSACTION REVIEW</span><h2>{details.data?.transaction.reference || 'Loading record'}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close detail"><X size={18} /></button></div><QueryState loading={details.isLoading} error={details.isError} retry={() => details.refetch()}>{details.data && <><div className="detail-amount"><small>TRANSACTION AMOUNT</small><strong>{money(details.data.transaction.amount, details.data.transaction.currency)}</strong><span><RiskPill level={details.data.transaction.riskLevel} /> <span className="mono">{details.data.transaction.riskScore}/100</span></span></div><dl className="detail-list">{[['Merchant', details.data.transaction.merchant], ['Category', details.data.transaction.category], ['Payment method', details.data.transaction.paymentMethod], ['Customer', details.data.transaction.customerId || 'Not supplied'], ['Location', details.data.transaction.location || 'Not supplied'], ['Device ID', details.data.transaction.deviceId || 'Not supplied'], ['Occurred', when(details.data.transaction.occurredAt)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><section className="explain-box"><div className="eyebrow">LATEST EXPLANATION</div>{details.data.predictions?.[0] ? <><p>{details.data.predictions[0].explanation}</p><ul>{details.data.predictions[0].reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></> : <p>No explanation is available for this record.</p>}</section><label className="field-label">Review note<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context to your decision…" data-testid="input-review-note" /></label><div className="review-buttons"><Button variant="danger" onClick={() => mark('confirmed_fraud')} disabled={review.isPending} data-testid="button-confirm-fraud">Confirm fraud</Button><Button variant="outline" onClick={() => mark('legitimate')} disabled={review.isPending} data-testid="button-mark-legitimate">Legitimate</Button><Button variant="outline" onClick={() => mark('inconclusive')} disabled={review.isPending}>Inconclusive</Button></div><Button variant="quiet" onClick={createInvestigation} disabled={createCase.isPending} data-testid="button-create-case"><Plus size={14} /> Open investigation case</Button></>}</QueryState></aside></div>}
  </div>;
}

function ExportAction() {
  const exp = useExportTransactions({ query: { enabled: false, queryKey: getExportTransactionsQueryKey() } });
  return <Button variant="outline" onClick={() => { void exp.refetch().then((res) => { if (res.data) { const blob = new Blob([res.data], { type: 'text/csv' }); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = 'fraudlens-transactions.csv'; a.click(); URL.revokeObjectURL(href); } }); }} data-testid="button-export-transactions"><ArrowDownToLine size={14} /> Export CSV</Button>;
}

function Lab() {
  const analyze = useAnalyzeTransaction();
  const client = useQueryClient();
  const [result, setResult] = useState<Awaited<ReturnType<typeof analyze.mutateAsync>> | null>(null);
  const [form, setForm] = useState({ amount: '', currency: 'USD', merchant: '', category: 'Online purchase', paymentMethod: 'card', customerId: '', location: '', deviceId: '', occurredAt: new Date().toISOString().slice(0, 16), recentCount: '', failedAttempts: '', newDevice: false, unusualLocation: false });
  const change = (key: keyof typeof form, value: string | boolean) => setForm((old) => ({ ...old, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const data: TransactionInput = { ...form, amount: Number(form.amount), occurredAt: new Date(form.occurredAt).toISOString(), customerId: form.customerId || undefined, location: form.location || null, deviceId: form.deviceId || null, recentCount: form.recentCount ? Number(form.recentCount) : null, failedAttempts: form.failedAttempts ? Number(form.failedAttempts) : null, newDevice: form.newDevice, unusualLocation: form.unusualLocation };
    const response = await analyze.mutateAsync({ data });
    setResult(response);
    void client.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
    void client.invalidateQueries({ queryKey: getListAlertsQueryKey() });
  }
  return <div><PageTitle eyebrow="RULE ENGINE / EXPLAINABILITY" title="Analysis lab" detail="Score a transaction and inspect the rules that contributed to the signal." />
    <div className="lab-layout"><form className="panel lab-form" onSubmit={submit}><PanelHeader title="Transaction inputs" meta="REQUIRED FIELDS MARKED *" /><div className="form-grid">
      <Field label="Amount *"><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => change('amount', e.target.value)} placeholder="0.00" data-testid="input-analysis-amount" /></Field>
      <Field label="Currency *"><select value={form.currency} onChange={(e) => change('currency', e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></Field>
      <Field label="Merchant *"><input required value={form.merchant} onChange={(e) => change('merchant', e.target.value)} placeholder="Northwind Market" data-testid="input-analysis-merchant" /></Field>
      <Field label="Category *"><input required value={form.category} onChange={(e) => change('category', e.target.value)} /></Field>
      <Field label="Payment method *"><select value={form.paymentMethod} onChange={(e) => change('paymentMethod', e.target.value)}>{['card', 'bank_transfer', 'digital_wallet', 'cash', 'other'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Customer ID"><input value={form.customerId} onChange={(e) => change('customerId', e.target.value)} placeholder="Optional" /></Field>
      <Field label="Location"><input value={form.location} onChange={(e) => change('location', e.target.value)} placeholder="City, country" /></Field>
      <Field label="Device ID"><input value={form.deviceId} onChange={(e) => change('deviceId', e.target.value)} placeholder="Optional" /></Field>
      <Field label="Occurred at"><input type="datetime-local" value={form.occurredAt} onChange={(e) => change('occurredAt', e.target.value)} /></Field>
      <Field label="Recent transaction count"><input type="number" min="0" value={form.recentCount} onChange={(e) => change('recentCount', e.target.value)} placeholder="Optional" /></Field>
      <Field label="Failed attempts"><input type="number" min="0" value={form.failedAttempts} onChange={(e) => change('failedAttempts', e.target.value)} placeholder="Optional" /></Field>
    </div><div className="check-row"><label><input type="checkbox" checked={form.newDevice} onChange={(e) => change('newDevice', e.target.checked)} /> New device</label><label><input type="checkbox" checked={form.unusualLocation} onChange={(e) => change('unusualLocation', e.target.checked)} /> Unusual location</label></div><div className="form-submit"><span>Analysis is saved and may create an alert.</span><Button type="submit" disabled={analyze.isPending} data-testid="button-run-analysis"><Zap size={14} /> {analyze.isPending ? 'Analyzing…' : 'Run analysis'}</Button></div>{analyze.isError && <div className="inline-error">Analysis failed. Please review your inputs and retry.</div>}</form>
      <section className="panel result-panel"><PanelHeader title="Assessment" meta="EXPLAINED SIGNAL" />{!result ? <div className="result-placeholder"><div className="result-orbit"><Fingerprint size={26} /></div><b>Awaiting transaction input</b><span>Submit an example to see the resulting rule-based risk signal.</span></div> : <div className="result-content"><div className="result-score"><small>RISK SCORE</small><strong>{result.prediction.riskScore}<i>/100</i></strong><RiskPill level={result.prediction.riskLevel} /></div><div className="notice"><ShieldCheck size={16} /><span>This assessment is a risk signal only. It is not a probability or proof of fraud.</span></div><div className="explain-box"><div className="eyebrow">WHY THIS SIGNAL</div><p>{result.prediction.explanation}</p><ul>{result.prediction.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div><div className="detail-list"><div><dt>Recommended action</dt><dd>{result.prediction.recommendedAction}</dd></div><div><dt>Engine / version</dt><dd>{result.prediction.engine} · {result.prediction.version}</dd></div><div><dt>Alert created</dt><dd>{result.alertCreated ? 'Yes' : 'No'}</dd></div></div><Link href="/transactions" className="small-link">Open transaction review <ArrowRight size={13} /></Link></div>}</section></div>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field-label">{label}{children}</label>; }

function Alerts() {
  const q = useListAlerts();
  const update = useUpdateAlert();
  const client = useQueryClient();
  const [assignees, setAssignees] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  function change(id: number, data: { status?: 'open' | 'acknowledged' | 'escalated' | 'resolved'; assignedTo?: string | null; resolutionNotes?: string | null }) {
    update.mutate({ id, data }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getListAlertsQueryKey() }); void client.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); } });
  }
  const rows = q.data || [];
  return <div><PageTitle eyebrow="SIGNAL TRIAGE" title="Alerts" detail="Acknowledge, assign, escalate, and record resolution notes." /><section className="panel"><div className="filterbar"><div className="panel-intro"><span className="live-dot" /> Active alert queue</div><span className="result-count">{rows.length} alerts</span></div><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()} empty={!rows.length}><DataTable columns={['ALERT', 'SIGNAL REASON', 'STATUS', 'ASSIGNEE', 'CREATED', 'ACTIONS']} min="1020px">{rows.map((a) => <tr key={a.id} data-testid={`row-alert-${a.id}`}><td><div className="mono">{a.reference}</div><small className="sub-cell"><RiskPill level={a.severity} /></small></td><td className="text-cell">{a.reason}{a.resolutionNotes && <small className="sub-cell">Resolution: {a.resolutionNotes}</small>}</td><td><span className={statusClass(a.status)}>{a.status}</span></td><td><div className="assign-control"><input value={assignees[a.id] ?? a.assignedTo ?? ''} placeholder="Assign analyst" onChange={(e) => setAssignees((o) => ({ ...o, [a.id]: e.target.value }))} aria-label={`Assignee for alert ${a.reference}`} /><button onClick={() => change(a.id, { assignedTo: assignees[a.id] || null })} aria-label="Save assignee" data-testid={`button-assign-alert-${a.id}`}><Check size={14} /></button></div></td><td>{when(a.createdAt)}</td><td><div className="row-actions">{a.status === 'open' && <Button variant="outline" onClick={() => change(a.id, { status: 'acknowledged' })} data-testid={`button-ack-alert-${a.id}`}>Acknowledge</Button>}{a.status !== 'resolved' && a.status !== 'escalated' && <Button variant="quiet" onClick={() => change(a.id, { status: 'escalated' })}>Escalate</Button>}{a.status !== 'resolved' && <Button variant="quiet" onClick={() => { const text = window.prompt('Resolution notes', notes[a.id] || ''); if (text !== null) { setNotes((o) => ({ ...o, [a.id]: text })); change(a.id, { status: 'resolved', resolutionNotes: text }); } }}>Resolve</Button>}</div></td></tr>)}</DataTable></QueryState></section></div>;
}

function Investigations() {
  const q = useListInvestigations();
  const create = useCreateInvestigation();
  const update = useUpdateInvestigation();
  const client = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [newTx, setNewTx] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const addNote = useAddInvestigationNote();
  const detail = useGetInvestigation(selected || 0, { query: { enabled: !!selected, queryKey: getGetInvestigationQueryKey(selected || 0) } });
  function reload() { void client.invalidateQueries({ queryKey: getListInvestigationsQueryKey() }); }
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ data: { transactionId: Number(newTx), priority, assignedTo: assignee || undefined } }, { onSuccess: (item) => { reload(); setSelected(item.id); setNewTx(''); } });
  }
  function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!selected || !note.trim()) return;
    addNote.mutate({ id: selected, data: { content: note.trim() } }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetInvestigationQueryKey(selected) }); setNote(''); } });
  }
  const rows = q.data || [];
  return <div><PageTitle eyebrow="CASE MANAGEMENT" title="Investigations" detail="Group review work into cases and preserve context with notes." />
    <div className="investigations-grid"><div><form className="panel create-case" onSubmit={submit}><div><span className="eyebrow">NEW CASE</span><h2>Open an investigation</h2></div><div className="create-case-fields"><Field label="Transaction ID *"><input required type="number" min="1" value={newTx} onChange={(e) => setNewTx(e.target.value)} placeholder="Transaction ID" data-testid="input-case-transaction" /></Field><Field label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>{['low', 'medium', 'high', 'critical'].map((p) => <option key={p}>{p}</option>)}</select></Field><Field label="Assigned analyst"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Optional" /></Field><Button type="submit" disabled={create.isPending} data-testid="button-create-investigation"><Plus size={14} /> Create case</Button></div>{create.isError && <small className="inline-error">Case could not be created. Check the transaction ID.</small>}</form>
      <section className="panel"><PanelHeader title="Cases" meta="ALL INVESTIGATIONS" /><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()} empty={!rows.length}><DataTable columns={['CASE', 'PRIORITY', 'STATUS', 'ASSIGNED TO', 'OPENED', '']} min="690px">{rows.map((c) => <tr key={c.id} data-testid={`row-investigation-${c.id}`}><td><button className="table-button mono" onClick={() => setSelected(c.id)}>CASE-{c.id} <small className="sub-cell">{c.reference}</small></button></td><td><RiskPill level={c.priority} /></td><td><span className={statusClass(c.status)}>{c.status.replace('_', ' ')}</span></td><td>{c.assignedTo || 'Unassigned'}</td><td>{when(c.openedAt)}</td><td><Button variant="quiet" onClick={() => setSelected(c.id)}>Open <ArrowRight size={13} /></Button></td></tr>)}</DataTable></QueryState></section></div>
      <section className="panel case-detail">{!selected ? <div className="result-placeholder"><div className="result-orbit"><BriefcaseBusiness size={24} /></div><b>Select a case to inspect</b><span>Case notes and status updates stay alongside the source transaction.</span></div> : <><div className="panel-header"><div><span className="eyebrow">CASE DETAIL</span><h2>{detail.data ? `CASE-${detail.data.investigation.id}` : 'Loading case…'}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Clear selected case"><X size={16} /></button></div><QueryState loading={detail.isLoading} error={detail.isError} retry={() => detail.refetch()}>{detail.data && <><div className="case-meta"><span className="mono">{detail.data.investigation.reference}</span><span className={statusClass(detail.data.investigation.status)}>{detail.data.investigation.status}</span></div><div className="detail-list"><div><dt>Priority</dt><dd><RiskPill level={detail.data.investigation.priority} /></dd></div><div><dt>Assigned to</dt><dd>{detail.data.investigation.assignedTo || 'Unassigned'}</dd></div><div><dt>Opened</dt><dd>{when(detail.data.investigation.openedAt)}</dd></div><div><dt>Outcome</dt><dd>{detail.data.investigation.outcome || 'Not recorded'}</dd></div></div><div className="case-control"><Field label="Assign analyst"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder={detail.data.investigation.assignedTo || 'Analyst name'} /></Field><Button variant="outline" onClick={() => update.mutate({ id: selected, data: { assignedTo: assignee || null } }, { onSuccess: () => { reload(); void client.invalidateQueries({ queryKey: getGetInvestigationQueryKey(selected) }); } })}>Save assignment</Button></div>{detail.data.investigation.status !== 'closed' && <Button variant="outline" onClick={() => { const outcome = window.prompt('Add a brief outcome'); if (outcome !== null) update.mutate({ id: selected, data: { status: 'closed', outcome } }, { onSuccess: () => { reload(); void client.invalidateQueries({ queryKey: getGetInvestigationQueryKey(selected) }); } }); }}>Close case</Button>}<div className="notes-heading"><h3>Investigation notes</h3><span>{detail.data.notes.length} entries</span></div><div className="notes-list">{detail.data.notes.map((n) => <article key={n.id}><p>{n.content}</p><small>{n.author} · {when(n.createdAt)}</small></article>)}{!detail.data.notes.length && <p className="muted-copy">No notes have been added.</p>}</div><form onSubmit={saveNote}><Field label="Add a note"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record an observation or next step…" data-testid="input-investigation-note" /></Field><Button type="submit" disabled={addNote.isPending || !note.trim()}><Plus size={14} /> Add note</Button></form></>}</QueryState></>}</section>
    </div></div>;
}

function Analytics() {
  const q = useGetAnalyticsTrends({ query: { queryKey: getGetAnalyticsTrendsQueryKey() } });
  const data = q.data || [];
  const max = Math.max(1, ...data.map((x) => x.volume));
  return <div><PageTitle eyebrow="PATTERNS OVER TIME" title="Analytics" detail="Daily transaction volume and review outcomes from recorded data." /><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()} empty={!data.length}>{data.length > 0 && <><div className="trend-summary"><Metric label="Days in series" value={String(data.length)} caption="Returned daily points" icon={<Clock3 size={16} />} /><Metric label="Transactions" value={data.reduce((a, x) => a + x.volume, 0).toLocaleString()} caption="Across returned points" icon={<Activity size={16} />} /><Metric label="Flagged" value={data.reduce((a, x) => a + x.flagged, 0).toLocaleString()} caption="Signals surfaced for review" icon={<AlertTriangle size={16} />} tone="amber" /><Metric label="Confirmed fraud value" value={money(data.reduce((a, x) => a + x.confirmedFraudValue, 0))} caption="Recorded outcomes only" icon={<ShieldCheck size={16} />} tone="green" /></div><section className="panel chart-panel"><PanelHeader title="Transaction volume" meta="DAILY · RISK SIGNALS VS VOLUME" /><div className="chart-legend"><span><i className="legend-volume" /> Volume</span><span><i className="legend-flagged" /> Flagged</span></div><div className="bar-chart" role="img" aria-label="Daily volume and flagged transaction chart">{data.map((p) => <div className="chart-day" key={p.day}><div className="bar-stack"><div className="bar-volume" style={{ height: `${Math.max(3, p.volume / max * 100)}%` }} title={`${p.volume} volume`} /><div className="bar-flagged" style={{ height: `${Math.max(p.flagged ? 3 : 0, p.flagged / max * 100)}%` }} title={`${p.flagged} flagged`} /></div><span>{new Date(p.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>)}</div><DataTable columns={['DAY', 'VOLUME', 'FLAGGED', 'CONFIRMED FRAUD VALUE']} min="600px">{data.map((p) => <tr key={p.day}><td className="mono">{p.day}</td><td>{p.volume.toLocaleString()}</td><td>{p.flagged.toLocaleString()}</td><td className="mono">{money(p.confirmedFraudValue)}</td></tr>)}</DataTable></section><div className="note-banner"><CircleHelp size={16} /><span>Analytics reflect stored records and human review outcomes. They do not measure model accuracy or predictive probability.</span></div></>}</QueryState></div>;
}

function Model() {
  const q = useGetSettings();
  const settings = q.data;
  return <div><PageTitle eyebrow="DETECTION CONFIGURATION" title="Scoring rules" detail="Understand the configured rule engine before acting on its signals." /><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{settings && <><div className="rule-banner"><div className="rule-icon"><Command size={19} /></div><div><span className="eyebrow">CURRENT SCORING ENGINE · {settings.scoringVersion}</span><h2>Deterministic rules, visible inputs.</h2><p>Transaction attributes contribute points to a risk score. Thresholds assign labels and determine when an alert is raised.</p></div></div><div className="threshold-layout"><section className="panel"><PanelHeader title="Risk bands" meta="CURRENT THRESHOLDS" /><div className="threshold-list">{[['medium', settings.mediumThreshold, 'Review when a score enters this band.'], ['high', settings.highThreshold, 'Prioritize investigation when a signal is elevated.'], ['critical', settings.criticalThreshold, 'Highest configured risk band.']].map(([level, num, text]) => <div className="threshold-row" key={level as string}><RiskPill level={level as string} /><div className="threshold-track"><span style={{ width: `${Number(num)}%` }} /></div><b className="mono">{num}<small> / 100</small></b><small>{text}</small></div>)}</div></section><section className="panel"><PanelHeader title="Alert threshold" meta="NOT A FRAUD VERDICT" /><div className="alert-threshold"><strong className="mono">{settings.alertThreshold}</strong><span>Scores at or above this configured threshold can generate an alert.</span></div><Link href="/settings" className="button button-outline">Adjust thresholds <Settings2 size={14} /></Link></section></div><div className="disclosure-grid"><div className="panel"><div className="eyebrow">WHAT THIS IS</div><h3>An explainable rules scorer</h3><p>The engine evaluates configured conditions such as transaction amount, velocity, failed attempts, device novelty, and location context. Its output helps focus human review.</p></div><div className="panel warning-panel"><div className="eyebrow">WHAT THIS IS NOT</div><h3>Not a trained ML model</h3><p>There is no trained model or calibrated probability represented here. Risk scores are neither likelihoods nor findings of fraud. Reviewers make and record all final decisions.</p></div></div></>}</QueryState></div>;
}

function ImportPage() {
  const importMutation = useImportTransactions();
  const client = useQueryClient();
  const [rows, setRows] = useState<TransactionInput[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof importMutation.mutateAsync>> | null>(null);
  const [parseError, setParseError] = useState('');
  function downloadTemplate() {
    const csv = 'amount,currency,merchant,category,paymentMethod,occurredAt,customerId,location,deviceId\n125.50,USD,Northwind Market,retail,card,2024-06-24T12:00:00Z,cust-001,Seattle,device-01\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'fraudlens-import-template.csv'; a.click(); URL.revokeObjectURL(url);
  }
  async function readFile(file?: File) {
    if (!file) return;
    setFileName(file.name); setResult(null); setParseError('');
    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    const headers = (lines.shift() || '').split(',').map((h) => h.trim());
    const required = ['amount', 'currency', 'merchant', 'category', 'paymentMethod', 'occurredAt'];
    const missing = required.filter((key) => !headers.includes(key));
    if (missing.length) { setRows([]); setParseError(`Missing required columns: ${missing.join(', ')}`); return; }
    if (lines.length > 500) { setRows([]); setParseError('Maximum import size is 500 rows.'); return; }
    const parsed: TransactionInput[] = [];
    lines.filter(Boolean).forEach((line, index) => {
      const vals = line.split(',');
      const record: Record<string, string> = {};
      headers.forEach((h, i) => { record[h] = (vals[i] || '').trim(); });
      const amount = Number(record.amount);
      const date = new Date(record.occurredAt);
      if (!Number.isFinite(amount) || amount <= 0 || !record.currency || !record.merchant || Number.isNaN(date.getTime())) {
        setParseError(`Row ${index + 2} has an invalid amount, required value, or timestamp.`); return;
      }
      parsed.push({ amount, currency: record.currency.toUpperCase(), merchant: record.merchant, category: record.category, paymentMethod: record.paymentMethod, occurredAt: date.toISOString(), customerId: record.customerId || undefined, location: record.location || null, deviceId: record.deviceId || null });
    });
    setRows(parsed);
  }
  function submit() {
    importMutation.mutate({ data: { rows } }, { onSuccess: (res) => { setResult(res); void client.invalidateQueries({ queryKey: getListTransactionsQueryKey() }); void client.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); } });
  }
  return <div><PageTitle eyebrow="BULK INGESTION" title="Import transactions" detail="Validate a CSV file before sending rows to the transaction review system." action={<Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template"><ArrowDownToLine size={14} /> Download template</Button>} />
    <div className="import-layout"><section className="panel import-main"><div className="upload-drop"><div className="upload-symbol"><Upload size={20} /></div><h2>Choose a CSV file</h2><p>CSV only · up to 500 transaction rows</p><label className="button button-outline">Browse files<input type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} hidden data-testid="input-import-file" /></label>{fileName && <div className="file-chip"><FileText size={15} />{fileName}</div>}</div>{parseError && <div className="inline-error">{parseError}</div>}{rows.length > 0 && <><div className="preview-head"><div><span className="eyebrow">VALIDATED PREVIEW</span><h2>{rows.length} rows ready</h2></div><Button onClick={submit} disabled={importMutation.isPending} data-testid="button-import-submit"><Upload size={14} /> {importMutation.isPending ? 'Importing…' : 'Import rows'}</Button></div><DataTable columns={['#', 'MERCHANT', 'AMOUNT', 'CATEGORY', 'METHOD', 'OCCURRED']} min="670px">{rows.slice(0, 8).map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.merchant}</td><td className="mono">{money(r.amount, r.currency)}</td><td>{r.category}</td><td>{r.paymentMethod}</td><td>{when(r.occurredAt)}</td></tr>)}</DataTable>{rows.length > 8 && <p className="muted-copy">Showing first 8 rows of {rows.length} validated rows.</p>}</>}{result && <div className="import-result"><ShieldCheck size={18} /><div><b>Import finished</b><span>{result.accepted} accepted · {result.rejected} rejected</span>{result.errors.map((e, i) => <small key={i}>{e}</small>)}</div></div>}{importMutation.isError && <div className="inline-error">Import failed. Your file was not confirmed as imported; retry when ready.</div>}</section><aside className="panel import-aside"><div className="eyebrow">CSV REQUIREMENTS</div><h3>Keep rows predictable.</h3><ul><li><Check size={14} /> Required: amount, currency, merchant</li><li><Check size={14} /> Required: category, paymentMethod</li><li><Check size={14} /> Required: occurredAt (ISO timestamp recommended)</li><li><Check size={14} /> Optional: customerId, location, deviceId</li></ul><div className="notice"><CircleHelp size={15} /><span>Imported transactions are assessed by the current rules engine. Risk signals still require human review.</span></div></aside></div>
  </div>;
}

function Audit() {
  const q = useListAuditLogs({ query: { queryKey: getListAuditLogsQueryKey() } });
  const rows = q.data || [];
  return <div><PageTitle eyebrow="SYSTEM RECORD" title="Audit log" detail="Recorded actions and entity references from the operational workflow." /><section className="panel"><div className="filterbar"><div className="panel-intro"><LockKeyhole size={15} /> Append-only activity history</div><span className="result-count">{rows.length} events</span></div><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()} empty={!rows.length}><DataTable columns={['TIMESTAMP', 'ACTOR', 'ACTION', 'ENTITY', 'ENTITY ID', 'METADATA']} min="900px">{rows.map((e) => <tr key={e.id} data-testid={`row-audit-${e.id}`}><td className="mono">{when(e.createdAt)}</td><td>{e.actor || 'System'}</td><td><span className="audit-action">{e.action}</span></td><td>{e.entityType}</td><td className="mono">{e.entityId}</td><td className="metadata-cell">{e.metadata || '—'}</td></tr>)}</DataTable></QueryState></section></div>;
}

function SettingsPage() {
  const q = useGetSettings();
  const save = useUpdateSettings();
  const client = useQueryClient();
  const [values, setValues] = useState({ mediumThreshold: 35, highThreshold: 60, criticalThreshold: 80, alertThreshold: 65 });
  const [initialized, setInitialized] = useState(false);
  useEffect(() => { if (q.data && !initialized) { setValues({ mediumThreshold: q.data.mediumThreshold, highThreshold: q.data.highThreshold, criticalThreshold: q.data.criticalThreshold, alertThreshold: q.data.alertThreshold }); setInitialized(true); } }, [q.data, initialized]);
  function update(key: keyof typeof values, value: string) { setValues((v) => ({ ...v, [key]: Number(value) })); }
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ data: values }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); } });
  }
  const [dark, setDark] = useState(() => localStorage.getItem('fraudlens-theme') === 'dark');
  function changeTheme(v: boolean) { setDark(v); document.documentElement.classList.toggle('dark', v); localStorage.setItem('fraudlens-theme', v ? 'dark' : 'light'); }
  return <div><PageTitle eyebrow="WORKSPACE PREFERENCES" title="Settings" detail="Manage risk labels, alert creation, and your display preference." /><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data && <div className="settings-grid"><form className="panel settings-form" onSubmit={submit}><PanelHeader title="Risk thresholds" meta={`SCORING ${q.data.scoringVersion}`} /><p className="muted-copy">Thresholds are score boundaries from 0 to 100. Keep each higher band above the one before it.</p><div className="settings-fields">{([['mediumThreshold', 'Medium threshold', 'Beginning of medium risk band'], ['highThreshold', 'High threshold', 'Beginning of high risk band'], ['criticalThreshold', 'Critical threshold', 'Beginning of critical risk band'], ['alertThreshold', 'Alert threshold', 'Score that triggers an alert'] ] as const).map(([key, label, hint]) => <label className="threshold-input" key={key}><span><b>{label}</b><small>{hint}</small></span><input type="number" min="1" max="100" value={values[key]} onChange={(e) => update(key, e.target.value)} data-testid={`input-${key}`} /></label>)}</div>{save.isError && <div className="inline-error">Thresholds were not saved. Review the values and try again.</div>}{save.isSuccess && <div className="success-copy"><Check size={14} /> Thresholds saved.</div>}<div className="form-submit"><span>Changes apply to future scoring.</span><Button type="submit" disabled={save.isPending} data-testid="button-save-settings">{save.isPending ? 'Saving…' : 'Save thresholds'}</Button></div></form><section className="panel appearance-panel"><PanelHeader title="Appearance" meta="LOCAL PREFERENCE" /><p className="muted-copy">Choose how FraudLens is displayed on this device.</p><button className="theme-option" onClick={() => changeTheme(false)}><span className="theme-swatch light-swatch"><Sun size={15} /></span><span><b>Light</b><small>Warm ivory canvas</small></span>{!dark && <Check size={16} />}</button><button className="theme-option" onClick={() => changeTheme(true)}><span className="theme-swatch dark-swatch"><Moon size={15} /></span><span><b>Dark</b><small>Deep slate workspace</small></span>{dark && <Check size={16} />}</button><div className="note-banner"><CircleHelp size={15} /><span>Theme choice is saved in this browser only.</span></div></section></div>}</QueryState></div>;
}

function Project() {
  return <div><PageTitle eyebrow="ACADEMIC PROJECT" title="Project notes" detail="FraudLens AI · transaction risk signal and case-management prototype." /><section className="project-hero"><div><span className="eyebrow">FINANCIAL SECURITY OPERATIONS</span><h2>Explainable risk signals.<br /><em>Human-owned outcomes.</em></h2></div><span className="project-stamp">ACADEMIC<br />PROJECT / 01</span></section><div className="project-grid"><section className="panel project-copy"><div className="eyebrow">PURPOSE</div><h3>Make review work legible.</h3><p>FraudLens is an academic transaction monitoring interface for inspecting risk assessments, triaging alerts, and documenting investigation decisions. It connects operational records to explanations and review actions so analysts can follow what happened and why.</p><p>The project emphasizes transparent scoring and a complete human review loop rather than automated fraud determinations.</p></section><section className="panel project-copy"><div className="eyebrow">SCOPE & LIMITATIONS</div><h3>Operational aid, not verdict.</h3><ul className="plain-list"><li>Rule-based scoring with visible thresholds</li><li>Alerts and case workflow for human investigation</li><li>Audit events for recorded system actions</li><li>No trained machine-learning model or probability output</li><li>Predictions are not proof; reviewers own outcomes</li></ul></section></div><section className="panel architecture"><PanelHeader title="Architecture & data flow" meta="CONCEPTUAL SYSTEM MAP" /><div className="flow-diagram"><div className="flow-node"><span>01</span><b>Transaction records</b><small>Imported or submitted</small></div><ArrowRight /><div className="flow-node flow-active"><span>02</span><b>Rules scorer</b><small>Conditions + thresholds</small></div><ArrowRight /><div className="flow-node"><span>03</span><b>Risk assessment</b><small>Score + explanation</small></div><ArrowRight /><div className="flow-node flow-warm"><span>04</span><b>Human review</b><small>Alert · case · outcome</small></div></div><div className="flow-branch"><span /> Recorded outcomes and audit events remain reviewable alongside source context.</div></section><div className="disclosure-grid"><section className="panel"><div className="eyebrow">DESIGN PRINCIPLE</div><h3>Expose uncertainty.</h3><p>A deterministic score is not a calibrated likelihood. The interface labels outcomes as signals and leaves the final classification to a human analyst.</p></section><section className="panel"><div className="eyebrow">DATA FLOW</div><h3>Trace each decision.</h3><p>Submitted or imported transaction details are assessed, surfaced for review when relevant, and may be handled in a case with analyst notes and a recorded disposition.</p></section></div></div>;
}

function NotFound() {
  return <div className="not-found"><div className="eyebrow">404 / ROUTE NOT FOUND</div><h1>This path is outside the record.</h1><Link href="/" className="button button-outline">Return to FraudLens <ArrowRight size={14} /></Link></div>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <div key={location}>{children}</div>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) client.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your FraudLens workspace' } }, signUp: { start: { title: 'Create your account', subtitle: 'Set up your analyst workspace' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><RoutedErrorBoundary><Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard">{() => <Portal><Dashboard /></Portal>}</Route>
      <Route path="/transactions">{() => <Portal><Transactions /></Portal>}</Route>
      <Route path="/lab">{() => <Portal><Lab /></Portal>}</Route>
      <Route path="/alerts">{() => <Portal><Alerts /></Portal>}</Route>
      <Route path="/investigations">{() => <Portal><Investigations /></Portal>}</Route>
      <Route path="/analytics">{() => <Portal><Analytics /></Portal>}</Route>
      <Route path="/model">{() => <Portal><Model /></Portal>}</Route>
      <Route path="/import">{() => <Portal><ImportPage /></Portal>}</Route>
      <Route path="/audit">{() => <Portal><Audit /></Portal>}</Route>
      <Route path="/settings">{() => <Portal><SettingsPage /></Portal>}</Route>
      <Route path="/project">{() => <Portal><Project /></Portal>}</Route>
      <Route component={NotFound} />
    </Switch></RoutedErrorBoundary></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}
export default App;
