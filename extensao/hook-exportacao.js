/**
 * =============================================================================
 * Pacote consolidado RSC
 * =============================================================================
 * 01 - Requerimento_RSC.html   (HTML original, com brasão/logos)
 * 02 - Memorial_Descritivo.html
 * 03+ - Anexo I…VI.pdf         (capas + comprovantes)
 *
 * Não inclui arquivos soltos da pasta Anexos/.
 * =============================================================================
 */
(function () {
  "use strict";

  const IDB_NAME = "keyval-store";
  const IDB_STORE = "keyval";
  const STATE_KEY = "rsc-calculator-state";
  let processing = false;

  function toast(msg, type) {
    if (type === "error") console.error("[RSC Export]", msg);
    else console.info("[RSC Export]", msg);
    try {
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;bottom:1.25rem;left:50%;transform:translateX(-50%);z-index:99999;" +
        "max-width:min(36rem,92vw);padding:0.75rem 1rem;border-radius:0.75rem;font:600 13px/1.4 system-ui,sans-serif;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.18);color:#fff;" +
        (type === "error"
          ? "background:#b91c1c;"
          : type === "success"
            ? "background:#008037;"
            : "background:#0f766e;");
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), type === "error" ? 8000 : 4000);
    } catch (_) {}
  }

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          resolve(null);
          return;
        }
        const tx = db.transaction(IDB_STORE, "readonly");
        const g = tx.objectStore(IDB_STORE).get(key);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error);
      };
    });
  }

  async function loadState() {
    let raw = await idbGet(STATE_KEY);
    if (!raw) {
      try {
        raw = localStorage.getItem(STATE_KEY);
      } catch (_) {}
    }
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function pickZipFile(zip, exact, pattern) {
    return zip.file(exact) || (zip.file(pattern) || [])[0] || null;
  }

  /**
   * Copia só o brasão (os HTMLs usam brasão, não o logo da instituição).
   */
  async function copiarAssetsVisuais(srcZip, outZip) {
    const wanted = [/^brasao_instituicao\.(png|jpe?g|svg)$/i, /^brasao/i];
    const added = new Set();

    for (const path of Object.keys(srcZip.files)) {
      const f = srcZip.files[path];
      if (f.dir) continue;
      if (/^anexos\//i.test(path)) continue;
      const base = path.split("/").pop();
      // não incluir logo da instituição
      if (/^logo/i.test(base)) continue;
      if (!wanted.some((re) => re.test(base) || re.test(path))) continue;
      if (added.has(base)) continue;
      outZip.file(base, await f.async("uint8array"));
      added.add(base);
    }

    // Fallback se o ZIP não trouxe brasão e o HTML usar caminho relativo
    if (![...added].some((n) => /brasao/i.test(n))) {
      for (const url of ["./brasaodarepublica.png", "./brasao_instituicao.png"]) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          outZip.file(
            "brasao_instituicao.png",
            new Uint8Array(await res.arrayBuffer())
          );
          break;
        } catch (_) {}
      }
    }
  }

  /**
   * Ajusta referências de imagem no HTML para arquivos na raiz do pacote.
   */
  function normalizarHtml(html) {
    let out = String(html || "");
    // remove coluna Comprovantes se existir (legado)
    out = out.replace(/<th[^>]*>\s*Comprovantes\s*<\/th>/gi, "");
    out = out.replace(
      /<td[^>]*>\s*(N[aã]o anexado|P[aá]g\.|Anexo P[aá]g)[\s\S]*?<\/td>/gi,
      ""
    );
    // brasão relativo → raiz do pacote
    out = out.replace(
      /src=(["'])(?:\.\/)?(?:[^"']*\/)?(brasao_instituicao\.(?:png|jpe?g|svg))\1/gi,
      "src=$1$2$1"
    );
    return out;
  }

  async function montarPacote(originalZipBlob) {
    if (!window.JSZip) throw new Error("JSZip não carregado");
    if (!window.RSCAnexosConsolidados) {
      throw new Error("Módulo de anexos não carregado");
    }
    if (!window.PDFLib) throw new Error("PDFLib não carregado");

    const state = await loadState();
    if (!state) {
      throw new Error("Estado do formulário não encontrado no navegador");
    }

    const faltando = window.RSCAnexosConsolidados.listarSemDescricao(
      state.selections || [],
      state.documents || []
    );
    if (faltando.length) {
      const amostra = faltando
        .slice(0, 3)
        .map((f) => `${f.criterionId}: ${f.name}`)
        .join("; ");
      throw new Error(
        `Há ${faltando.length} anexo(s) sem descrição breve. Preencha "Descreva brevemente o anexo" (${amostra}).`
      );
    }

    const srcZip = await JSZip.loadAsync(originalZipBlob);
    const out = new JSZip();
    let seq = 1;

    // 01 Requerimento HTML
    const reqFile = pickZipFile(
      srcZip,
      "Requerimento_RSC.html",
      /Requerimento.*\.html$/i
    );
    if (!reqFile) throw new Error("Requerimento_RSC.html não encontrado no pacote");
    const reqHtml = normalizarHtml(await reqFile.async("string"));
    out.file(`${pad2(seq)} - Requerimento_RSC.html`, reqHtml);
    seq++;

    // 02 Memorial HTML
    const memFile = pickZipFile(
      srcZip,
      "Memorial_Descritivo.html",
      /Memorial.*\.html$/i
    );
    if (!memFile) throw new Error("Memorial_Descritivo.html não encontrado no pacote");
    const memHtml = normalizarHtml(await memFile.async("string"));
    out.file(`${pad2(seq)} - Memorial_Descritivo.html`, memHtml);
    seq++;

    // Logos / brasão para o HTML abrir completo
    await copiarAssetsVisuais(srcZip, out);

    // 03+ Anexos PDF
    if (window.RSCPdfFontes) {
      try {
        await window.RSCPdfFontes.loadFontBytes();
      } catch (e) {
        console.warn("[RSC Export] Fontes:", e);
      }
    }

    toast("Gerando Anexos I–VI com capas…", "info");
    const { anexos } = await window.RSCAnexosConsolidados.montarAnexosPorCategoria({
      selections: state.selections || [],
      documents: state.documents || [],
      criteriaOrder: window.RSC_CRITERIOS_ORDEM || [],
      criteriaMeta: window.RSC_CRITERIOS_META,
      categorias: window.RSC_CATEGORIAS,
    });

    for (const a of anexos) {
      out.file(`${pad2(seq)} - ${a.nomeArquivo}`, a.bytes);
      seq++;
    }

    return out.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
  }

  function isConsolidadoDownload(anchor) {
    if (!anchor || !anchor.download) return false;
    const d = String(anchor.download);
    return /RSC_TAE_Consolidado/i.test(d) && /\.zip$/i.test(d);
  }

  function installDownloadHook() {
    const nativeClick = HTMLAnchorElement.prototype.click;

    HTMLAnchorElement.prototype.click = function patchedClick() {
      try {
        if (
          !processing &&
          isConsolidadoDownload(this) &&
          this.href &&
          String(this.href).startsWith("blob:")
        ) {
          const href = this.href;
          const download = String(this.download || "RSC_TAE_Consolidado.zip");
          processing = true;
          toast("Preparando pacote (HTML + Anexos PDF)…", "info");

          (async () => {
            try {
              const res = await fetch(href);
              const originalBlob = await res.blob();
              const newBlob = await montarPacote(originalBlob);
              const url = URL.createObjectURL(newBlob);
              const a = document.createElement("a");
              a.href = url;
              a.download = download.replace(/\.zip$/i, "_pacote.zip");
              nativeClick.call(a);
              setTimeout(() => URL.revokeObjectURL(url), 4000);
              toast(
                "Pacote pronto: 01–02 HTML, 03+ Anexos em PDF.",
                "success"
              );
            } catch (err) {
              console.error("[RSC Extensão]", err);
              toast(err.message || "Falha ao gerar pacote.", "error");
            } finally {
              processing = false;
              try {
                URL.revokeObjectURL(href);
              } catch (_) {}
            }
          })();
          return;
        }
      } catch (e) {
        console.error(e);
      }
      return nativeClick.apply(this, arguments);
    };

    console.info(
      "[RSC Export] 01 Requerimento.html · 02 Memorial.html · 03+ Anexos.pdf"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installDownloadHook);
  } else {
    installDownloadHook();
  }

  window.RSCExtensaoExportacao = {
    montarPacote,
    loadState,
  };
})();
