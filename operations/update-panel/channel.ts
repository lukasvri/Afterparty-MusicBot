import {
  viewState,
  frozenRequest,
  stages,
  parsePanelState,
  type PanelState,
  type PanelStep,
  type Confirmation,
} from "./model.ts";
// Local source for the private operations UI. No deployment starts on selection.
function readSelection() {
  try {
    return sessionStorage.getItem("afterparty-update-channel");
  } catch {
    return null;
  }
}
function initializeChannelPicker() {
  const panel = document.querySelector<HTMLElement>("#afterparty-beta-panel");
  const workspace = document.querySelector<HTMLElement>("#project-content");
  if (panel && workspace && workspace.querySelector(".project-switcher")) {
    const find = <T extends HTMLElement = HTMLElement>(name: string): T => {
      const element = panel.querySelector<T>(`[data-beta="${name}"]`);
      if (!element) throw new Error(`Missing reviewed panel element: ${name}`);
      return element;
    };
    const picker = document.createElement("div");
    picker.id = "afterparty-channel-picker";
    picker.hidden = true;
    picker.innerHTML =
      '<label for="afterparty-channel">Versjon</label><select id="afterparty-channel"><option value="production">Produksjon</option><option value="beta">Beta</option></select><a class="site-link" href="https://ap.beta.openworks.no/" target="_blank" rel="noreferrer" data-channel-link>Åpne betasiden ↗</a>';
    const select = picker.querySelector("select")!;
    let channel = readSelection() === "beta" ? "beta" : "production";
    select.value = channel;
    let preferredProject: string | null = null;
    let restoreScheduled = false;
    try {
      preferredProject = sessionStorage.getItem("afterparty-update-project");
    } catch {
      /* Project selection remains available without browser storage. */
    }
    const sync = () => {
      const header = workspace.querySelector(".project-header");
      if (!header) return;
      const activeName = workspace
        .querySelector(
          '.project-switcher button[aria-pressed="true"] .project-name strong',
        )
        ?.textContent?.trim();
      if (
        preferredProject &&
        activeName !== preferredProject &&
        !restoreScheduled
      ) {
        const choice = [
          ...workspace.querySelectorAll<HTMLButtonElement>(
            ".project-switcher button",
          ),
        ].find(
          (b) =>
            b.querySelector(".project-name strong")?.textContent?.trim() ===
            preferredProject,
        );
        if (choice) {
          restoreScheduled = true;
          queueMicrotask(() => {
            restoreScheduled = false;
            choice.click();
          });
        }
      }
      const afterparty = activeName === "Afterparty";
      if (picker.parentElement !== header) header.appendChild(picker);
      if (panel.previousElementSibling !== header)
        header.parentNode?.insertBefore(panel, header.nextSibling);
      const beta = afterparty && channel === "beta";
      if (!beta && find<HTMLDialogElement>("dialog").open)
        find<HTMLDialogElement>("dialog").close();
      if (picker.hidden === afterparty) picker.hidden = !afterparty;
      if (panel.hidden === beta) panel.hidden = !beta;
      if (workspace.classList.contains("afterparty-beta-selected") !== beta)
        workspace.classList.toggle("afterparty-beta-selected", beta);
      workspace.classList.toggle("afterparty-channel-enabled", afterparty);
      const siteLink = picker.querySelector<HTMLAnchorElement>(
        "[data-channel-link]",
      )!;
      siteLink.href = beta
        ? "https://ap.beta.openworks.no/"
        : "https://ap.openworks.no/";
      siteLink.textContent = beta ? "Åpne betasiden ↗" : "Åpne nettsiden ↗";
    };
    select.addEventListener("change", () => {
      find<HTMLDialogElement>("dialog").close();
      selected = null;
      channel = select.value === "beta" ? "beta" : "production";
      try {
        sessionStorage.setItem("afterparty-update-channel", channel);
      } catch {
        /* Selection still works without storage. */
      }
      sync();
      if (channel === "beta") refresh();
    });
    // Observe project switches only. Status polling does not recreate the selector.
    const projectNav = workspace.querySelector(".project-switcher");
    if (projectNav)
      new MutationObserver(sync).observe(projectNav, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["aria-pressed"],
      });
    new MutationObserver(sync).observe(workspace, { childList: true });
    projectNav?.addEventListener("click", (event) => {
      const choice =
        event.target instanceof Element ? event.target.closest("button") : null;
      const name = choice
        ?.querySelector(".project-name strong")
        ?.textContent?.trim();
      if (!name) return;
      preferredProject = name;
      try {
        sessionStorage.setItem("afterparty-update-project", name);
      } catch {
        /* Retain the current in-memory project selection. */
      }
    });
    sync();
    const status = find("status"),
      check = find<HTMLButtonElement>("check"),
      open = find<HTMLButtonElement>("open");
    const dialog = find<HTMLDialogElement>("dialog"),
      confirm = find<HTMLButtonElement>("confirm");
    let state: PanelState = {};
    let busy = false;
    let selected: Readonly<Confirmation> | null = null;
    const api = async (
      action: "status" | "check" | "run",
      body?: Record<string, unknown> | Readonly<Confirmation>,
    ): Promise<PanelState> => {
      const response = await fetch(`/afterparty-update/api/beta/${action}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers:
          body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "X-CSRF-Token":
                  document.querySelector<HTMLMetaElement>('meta[name="csrf"]')
                    ?.content || "",
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = parsePanelState(await response.json());
      if (!response.ok)
        throw new Error(
          value.error || "Kunne ikke hente betastatus. Last siden på nytt.",
        );
      return value;
    };
    const short = (sha: unknown) =>
      typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha)
        ? sha.slice(0, 12)
        : "Ikke registrert";
    const render = (value: PanelState) => {
      state = value;
      const view = viewState(value);
      status.textContent = view.message;
      const done = view.updated;
      find("headline").textContent = view.headline;
      find("ribbon").className = "status-ribbon " + (done ? "good" : "neutral");
      find("current").textContent = short(view.current);
      find("candidate").textContent = short(value.commit);
      find("checked").textContent = value.checked_at
        ? new Date(value.checked_at * 1000).toLocaleString("nb-NO", {
            timeZone: "Europe/Oslo",
          })
        : "Ikke kontrollert";
      find("stage").textContent = view.progressLabel;
      find("action-title").textContent = view.actionTitle;
      const list = find("steps");
      list.replaceChildren();
      const stepValues: PanelStep[] =
        Array.isArray(value.steps) && value.steps.length
          ? value.steps
          : stages.map(([name, label]) => ({
              label,
              status:
                value.stage === "done"
                  ? "done"
                  : value.running && name === value.stage
                    ? "running"
                    : "pending",
            }));
      for (const step of stepValues) {
        const li = document.createElement("li");
        li.className = ["done", "succeeded", "success"].includes(step.status)
          ? "done"
          : step.status === "running"
            ? "running"
            : step.status === "failed"
              ? "failed"
              : "";
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent =
          li.className === "done"
            ? "✓"
            : li.className === "running"
              ? "◉"
              : "○";
        li.appendChild(icon);
        li.appendChild(
          document.createTextNode(step.label || step.name || "Kontroll"),
        );
        list.appendChild(li);
      }
      find("error").textContent = view.error;
      find("error").hidden = !view.error;
      check.disabled =
        busy ||
        value.running === true ||
        value.checking === true ||
        view.retrySeconds > 0;
      check.textContent = value.checking
        ? "Sjekker beta…"
        : view.retrySeconds > 0
          ? `Prøv igjen om ${Math.ceil(view.retrySeconds / 60)} min`
          : "Sjekk status";
      open.disabled = busy || !view.ready;
      open.textContent = value.running ? "Oppdaterer beta…" : "Oppdater beta";
    };
    const refresh = async () => {
      try {
        render(await api("status"));
      } catch (error) {
        status.textContent =
          error instanceof Error
            ? error.message
            : "Kunne ikke hente betastatus. Last siden på nytt.";
        open.disabled = true;
      }
    };
    check.addEventListener("click", async () => {
      busy = true;
      render(state);
      try {
        await api("check", {});
      } catch (error) {
        status.textContent =
          error instanceof Error
            ? error.message
            : "Kunne ikke hente betastatus. Last siden på nytt.";
      } finally {
        busy = false;
        await refresh();
      }
    });
    open.addEventListener("click", () => {
      if (channel !== "beta") return;
      selected = frozenRequest(state);
      if (!selected) return;
      find("commit").textContent = selected.commit;
      find("dialog-error").textContent = "";
      dialog.showModal();
    });
    find("cancel").addEventListener("click", () => {
      dialog.close();
      selected = null;
    });
    dialog.addEventListener("cancel", () => {
      selected = null;
    });
    confirm.addEventListener("click", async () => {
      if (!selected || busy || channel !== "beta" || panel.hidden) return;
      busy = true;
      confirm.disabled = true;
      try {
        await api("run", selected);
        dialog.close();
        selected = null;
      } catch (error) {
        find("dialog-error").textContent =
          error instanceof Error
            ? error.message
            : "Kunne ikke hente betastatus. Last siden på nytt.";
      } finally {
        busy = false;
        confirm.disabled = false;
        await refresh();
      }
    });
    refresh();
    setInterval(() => {
      if (!document.hidden && !busy && !panel.hidden) refresh();
    }, 5000);
  }

  return Boolean(
    panel && workspace && workspace.querySelector(".project-switcher"),
  );
}
if (!initializeChannelPicker()) {
  const hydration = new MutationObserver(() => {
    if (initializeChannelPicker()) hydration.disconnect();
  });
  hydration.observe(
    document.querySelector("#operations-panel") || document.body,
    { childList: true, subtree: true },
  );
}
