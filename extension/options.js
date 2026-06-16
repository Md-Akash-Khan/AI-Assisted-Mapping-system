const $ = id => document.getElementById(id);

async function load() {
  const sync = await chrome.storage.sync.get(['backendUrl']);
  const local = await chrome.storage.local.get(['googleApiKey', 'barikoiApiKey']);
  $('backend').value = sync.backendUrl || 'http://localhost:3000';
  // Keep same UI. The only change is that saved keys are restored in this browser,
  // so you do not have to paste them again every time.
  $('google').value = local.googleApiKey || '';
  $('barikoi').value = local.barikoiApiKey || '';
}

$('save').onclick = async () => {
  const backendUrl = $('backend').value.replace(/\/$/, '');
  const googleApiKey = $('google').value.trim();
  const barikoiApiKey = $('barikoi').value.trim();

  await chrome.storage.sync.set({ backendUrl });

  const localSave = {};
  if (googleApiKey) localSave.googleApiKey = googleApiKey;
  if (barikoiApiKey) localSave.barikoiApiKey = barikoiApiKey;
  if (Object.keys(localSave).length) await chrome.storage.local.set(localSave);

  let msg = 'Saved extension backend URL.';
  const body = {};
  if (googleApiKey) body.googleApiKey = googleApiKey;
  if (barikoiApiKey) body.barikoiApiKey = barikoiApiKey;

  if (Object.keys(body).length) {
    try {
      const r = await fetch(backendUrl + '/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      msg += '\nBackend API keys saved: ' + r.status;
      msg += '\nKeys are also saved in this Chrome profile for auto-sync.';
    } catch (e) {
      msg += '\nCould not save backend keys: ' + e.message;
      msg += '\nKeys are still saved in this Chrome profile.';
    }
  }
  $('log').textContent = msg;
};

load().catch(e => $('log').textContent = 'Load error: ' + e.message);
