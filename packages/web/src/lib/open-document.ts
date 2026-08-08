/**
 * Open a stored document in a new tab (PAC-56 #30).
 *
 * Every document URL the platform hands out is a short-lived presigned GET, so
 * the URL has to be fetched *after* the click. That breaks the naive
 * `window.open(await …)`: by the time the request resolves the browser no
 * longer counts the call as user-initiated and the popup blocker eats it.
 *
 * The fix is the standard one — open the tab synchronously on the click, then
 * point it at the URL when it arrives. `opener` is cleared immediately so the
 * storage origin can never reach back into the app through `window.opener`;
 * passing `noopener` to `window.open` would do the same but returns `null`
 * instead of the handle we still need.
 *
 * The presigned URL is signed for **inline** display, so the browser's own PDF
 * or image viewer renders it and the user downloads from there.
 */
export async function openDocumentInNewTab(
  resolveUrl: () => Promise<string>,
): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;

  try {
    const url = await resolveUrl();
    if (tab) {
      tab.location.href = url;
    } else {
      // Blocked despite the synchronous open (some mobile browsers, or a strict
      // blocker). Navigating the current tab is worse than a second attempt.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    // Leaving a blank tab behind after a failure reads as a broken link.
    tab?.close();
    throw error;
  }
}
