import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const source = await readFile(
  new URL("../src/app-update.js", import.meta.url),
  "utf8",
);
function setup() {
  const classes = new Set(),
    events = {},
    messages = [],
    urls = [];
  const button = {
    hidden: true,
    disabled: false,
    classList: {
      toggle: (name, active) =>
        active ? classes.add(name) : classes.delete(name),
    },
    addEventListener: (name, callback) => {
      events[name] = callback;
    },
  };
  let version = "current",
    failure = false,
    htmlVersion = "next",
    blocked = null;
  const context = {
    URL,
    Date,
    AbortSignal,
    location: {
      href: "https://example.com/LiraIfcWeb/",
      replace: (url) => urls.push(url),
    },
    window: { addEventListener() {} },
    document: { hidden: false, addEventListener() {} },
    setInterval() {},
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => ({ content: htmlVersion }) };
      }
    },
    fetch: async () => {
      if (failure) throw Error("offline");
      return {
        ok: true,
        json: async () => ({ version }),
        text: async () => "html",
      };
    },
  };
  runInNewContext(
    source.replace("export function", "function") +
      "\nglobalThis.watch = watchAppUpdate;",
    context,
  );
  context.watch({
    button,
    currentVersion: "current",
    baseUrl: "./",
    beforeUpdate: async () => blocked,
    status: (message) => messages.push(message),
  });
  return {
    button,
    classes,
    messages,
    urls,
    click: () => events.click(),
    setVersion: (v) => {
      version = v;
    },
    fail: (v) => {
      failure = v;
    },
    block: (v) => {
      blocked = v;
    },
    setHtml: (v) => {
      htmlVersion = v;
    },
  };
}
test("Update control is always visible and reports an up-to-date version", async () => {
  const app = setup();
  assert.equal(app.button.hidden, false);
  await app.click();
  assert.equal(app.button.textContent, "Sök uppdatering");
  assert.match(app.messages.at(-1), /senaste versionen/);
  assert.equal(app.button.disabled, false);
  assert.equal(app.urls.length, 0);
});
test("Failed checks report failure and keep a previously detected update", async () => {
  const app = setup();
  await app.click();
  app.setVersion("next");
  app.block("Vänta tills importen är klar.");
  await app.click();
  assert.equal(app.button.textContent, "Uppdatera appen");
  assert.equal(app.classes.has("update-available"), true);
  app.fail(true);
  await app.click();
  assert.match(app.messages.at(-1), /Kunde inte söka/);
  assert.equal(app.button.hidden, false);
  assert.equal(app.button.textContent, "Uppdatera appen");
  assert.equal(app.urls.length, 0);
});
test("Release verification and active import guard prevent premature reloads", async () => {
  const app = setup();
  await app.click();
  app.setVersion("next");
  app.setHtml("current");
  await app.click();
  assert.match(app.messages.at(-1), /håller på att publiceras/);
  assert.equal(app.urls.length, 0);
  app.setHtml("next");
  app.block("Import pågår");
  await app.click();
  assert.equal(app.messages.at(-1), "Import pågår");
  assert.equal(app.urls.length, 0);
  app.block(null);
  await app.click();
  assert.equal(new URL(app.urls[0]).searchParams.get("lira-update"), "next");
});
