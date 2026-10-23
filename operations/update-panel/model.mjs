/** Safe display state shared by the real panel and isolated tests. */
export const stages = [
  ['validate', 'Kontroller kilde og GitHub-tester'],
  ['api', 'Bygg og publiser betaens API'],
  ['frontend', 'Bygg og publiser betaens frontend'],
  ['verify', 'Kontroller betasiden og forbindelsen'],
  ['done', 'Lagre kontrollert resultat']
];
export function viewState(value = {}) {
  const running = value.running === true;
  const checking = value.checking === true;
  const failed = ['blocked', 'failed'].includes(value.stage);
  const checkFailed = failed && value.operation === 'check';
  const current = typeof value.current_commit === 'string' ? value.current_commit : value.deployed_commit || value.last_deployment_commit;
  const sameVersion = value.available === false && current && current === value.commit;
  const updated = !running && !checking && !failed && (value.stage === 'done' || sameVersion);
  const ready = value.ready === true && value.available !== false && !running && !checking && !failed;
  const retrySeconds = typeof value.retry_after === 'number' ? Math.max(0, Math.ceil(value.retry_after - Date.now()/1000)) : 0;
  return {
    retrySeconds,
    current,
    updated,
    ready,
    error: failed ? value.error || value.message || '' : '',
    headline: checking ? 'Kontrollerer betaversjonen' : running ? 'Betaoppdatering pågår' : checkFailed ? 'Statuskontrollen ble ikke fullført' : failed ? 'Betaoppdateringen trenger oppfølging' : updated ? 'Beta er oppdatert' : ready ? 'Ny betaversjon er klar' : 'Sjekk betaversjonen',
    message: checkFailed && typeof value.retry_after === 'number' ? (retrySeconds > 0 ? `GitHub begrenser statuskontroller akkurat nå. Prøv igjen om omtrent ${Math.ceil(retrySeconds/60)} minutter. Ingen oppdatering er startet.` : 'Ventetiden fra GitHub er over. Trykk «Sjekk status» for en ny kontroll. Ingen oppdatering er startet.') : updated ? 'Siste kontrollerte betaversjon er allerede på nett. Ingen oppdatering er nødvendig.' : value.message || 'Kontroller GitHub-versjonen før du oppdaterer.',
    progressLabel: running ? 'Oppdatering pågår' : value.progress_kind === 'last' ? 'Siste fullførte oppdatering' : failed ? 'Ikke fullført' : value.stage === 'done' ? 'Fullført' : 'Ingen oppdatering pågår',
    actionTitle: updated ? 'Beta er oppdatert' : ready ? 'Publiser ny betaversjon' : checking ? 'Kontrollerer betaversjonen' : checkFailed ? 'Prøv statuskontrollen igjen' : failed ? 'Kontroller feilen før nytt forsøk' : 'Sjekk før du oppdaterer'
  };
}
export function frozenRequest(state) {
  if (!viewState(state).ready || !/^[a-f0-9]{40}$/.test(state.commit || '') || !/^[a-f0-9]{64}$/.test(state.confirmation_id || '')) return null;
  return Object.freeze({commit:state.commit, confirmation_id:state.confirmation_id, confirm:true});
}
