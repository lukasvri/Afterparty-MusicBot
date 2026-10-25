export interface PanelStep {
  label?: string;
  name?: string;
  status: string;
}
export interface PanelState {
  running?: boolean;
  checking?: boolean;
  ready?: boolean;
  available?: boolean;
  stage?: string;
  operation?: string;
  current_commit?: string;
  deployed_commit?: string;
  last_deployment_commit?: string;
  commit?: string;
  confirmation_id?: string;
  retry_after?: number;
  checked_at?: number;
  error?: string;
  message?: string;
  progress_kind?: string;
  steps?: PanelStep[];
}
export interface Confirmation {
  readonly commit: string;
  readonly confirmation_id: string;
  readonly confirm: true;
}

/** Treat server JSON as untrusted data before displaying state or enabling a command. */
export function parsePanelState(value: unknown): PanelState {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Ugyldig betastatus. Last siden på nytt.");
  const raw = value as Record<string, unknown>;
  const state: PanelState = {};
  for (const key of ["running", "checking", "ready", "available"] as const) {
    if (typeof raw[key] === "boolean") state[key] = raw[key];
  }
  for (const key of [
    "stage",
    "operation",
    "current_commit",
    "deployed_commit",
    "last_deployment_commit",
    "commit",
    "confirmation_id",
    "error",
    "message",
    "progress_kind",
  ] as const) {
    if (typeof raw[key] === "string") state[key] = raw[key];
  }
  for (const key of ["retry_after", "checked_at"] as const) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key]))
      state[key] = raw[key];
  }
  if (Array.isArray(raw.steps))
    state.steps = raw.steps.flatMap((step: unknown) => {
      if (!step || typeof step !== "object") return [];
      const fields = step as Record<string, unknown>;
      return typeof fields.status === "string"
        ? [
            {
              status: fields.status,
              ...(typeof fields.label === "string"
                ? { label: fields.label }
                : {}),
              ...(typeof fields.name === "string" ? { name: fields.name } : {}),
            },
          ]
        : [];
    });
  return state;
}

/** Safe display state shared by the real panel and isolated tests. */
export const stages = [
  ["validate", "Kontroller kilde og GitHub-tester"],
  ["api", "Bygg og publiser betaens API"],
  ["frontend", "Bygg og publiser betaens frontend"],
  ["verify", "Kontroller betasiden og forbindelsen"],
  ["done", "Lagre kontrollert resultat"],
];
export function viewState(value: PanelState = {}) {
  const running = value.running === true;
  const checking = value.checking === true;
  const failed = ["blocked", "failed"].includes(value.stage ?? "");
  const checkFailed = failed && value.operation === "check";
  const current =
    typeof value.current_commit === "string"
      ? value.current_commit
      : value.deployed_commit || value.last_deployment_commit;
  const sameVersion =
    value.available === false && current && current === value.commit;
  const updated =
    !running && !checking && !failed && (value.stage === "done" || sameVersion);
  const ready =
    value.ready === true &&
    value.available !== false &&
    !running &&
    !checking &&
    !failed;
  const retrySeconds =
    typeof value.retry_after === "number"
      ? Math.max(0, Math.ceil(value.retry_after - Date.now() / 1000))
      : 0;
  return {
    retrySeconds,
    current,
    updated,
    ready,
    error: failed ? value.error || value.message || "" : "",
    headline: checking
      ? "Kontrollerer betaversjonen"
      : running
        ? "Betaoppdatering pågår"
        : checkFailed
          ? "Statuskontrollen ble ikke fullført"
          : failed
            ? "Betaoppdateringen trenger oppfølging"
            : updated
              ? "Beta er oppdatert"
              : ready
                ? "Ny betaversjon er klar"
                : "Sjekk betaversjonen",
    message:
      checkFailed && typeof value.retry_after === "number"
        ? retrySeconds > 0
          ? `GitHub begrenser statuskontroller akkurat nå. Prøv igjen om omtrent ${Math.ceil(retrySeconds / 60)} minutter. Ingen oppdatering er startet.`
          : "Ventetiden fra GitHub er over. Trykk «Sjekk status» for en ny kontroll. Ingen oppdatering er startet."
        : updated
          ? "Siste kontrollerte betaversjon er allerede på nett. Ingen oppdatering er nødvendig."
          : value.message || "Kontroller GitHub-versjonen før du oppdaterer.",
    progressLabel: projectProgress("beta", value).label,
    actionTitle: updated
      ? "Beta er oppdatert"
      : ready
        ? "Publiser ny betaversjon"
        : checking
          ? "Kontrollerer betaversjonen"
          : checkFailed
            ? "Prøv statuskontrollen igjen"
            : failed
              ? "Kontroller feilen før nytt forsøk"
              : "Sjekk før du oppdaterer",
  };
}
export function frozenRequest(
  state: PanelState,
): Readonly<Confirmation> | null {
  const { commit, confirmation_id } = state;
  if (
    !viewState(state).ready ||
    typeof commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof confirmation_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(confirmation_id)
  )
    return null;
  return Object.freeze({ commit, confirmation_id, confirm: true });
}

/** The same lifecycle rules are used by every project in OpenWorks Admin. */
export function projectProgress(
  project: "production" | "beta" | "openworks",
  value: unknown,
) {
  const object = (entry: unknown): Record<string, unknown> =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
  const state = object(value),
    progress = object(state.progress),
    update = object(state.update);
  const stage = String(
    project === "production" ? (progress.stage ?? "") : (state.stage ?? ""),
  );
  const checking =
    state.checking === true ||
    update.checking === true ||
    (state.operation === "check" && stage === "checking");
  const checkOnly = state.operation === "check";
  const running = state.running === true && !checking;
  const failed =
    !checking &&
    !checkOnly &&
    (project === "production"
      ? progress.failed === true || stage === "failed"
      : state.operation === "publish" &&
        ["failed", "blocked", "error"].includes(stage));
  const labels =
    project === "production"
      ? [
          "Hent kilde",
          "Kontroller GitHub-bygg",
          "Oppdater og kontroller bot",
          "Bygg nettsiden i Cloudflare",
          "Kontroller publisering",
          "Kontroller samsvar",
        ]
      : project === "beta"
        ? stages.map(([, label]) => label)
        : [
            "Kontroller kilde og publiseringsstatus",
            "Publiser og kontroller nettsiden",
          ];
  const raw = Array.isArray(progress.steps)
    ? progress.steps
    : Array.isArray(state.steps)
      ? state.steps
      : [];
  let steps: PanelStep[] = labels.map((label, index) => {
    const entry = object(raw[index]);
    const status = entry.status ?? entry.state;
    return {
      label:
        typeof entry.label === "string"
          ? entry.label
          : typeof entry.name === "string"
            ? entry.name
            : label,
      status: ["done", "success", "succeeded"].includes(String(status))
        ? "done"
        : ["running", "current"].includes(String(status))
          ? "running"
          : status === "failed"
            ? "failed"
            : "pending",
    };
  });
  const phases =
    project === "production"
      ? ["prepare", "validate", "core", "cloudflare", "verify"]
      : project === "beta"
        ? ["validate", "cloudflare", "verify"]
        : ["checking", "publishing"];
  const active =
    running &&
    !checkOnly &&
    phases.includes(stage) &&
    state.progress_kind !== "last";
  const kind = checking
    ? "checking"
    : active
      ? "running"
      : running
        ? "waiting"
        : failed
          ? "failed"
          : "planned";
  if (!active && !failed)
    steps = steps.map((step) => ({ ...step, status: "pending" }));
  if (active && project === "production") {
    const index = phases.indexOf(stage);
    steps = steps.map((step, i) => ({
      ...step,
      status: i < index ? "done" : i === index ? "running" : "pending",
    }));
  } else if (active && project === "openworks") {
    steps = steps.map((step, i) => ({
      ...step,
      status:
        stage === "publishing"
          ? i === 0
            ? "done"
            : "running"
          : i === 0
            ? "running"
            : "pending",
    }));
  } else if (active && project === "beta") {
    if (stage === "validate")
      steps = steps.map((step, i) => ({
        ...step,
        status: i === 0 ? "running" : "pending",
      }));
    if (stage === "cloudflare")
      steps = steps.map((step, i) => ({
        ...step,
        status: i === 0 ? "done" : i > 2 ? "pending" : step.status,
      }));
    if (stage === "verify")
      steps = steps.map((step, i) => ({
        ...step,
        status: i < 3 ? "done" : i === 3 ? "running" : "pending",
      }));
  }
  return {
    steps,
    kind,
    label:
      kind === "running"
        ? "Oppdatering pågår"
        : kind === "checking"
          ? "Kontrollerer status"
          : kind === "waiting"
            ? "Venter på oppstart"
            : kind === "failed"
              ? "Oppdateringen ble ikke fullført"
              : "Neste oppdatering",
    note:
      kind === "checking"
        ? "Statuskontroll pågår. Ingen publisering er startet."
        : kind === "running"
          ? "Trinnene gjelder oppdateringen som kjører nå."
          : kind === "waiting"
            ? "Oppdateringen er mottatt, men ingen trinn er bekreftet startet."
            : kind === "failed"
              ? "Bare dokumentert fremdrift fra den avbrutte oppdateringen vises."
              : "Ingen oppdatering er startet. Tidligere resultater finner du under Historikk.",
  };
}

export function progressSteps(value: PanelState): PanelStep[] {
  return projectProgress("beta", value).steps;
}
