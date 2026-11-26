// Fetch once per page. The version belongs to the copy of the game being served.
export async function showAppVersion() {
  try {
    const response = await fetch(new URL('./package.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const { version } = await response.json();
    if (typeof version !== 'string' || !version) throw new Error('Missing package version');
    for (const label of document.querySelectorAll('[data-app-version]')) {
      label.querySelector('span').textContent = version;
      label.hidden = false;
    }
  } catch (error) {
    console.warn('Could not load the game version.', error);
  }
}
