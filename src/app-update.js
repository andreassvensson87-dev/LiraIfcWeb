// Releases are detected without reloading an open model automatically.
export function watchAppUpdate({
  button,
  currentVersion,
  baseUrl,
  beforeUpdate,
  status,
}) {
  const base = new URL(baseUrl, location.href);
  let available = null;
  let checking = null;
  const freshUrl = (file) => {
    const url = new URL(file, base);
    url.searchParams.set("check", Date.now());
    return url;
  };
  const check = () =>
    (checking ||= (async () => {
      try {
        const response = await fetch(freshUrl("app-version.json"), {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("Versionskontrollen misslyckades");
        const { version } = await response.json();
        if (typeof version !== "string" || !version)
          throw new Error("Ogiltig version");
        available = version !== currentVersion ? version : null;
        button.hidden = !available;
      } catch {
        // Network failures must not disturb the viewer or discard a detected update.
      } finally {
        checking = null;
      }
    })());
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await check();
      if (!available) return;
      // Check that the new entry page is available before replacing the running app.
      const response = await fetch(freshUrl("index.html"), {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "Den nya versionen är inte tillgänglig än. Försök igen.",
        );
      const html = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      if (
        html.querySelector('meta[name="lira-app-version"]')?.content !==
        available
      )
        throw new Error(
          "Den nya versionen håller på att publiceras. Försök igen strax.",
        );
      const reason = await beforeUpdate();
      if (reason) {
        status(reason);
        return;
      }
      status("Uppdaterar appen…");
      const url = new URL(location.href);
      url.searchParams.set("lira-update", available);
      location.replace(url.href);
    } catch (error) {
      status(error.message || "Kunde inte uppdatera appen. Försök igen.");
    } finally {
      button.disabled = false;
    }
  });
  const visibleCheck = () => {
    if (!document.hidden) check();
  };
  window.addEventListener("focus", visibleCheck);
  document.addEventListener("visibilitychange", visibleCheck);
  setInterval(visibleCheck, 15 * 60 * 1000);
  check();
}
