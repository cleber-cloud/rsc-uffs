/**
 * Importador de backup compatível com o site original UFFS.
 * Resolve falhas comuns na versão file:// e dá mensagens claras.
 *
 * - Intercepta o input "Carregar Dados" (.json / .zip)
 * - Painel flutuante de importação com log
 * - Grava em IndexedDB (keyval-store / rsc-calculator-state) + localStorage
 */
(function () {
  "use strict";

  const IDB_NAME = "keyval-store";
  const IDB_STORE = "keyval";
  const STATE_KEY = "rsc-calculator-state";

  function log(msg, type) {
    console[type === "error" ? "error" : "log"]("[Importar backup]", msg);
    const el = document.getElementById("rsc-import-log");
    if (el) {
      const line = document.createElement("div");
      line.style.color =
        type === "error" ? "#991b1b" : type === "ok" ? "#065f46" : "#1e3a5f";
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
    // toast
    const t = document.createElement("div");
    t.style.cssText =
      "position:fixed;top:1rem;right:1rem;z-index:100000;max-width:22rem;padding:0.75rem 1rem;" +
      "border-radius:0.5rem;font:600 13px/1.4 Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);" +
      (type === "error"
        ? "background:#fef2f2;color:#991b1b;border:1px solid #fecaca;"
        : type === "ok"
          ? "background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;"
          : "background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  function idbSet(key, value) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME);
      } catch (e) {
        reject(e);
        return;
      }
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.close();
          const req2 = indexedDB.open(IDB_NAME, (db.version || 1) + 1);
          req2.onupgradeneeded = () => {
            if (!req2.result.objectStoreNames.contains(IDB_STORE)) {
              req2.result.createObjectStore(IDB_STORE);
            }
          };
          req2.onsuccess = () => {
            put(req2.result);
          };
          req2.onerror = () => reject(req2.error);
          return;
        }
        put(db);
      };

      function put(db) {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  function findZipFile(zip, path) {
    if (!path) return null;
    let f = zip.file(path);
    if (f) return f;
    const clean = path.replace(/^\//, "");
    f = zip.file(clean);
    if (f) return f;
    // case-insensitive / partial
    const lower = clean.toLowerCase();
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    let hit = names.find((n) => n.toLowerCase() === lower);
    if (hit) return zip.file(hit);
    const base = clean.split("/").pop();
    hit = names.find((n) => n.split("/").pop().toLowerCase() === (base || "").toLowerCase());
    return hit ? zip.file(hit) : null;
  }

  function findDadosJson(zip) {
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const exact = names.find((n) => n === "dados.json" || n.endsWith("/dados.json"));
    if (exact) return zip.file(exact);
    const ci = names.find((n) => n.toLowerCase().endsWith("dados.json"));
    if (ci) return zip.file(ci);
    // consolidado nosso
    const resumo = names.find((n) => n.toLowerCase().includes("dados_resumo"));
    if (resumo) return { __resumo: true, file: zip.file(resumo) };
    return null;
  }

  function normalizeState(raw) {
    const documentsIn = Array.isArray(raw.documents) ? raw.documents : [];
    const docs = documentsIn.map((e) => ({
      id: String((e && e.id) || Math.random().toString(36).slice(2, 9)),
      name: String((e && e.name) || "arquivo"),
      data: String((e && e.data) || ""),
      type: String((e && e.type) || "application/pdf"),
    }));

    let selections = Array.isArray(raw.selections) ? raw.selections : [];
    selections = selections
      .map((e) => {
        let documentIds = Array.isArray(e.documentIds)
          ? e.documentIds.map(String)
          : [];
        // legado: files[] dentro da selection
        if (
          Array.isArray(e.files) &&
          e.files.length > 0 &&
          documentIds.length === 0
        ) {
          e.files.forEach((f) => {
            const id = Math.random().toString(36).slice(2, 9);
            docs.push({
              id,
              name: String((f && f.name) || "arquivo"),
              data: String((f && f.data) || ""),
              type: String((f && f.type) || "application/pdf"),
            });
            documentIds.push(id);
          });
        }
        return {
          criterionId: String((e && e.criterionId) || ""),
          quantity: Number(e && e.quantity) || 0,
          description: e && e.description ? String(e.description) : undefined,
          originalDescription:
            e && e.originalDescription
              ? String(e.originalDescription)
              : undefined,
          documentIds,
        };
      })
      .filter((e) => e.quantity > 0 && e.criterionId);

    const u = (raw && raw.user) || {};
    const prev = (raw && raw.previousRsc) || {};

    return {
      version: (raw && raw.version) || "1.0.0",
      user: {
        name: String(u.name || ""),
        siape: String(u.siape || ""),
        email: String(u.email || ""),
        role: String(u.role || ""),
        unit: String(u.unit || ""),
        currentLevel: String(u.currentLevel || u.level || ""),
        targetLevelId: String(u.targetLevelId || ""),
        currentIq: String(u.currentIq || ""),
        dateOfEntry: String(u.dateOfEntry || u.admissionDate || ""),
        roleFunction: String(u.roleFunction || u.functionTitle || ""),
      },
      selections,
      documents: docs,
      previousRsc: {
        hasPrevious: prev.hasPrevious === true,
        balance: String(prev.balance || ""),
        processNumber: String(prev.processNumber || ""),
        lastConcessionDate: String(prev.lastConcessionDate || ""),
      },
      trajectoryNarrative: String(
        (raw && raw.trajectoryNarrative) || ""
      ),
    };
  }

  async function hydrateDocsFromZip(state, zip) {
    if (!state.documents) return state;
    for (const doc of state.documents) {
      if (doc.data && doc.data.length > 50) continue;
      const path = doc.zipPath || (doc.id && null);
      // try zipPath field
      if (doc.zipPath) {
        const f = findZipFile(zip, doc.zipPath);
        if (f) {
          const b64 = await f.async("base64");
          doc.data = "data:" + (doc.type || "application/pdf") + ";base64," + b64;
        }
      }
    }
    // Also re-scan raw selections files with zipPath (already normalized into documents)
    return state;
  }

  async function importFromZip(file) {
    if (!window.JSZip) {
      throw new Error(
        "JSZip não carregou. Abra a pasta aplicacao pelo comece aqui.html completo."
      );
    }
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    log("Arquivos no ZIP: " + names.slice(0, 12).join(", ") + (names.length > 12 ? "…" : ""));

    // Pacote consolidado (não é backup de preenchimento)
    const isConsolidado =
      names.some((n) => /Requerimento_RSC/i.test(n)) &&
      !names.some((n) => /dados\.json$/i.test(n));
    if (isConsolidado) {
      throw new Error(
        'Este parece o "Pacote consolidado" (Requerimento/Memorial), não o backup de dados. No site original use o botão "Salvar Dados" (nome costuma começar com backup_rsc_tae).'
      );
    }

    const dadosEntry = findDadosJson(zip);
    if (!dadosEntry) {
      throw new Error(
        'ZIP sem dados.json. Use o arquivo gerado por "Salvar Dados" no site original (não o Pacote consolidado).'
      );
    }
    if (dadosEntry.__resumo) {
      throw new Error(
        "Este ZIP tem apenas resumo (dados_resumo.json), sem formulário completo. Exporte de novo com Salvar Dados no site original."
      );
    }

    const rawText = await dadosEntry.async("string");
    let raw;
    try {
      raw = JSON.parse(rawText);
    } catch {
      throw new Error("dados.json não é um JSON válido.");
    }

    // Anexar base64 dos documents a partir do zip
    if (Array.isArray(raw.documents)) {
      for (const doc of raw.documents) {
        if (doc.zipPath) {
          const f = findZipFile(zip, doc.zipPath);
          if (f) {
            const b64 = await f.async("base64");
            doc.data =
              "data:" + (doc.type || "application/pdf") + ";base64," + b64;
          } else {
            log("Aviso: anexo não encontrado no ZIP: " + doc.zipPath, "error");
          }
        }
      }
    }
    if (Array.isArray(raw.selections)) {
      for (const sel of raw.selections) {
        if (!Array.isArray(sel.files)) continue;
        for (const f of sel.files) {
          if (f.zipPath) {
            const zf = findZipFile(zip, f.zipPath);
            if (zf) {
              const b64 = await zf.async("base64");
              f.data =
                "data:" + (f.type || "application/pdf") + ";base64," + b64;
            }
          }
        }
      }
    }

    return normalizeState(raw);
  }

  async function importFromJson(file) {
    const text = await file.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Arquivo JSON inválido.");
    }
    return normalizeState(raw);
  }

  async function saveAndReload(state) {
    const nSel = (state.selections || []).length;
    const nDoc = (state.documents || []).length;
    const name = (state.user && state.user.name) || "(sem nome)";
    log(
      `Backup OK: servidor "${name}", ${nSel} item(ns), ${nDoc} documento(s). Gravando…`
    );

    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      log("Salvo em localStorage.");
    } catch (e) {
      log("localStorage falhou: " + e.message, "error");
    }

    try {
      await idbSet(STATE_KEY, state);
      log("Salvo em IndexedDB (mesmo local do app).", "ok");
    } catch (e) {
      log(
        "IndexedDB falhou (" +
          e.message +
          "). O app pode ainda ler o localStorage após o patch de leitura.",
        "error"
      );
    }

    log("Recarregando a página em 1s…", "ok");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  async function handleFile(file) {
    if (!file) return;
    const name = file.name || "";
    log("Lendo: " + name + " (" + Math.round(file.size / 1024) + " KB)");
    try {
      let state;
      if (name.toLowerCase().endsWith(".zip")) {
        state = await importFromZip(file);
      } else if (name.toLowerCase().endsWith(".json")) {
        state = await importFromJson(file);
      } else {
        // tenta zip/json pelo conteúdo
        try {
          state = await importFromZip(file);
        } catch {
          state = await importFromJson(file);
        }
      }

      if (!state.user) {
        throw new Error("Backup sem dados de usuário (user).");
      }
      // selections pode ser vazio se só preencheu dados pessoais
      await saveAndReload(state);
    } catch (err) {
      console.error(err);
      log(err.message || String(err), "error");
    }
  }

  /**
   * Garante que o app leia localStorage se IndexedDB estiver vazio (file://).
   */
  function installIdbLocalStorageBridge() {
    const origOpen = indexedDB.open.bind(indexedDB);
    // Não monkey-patch open; em vez disso, pré-carrega IDB a partir do localStorage
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || !state.user) return;
      // fire-and-forget seed
      idbSet(STATE_KEY, state).then(
        () => console.info("[Importar backup] IDB alimentado a partir do localStorage"),
        () => {}
      );
    } catch (_) {}
  }

  function injectPanel() {
    if (document.getElementById("rsc-import-panel")) return;
    const panel = document.createElement("div");
    panel.id = "rsc-import-panel";
    panel.innerHTML = `
      <details open style="
        position:fixed;bottom:5.5rem;left:1rem;z-index:99990;max-width:22rem;
        background:#fff;border:1px solid #d0e6d7;border-radius:0.75rem;
        box-shadow:0 10px 30px rgba(7,32,19,.15);font:14px/1.4 Segoe UI,sans-serif;
        color:#16362a;">
        <summary style="cursor:pointer;font-weight:700;padding:0.75rem 1rem;background:#edf7f0;border-radius:0.75rem 0.75rem 0 0;color:#008037">
          Importar backup (site UFFS)
        </summary>
        <div style="padding:0.75rem 1rem 1rem">
          <p style="margin:0 0 0.6rem;font-size:12px;color:#62756e">
            Use o arquivo do botão <strong>Salvar Dados</strong> do site original
            (<code>backup_rsc_tae_….zip</code> ou <code>.json</code>).
            Não use o “Pacote consolidado”.
          </p>
          <label style="display:inline-flex;align-items:center;gap:0.4rem;background:#008037;color:#fff;
            font-weight:700;font-size:12px;padding:0.55rem 0.9rem;border-radius:0.45rem;cursor:pointer">
            Escolher arquivo…
            <input id="rsc-import-input" type="file" accept=".zip,.json,application/zip,application/json" style="display:none" />
          </label>
          <div id="rsc-import-log" style="margin-top:0.65rem;max-height:8rem;overflow:auto;font-size:11px;background:#f8faf9;padding:0.4rem;border-radius:0.35rem"></div>
        </div>
      </details>
    `;
    document.body.appendChild(panel);
    document.getElementById("rsc-import-input").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      handleFile(f);
      e.target.value = "";
    });
  }

  /**
   * Intercepta o input original "Carregar Dados" (accept .json,.zip).
   */
  function installCapture() {
    document.addEventListener(
      "change",
      function (ev) {
        const t = ev.target;
        if (!t || t.tagName !== "INPUT" || t.type !== "file") return;
        const acc = (t.accept || "").toLowerCase();
        if (!acc.includes("json") && !acc.includes("zip")) return;
        // nosso painel
        if (t.id === "rsc-import-input") return;

        const f = t.files && t.files[0];
        if (!f) return;

        // Processamos nós (mais confiável no file://) e evitamos o handler React falho
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        handleFile(f);
        try {
          t.value = "";
        } catch (_) {}
      },
      true
    );
  }

  function boot() {
    installIdbLocalStorageBridge();
    installCapture();
    injectPanel();
    console.info("[Importar backup] Pronto — use o painel ou Carregar Dados.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.RSCImportarBackup = { handleFile, normalizeState };
})();
