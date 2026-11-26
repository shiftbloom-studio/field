// Shared types for field. Type-only: nothing in here exists at runtime.

/** One service field watches, as configured in the APPS var. */
export interface App {
  /** short slug, used in URLs and the database */
  id: string;
  /** display name */
  name: string;
  /** public URL (the "open" button) */
  url?: string;
  /** one line about what it does */
  blurb?: string;
  /** name of a service binding to the app's Worker (preferred for checks) */
  service?: string;
  /** path to probe, default "/" */
  health?: string;
  /** HTTP statuses that count as healthy, default 200–399 */
  expect?: number[];
  /** admin adapter: drop | convert | grow | roots | rhizome | leaf */
  adapter?: string;
  /** name of a D1 binding that is probed alongside the HTTP check */
  db?: string;
  /** "planned" shows a placeholder card without checks */
  status?: string;
  /** source repository URL */
  repo?: string;
  /** text on the placeholder card of a planned service */
  note?: string;
}

export interface Link {
  name: string;
  url: string;
  note?: string;
}

/** Operator details for the imprint and privacy pages (OPERATOR var). */
export interface Operator {
  name: string;
  email: string;
  business?: string;
  street?: string;
  city?: string;
  country?: Localized;
  phone?: string | number;
  vatId?: string;
  authority?: Localized;
}
export type Localized = string | { en?: string; de?: string; [lang: string]: string | undefined };

export interface AlertMail {
  send(message: { from: string | { name: string; email: string }; to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * Bindings and vars. Everything except DB is optional: a missing binding hides its admin screen.
 * Bindings named in APPS (service, db) are looked up by name, hence the index signature.
 */
export interface Env {
  DB: D1Database;
  DROP_DB?: D1Database;
  CONVERT_DB?: D1Database;
  GROW_DB?: D1Database;
  ROOTS_DB?: D1Database;
  RHIZOME_DB?: D1Database;
  LEAF_DB?: D1Database;
  CONVERT_FILES?: R2Bucket;
  LEAF_PASTES?: R2Bucket;
  ROOTS_QUEUE?: Queue<unknown>;
  ALERT_MAIL?: AlertMail;

  APPS?: string | unknown[];
  LINKS?: string | unknown[];
  OPERATOR?: string | Operator | null;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ORG_NAME?: string;
  TZ?: string;
  RETENTION_DAYS?: string;
  SOURCE_URL?: string;
  DEV_BYPASS_ACCESS?: string;
  OWNER_EMAILS?: string;
  DEV_AS_MEMBER?: string;
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  AI_HOURLY_NEURONS?: string | number;
  AI_DAILY_USD?: string | number;
  ACCESS_WATCH_PRODUCTS?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
  ALERT_WEBHOOK?: string;
  [binding: string]: unknown;
}

export interface User {
  email: string;
  /** Listed in OWNER_EMAILS. Everyone else who passes Access is a member. */
  owner: boolean;
}

// ---------- D1 rows of field's own database ----------

export interface StateRow {
  app: string;
  ok: number;
  since: number;
  last_ts: number;
  status: number | null;
  ms: number | null;
  error: string | null;
  fails: number;
  detail: string | null;
}

export interface CheckRow {
  app: string;
  ts: number;
  ok: number;
  status: number | null;
  ms: number | null;
  error: string | null;
}

export interface IncidentRow {
  id: number;
  app: string;
  started_at: number;
  resolved_at: number | null;
  error: string | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor: string;
  app: string;
  action: string;
  target: string | null;
  detail: string | null;
}

/** One probe of one app. */
export interface ProbeResult {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
  detail: string | null;
}

export interface Bucket {
  from: number;
  up: number | null;
  n: number;
  ms?: number | null;
}

// ---------- admin adapters ----------

/** A row from one of the apps' databases, shown in an admin table. */
export type Row = Record<string, any>;

export interface Tile {
  label: string;
  value: unknown;
  hint?: string;
  type?: "size" | "time";
  warn?: boolean;
}

export interface Column {
  key: string;
  label: string;
  type?: "link" | "tag" | "mono" | "size" | "num" | "time" | "time_ms" | "iso" | "flag" | "status" | "muted";
  render?: (row: Row) => unknown;
  href?: (row: Row) => string | null;
  none?: string;
  text?: string;
}

export interface Action {
  action: string;
  label: string;
  confirm?: string;
  danger?: boolean;
  when?: (row: Row) => unknown;
}

export interface Table {
  title: string;
  note?: string;
  empty?: string;
  key?: (row: Row) => unknown;
  columns: Column[];
  rows: Row[];
  rowActions?: Action[];
}

export type Filter =
  | { name: string; type: "search"; placeholder?: string }
  | { name: string; type: "select"; options: [string, string][] }
  | { name: string; type: "check"; label: string };

export interface Panel {
  filters?: Filter[];
  actions?: Action[];
  tables: Table[];
}

export interface ActionResult {
  target: string;
  message: string;
}

export type ActionFn = (env: Env, app: App, form: FormData, ctx?: ExecutionContext) => Promise<ActionResult>;

export interface TokenField {
  name: string;
  label: string;
  type: "select" | "text";
  required?: boolean;
  options?: [string, string][];
  placeholder?: string;
  suggest?: string[];
  when?: { field: string; value: string };
}

export interface TokenRow {
  id: string | number;
  label: string;
  prefix: string;
  owner?: string | null;
  created_at: number | null;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface TokenInput {
  label: string;
  expiresAt: number | null;
  form: FormData;
  user: User;
}

export interface CreatedToken {
  id: string;
  secret: string;
  prefix: string;
  owner?: string;
  usage?: string;
}

export interface TokenProvider {
  binds: string[];
  about: string;
  ownerLabel?: string;
  fields?: (env: Env, app: App, user: User) => Promise<TokenField[]>;
  list: (env: Env, app: App, user: User) => Promise<TokenRow[]>;
  create: (env: Env, t: TokenInput) => Promise<CreatedToken>;
  revoke: (env: Env, id: string, user: User) => Promise<number>;
}

export interface Adapter {
  binds: string[];
  stats: (env: Env, app: App) => Promise<Tile[]>;
  panel: (env: Env, app: App, params: URLSearchParams) => Promise<Panel>;
  actions: Record<string, ActionFn>;
  tokens?: TokenProvider;
}

/** What the token section of an app page gets. */
export interface TokensView {
  rows: TokenRow[];
  fields: TokenField[];
  about: string;
  ownerLabel?: string;
  hasOwner?: boolean;
  error?: string;
}
