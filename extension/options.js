const $ = id => document.getElementById(id);

async function load() {
  const sync = await chrome.storage.sync.get(['backendUrl']);
  $('backend').value = sync.backendUrl || 'http://localhost:3000';
}

$('save').onclick = async () => {
  const backendUrl = $('backend').value.replace(/\/$/, '');
  await chrome.storage.sync.set({ backendUrl });
  $('log').textContent = 'Saved. Backend URL is stored in this Chrome profile. API keys are read by the backend from environment variables.';
};

load().catch(e => $('log').textContent = 'Load error: ' + e.message);
