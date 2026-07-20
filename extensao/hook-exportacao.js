/**
 * =============================================================================
 * BLOCO ADITIVO — pós-processamento do Pacote Consolidado ORIGINAL
 * =============================================================================
 * NÃO substitui o fluxo do app. Deixa o Assistente gerar o ZIP exatamente como
 * no site (Memorial_Descritivo.html, Requerimento_RSC.html, Anexos/, logos…).
 *
 * Únicas alterações no ZIP baixado:
 *  1) Coluna "Comprovantes" no Requerimento_RSC.html
 *  2) Arquivos ANEXOS.pdf / ANEXOS_parte_XX.pdf (merge, ≤190 MB, sem cortar PDF)
 *
 * Intercepta o download do arquivo RSC_TAE_Consolidado_*.zip (blob).
 * =============================================================================
 */
(function () {
  "use strict";

  const MAX_BYTES = 190 * 1024 * 1024;
  const IDB_NAME = "keyval-store";
  const IDB_STORE = "keyval";
  const STATE_KEY = "rsc-calculator-state";

  let processing = false;

  function toast(msg, type) {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;top:1rem;right:1rem;z-index:99999;max-width:24rem;padding:0.85rem 1rem;" +
      "border-radius:0.5rem;font:600 13px/1.4 Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);" +
      (type === "error"
        ? "background:#fef2f2;color:#991b1b;border:1px solid #fecaca;"
        : type === "info"
          ? "background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;"
          : "background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
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

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Mesma agrupação do app original: por categoria I…VI, ordem de push nas selections.
   */
  function selectionsPorCategoria(state) {
    const meta = window.RSC_CRITERIOS_META || {};
    const c = {};
    (state.selections || []).forEach((sel) => {
      if (!(Number(sel.quantity) > 0)) return;
      const m = meta[sel.criterionId];
      const cat = (m && m.category) || String(sel.criterionId || "").split(".")[0] || "OUTROS";
      if (!c[cat]) c[cat] = [];
      c[cat].push(sel);
    });
    return c;
  }

  /**
   * Injeta coluna Comprovantes no HTML ORIGINAL do requerimento, sem reescrever o resto.
   */
  function injetarColunaNoRequerimentoOriginal(html, comprovantesPorCriterio, state) {
    if (!html || typeof html !== "string") return html;
    let out = html;

    // 1) Cabeçalho — após "Pontuação obtida" (só nas tabelas de critérios)
    out = out.replace(
      /(<th[^>]*>Pontua[cç][aã]o obtida<\/th>)\s*(\r?\n\s*)(<\/tr>)/gi,
      '$1$2<th style="width:130px;text-align:center;">Comprovantes</th>$2$3'
    );

    // 2) Por bloco "Critério X - ...", preencher cada linha de dados
    const byCat = selectionsPorCategoria(state);
    const cats = ["I", "II", "III", "IV", "V", "VI"];

    for (const cat of cats) {
      const sels = byCat[cat] || [];
      if (!sels.length) continue;

      // Localiza o bloco do critério (título + table)
      const titleRe = new RegExp(
        "(Crit[ée]rio\\s+" +
          cat +
          "\\s*[-–—][\\s\\S]*?<table[^>]*class=[\"']criteria-table[\"'][^>]*>)([\\s\\S]*?)(</table>)",
        "i"
      );
      out = out.replace(titleRe, (full, head, body, tail) => {
        let rowIdx = 0;
        // Linhas <tr> que não são subtotal/total
        const newBody = body.replace(/<tr(\s[^>]*)?>[\s\S]*?<\/tr>/gi, (tr) => {
          if (/subtotal-row|total-row/i.test(tr)) return tr;
          // precisa ter células de dados (5 tds típicos)
          const tds = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
          if (tds.length < 5) return tr;
          // se já tem 6ª coluna de comprovantes (reprocessamento), não duplicar
          if (tds.length >= 6 && /N[aã]o anexado|P[aá]g\.|Anexo P[aá]g/i.test(tds[5])) {
            return tr;
          }

          const sel = sels[rowIdx++];
          const texto = sel
            ? comprovantesPorCriterio[sel.criterionId] || "Não anexado"
            : "Não anexado";

          // Insere <td> antes do </tr>
          if (tds.length === 5) {
            return tr.replace(
              /<\/tr>\s*$/i,
              `<td style="text-align:center;font-size:11px;">${esc(texto)}</td>\n      </tr>`
            );
          }
          // Se já há 6ª td vazia (legado do template), substitui a última
          if (tds.length >= 6) {
            let n = 0;
            return tr.replace(/<td[\s\S]*?<\/td>/gi, (td) => {
              n++;
              if (n === 6) {
                return `<td style="text-align:center;font-size:11px;">${esc(texto)}</td>`;
              }
              return td;
            });
          }
          return tr;
        });
        return head + newBody + tail;
      });
    }

    // 3) Linha TOTAL (tfoot): garantir célula extra se necessário
    out = out.replace(
      /(<tr class="total-row">[\s\S]*?<\/tr>)/i,
      (tr) => {
        const tds = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
        // colspan 4 + 1 vazio = 2 tags; com comprovantes queremos +1 vazio
        if (tds.length === 2 && !/colspan="5"/i.test(tr)) {
          return tr.replace(/<\/tr>/i, "<td></td></tr>");
        }
        return tr;
      }
    );

    return out;
  }

  async function enriquecerZipBlob(blob) {
    if (!window.JSZip) throw new Error("JSZip não carregado");
    if (!window.RSCAnexosConsolidados) throw new Error("Módulo de anexos não carregado");
    if (!window.PDFLib) throw new Error("PDFLib não carregado");

    const state = await loadState();
    if (!state) throw new Error("Estado do formulário não encontrado no navegador");

    const zip = await JSZip.loadAsync(blob);

    // --- ANEXOS consolidados (aditivo; mantém pasta Anexos/ original) ---
    const order = window.RSC_CRITERIOS_ORDEM || [];
    const anexos = await window.RSCAnexosConsolidados.montarAnexosConsolidados({
      selections: state.selections || [],
      documents: state.documents || [],
      criteriaOrder: order,
      maxBytes: MAX_BYTES,
    });

    for (const parte of anexos.partes) {
      zip.file(parte.nome, parte.bytes);
    }

    // --- Requerimento original + coluna ---
    const reqFile =
      zip.file("Requerimento_RSC.html") ||
      zip.file(/Requerimento.*\.html$/i)[0];
    if (reqFile) {
      const html = await reqFile.async("string");
      const novo = injetarColunaNoRequerimentoOriginal(
        html,
        anexos.comprovantesPorCriterio,
        state
      );
      zip.file(reqFile.name, novo);
    }

    // Não mexer em Memorial_Descritivo.html, logos, Anexos/ individuais, etc.

    return zip.generateAsync({
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

  /**
   * Intercepta apenas o clique de download do ZIP consolidado gerado pelo app.
   * Qualquer outro download (backup, etc.) segue normal.
   */
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
          const anchor = this;
          const href = anchor.href;
          const download = anchor.download;

          processing = true;
          toast("Preparando pacote (coluna Comprovantes + ANEXOS)…", "info");

          (async () => {
            try {
              const res = await fetch(href);
              const originalBlob = await res.blob();
              const newBlob = await enriquecerZipBlob(originalBlob);
              const url = URL.createObjectURL(newBlob);
              const a = document.createElement("a");
              a.href = url;
              a.download = download;
              // usar click nativo para não reentrar no patch de forma errada
              nativeClick.call(a);
              setTimeout(() => URL.revokeObjectURL(url), 3000);
              toast("Pacote consolidado pronto (original + ANEXOS + Comprovantes).", "success");
            } catch (err) {
              console.error("[RSC Extensão]", err);
              toast(
                "Falha ao enriquecer pacote; baixando original. " + (err.message || ""),
                "error"
              );
              // fallback: download original intacto
              try {
                nativeClick.call(anchor);
              } catch (_) {}
            } finally {
              processing = false;
              try {
                URL.revokeObjectURL(href);
              } catch (_) {}
            }
          })();
          return; // não dispara o click original agora
        }
      } catch (e) {
        console.error(e);
      }
      return nativeClick.apply(this, arguments);
    };

    console.info(
      "[RSC Extensão] Pós-processamento do Pacote Consolidado ativo (sem alterar o restante do app)."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installDownloadHook);
  } else {
    installDownloadHook();
  }

  window.RSCExtensaoExportacao = {
    enriquecerZipBlob,
    injetarColunaNoRequerimentoOriginal,
    loadState,
  };
})();
