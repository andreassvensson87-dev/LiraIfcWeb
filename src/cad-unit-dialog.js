import { dxfUnits } from "./cad-units.js";
import { cadBounds } from "./cad-model.js";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function chooseCadUnit(name, data) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "cad-unit-dialog";
    dialog.setAttribute("aria-labelledby", "cad-unit-title");
    dialog.innerHTML = `<h2 id="cad-unit-title">Välj ritningens enhet</h2><p class="cad-placement-filename">${escape(name)}</p><p>Filen saknar en enhet som kan läsas säkert. Vad motsvarar en ritenhet? Valet sparas med filen.</p><form><label class="field-label">Enhet<select name="unit" required aria-label="Ritningens enhet"><option value="" disabled selected>Välj enhet…</option>${dxfUnits.map((u) => `<option value="${u.factor / 1000}">${u.name}</option>`).join("")}</select></label><p class="unit-preview" aria-live="polite"></p><div class="dialog-actions"><button type="button" class="compact" data-unit-cancel>Avbryt</button><button class="primary" type="submit">Öppna ritningen</button></div></form>`;
    const { min, max } = cadBounds(data),
      select = dialog.querySelector("select");
    select.onchange = () => {
      const factor = Number(select.value);
      dialog.querySelector(".unit-preview").textContent =
        `Ungefärlig utbredning: ${max.map((v, i) => ((v - min[i]) * factor).toLocaleString("sv", { maximumFractionDigits: 3 })).join(" × ")} m`;
    };
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      value ? resolve(value) : reject(Error("Importen avbröts."));
    };
    dialog.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const factor = Number(select.value);
      if (factor > 0 && Number.isFinite(factor)) finish(factor);
    };
    dialog.querySelector("[data-unit-cancel]").onclick = () => finish(null);
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(null);
    };
    document.body.append(dialog);
    dialog.showModal();
  });
}
