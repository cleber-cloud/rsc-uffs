/**
 * =============================================================================
 * BLOCO ADITIVO — ANEXOS CONSOLIDADOS RSC-PCCTAE
 * =============================================================================
 * Funções puras (sem UI). Podem ser copiadas para o código-fonte original.
 *
 * Uso:
 *   const resultado = await window.RSCAnexosConsolidados.montarAnexosConsolidados({
 *     selections, documents, criteriaOrder, maxBytes: 190 * 1024 * 1024
 *   });
 *   // resultado.partes[] → { nome, bytes (Uint8Array), numPaginas }
 *   // resultado.comprovantesPorCriterio → { "I.1": "Pág. 1 a 3", ... }
 * =============================================================================
 */
(function (global) {
  "use strict";

  const MAX_BYTES_DEFAULT = 190 * 1024 * 1024; // 190 MB

  function base64ToUint8Array(dataUrlOrB64) {
    if (!dataUrlOrB64) return null;
    let b64 = String(dataUrlOrB64);
    const comma = b64.indexOf(",");
    if (b64.startsWith("data:") && comma >= 0) b64 = b64.slice(comma + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isPdfName(name, type) {
    const n = (name || "").toLowerCase();
    const t = (type || "").toLowerCase();
    return n.endsWith(".pdf") || t.includes("pdf");
  }

  /**
   * Ordena seleções na ordem do rol (I → VI / I.1, I.2, …).
   */
  function ordenarSelections(selections, criteriaOrder) {
    const orderIndex = new Map();
    (criteriaOrder || []).forEach((id, i) => orderIndex.set(id, i));
    return [...(selections || [])]
      .filter((s) => Number(s.quantity) > 0 && s.criterionId)
      .sort((a, b) => {
        const ia = orderIndex.has(a.criterionId)
          ? orderIndex.get(a.criterionId)
          : 9999;
        const ib = orderIndex.has(b.criterionId)
          ? orderIndex.get(b.criterionId)
          : 9999;
        if (ia !== ib) return ia - ib;
        return String(a.criterionId).localeCompare(String(b.criterionId), "pt-BR", {
          numeric: true,
        });
      });
  }

  /**
   * Lista linear de PDFs na ordem dos critérios (e anexos de cada um).
   * Cada item: { criterionId, docId, name, bytes }
   */
  function listarPdfsOrdenados(selections, documents, criteriaOrder) {
    const docMap = new Map();
    (documents || []).forEach((d) => docMap.set(String(d.id), d));

    const ordered = ordenarSelections(selections, criteriaOrder);
    const lista = [];

    for (const sel of ordered) {
      const ids = Array.isArray(sel.documentIds) ? sel.documentIds.map(String) : [];
      // Fallback: arquivos legados em sel.files
      if (!ids.length && Array.isArray(sel.files)) {
        for (const f of sel.files) {
          if (!f || !f.data) continue;
          if (!isPdfName(f.name, f.type)) continue;
          const bytes = base64ToUint8Array(f.data);
          if (bytes && bytes.length) {
            lista.push({
              criterionId: sel.criterionId,
              docId: f.id || f.name,
              name: f.name || "anexo.pdf",
              bytes,
            });
          }
        }
        continue;
      }

      for (const id of ids) {
        const d = docMap.get(id);
        if (!d || !d.data) continue;
        if (!isPdfName(d.name, d.type)) continue;
        const bytes = base64ToUint8Array(d.data);
        if (bytes && bytes.length) {
          lista.push({
            criterionId: sel.criterionId,
            docId: id,
            name: d.name || "anexo.pdf",
            bytes,
          });
        }
      }
    }
    return lista;
  }

  async function contagemPaginasPdf(bytes) {
    const { PDFDocument } = global.PDFLib;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  }

  async function mesclarPdfs(listaBytes) {
    const { PDFDocument } = global.PDFLib;
    const out = await PDFDocument.create();
    for (const bytes of listaBytes) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    const saved = await out.save({ useObjectStreams: false });
    return new Uint8Array(saved);
  }

  /**
   * Distribui documentos em partes ≤ maxBytes sem cortar um PDF.
   * Retorna { partes: [{ docs, bytes, numPaginas, pageStartGlobal }], docMeta: [...] }
   */
  async function particionarSemCortar(docs, maxBytes) {
    const partes = [];
    let atual = [];

    async function fecharAtual() {
      if (!atual.length) return;
      const bytes = await mesclarPdfs(atual.map((d) => d.bytes));
      const numPaginas = await contagemPaginasPdf(bytes);
      partes.push({ docs: atual, bytes, numPaginas });
      atual = [];
    }

    for (const doc of docs) {
      if (!atual.length) {
        atual.push(doc);
        const trial = await mesclarPdfs([doc.bytes]);
        // PDF sozinho > limite: ainda assim vira parte inteira (não cortamos)
        if (trial.byteLength > maxBytes) {
          await fecharAtual();
        }
        continue;
      }

      const trialBytes = await mesclarPdfs([...atual.map((d) => d.bytes), doc.bytes]);
      if (trialBytes.byteLength > maxBytes) {
        await fecharAtual();
        atual.push(doc);
        const alone = await mesclarPdfs([doc.bytes]);
        if (alone.byteLength > maxBytes) {
          await fecharAtual();
        }
      } else {
        atual.push(doc);
      }
    }
    await fecharAtual();

    // Atribui páginas por documento dentro de cada parte
    let pageCursorGlobal = 1;
    const docMeta = []; // por documento na ordem

    for (let pi = 0; pi < partes.length; pi++) {
      const parte = partes[pi];
      let pageInPart = 1;
      for (const doc of parte.docs) {
        const n = await contagemPaginasPdf(doc.bytes);
        const startPart = pageInPart;
        const endPart = pageInPart + n - 1;
        const startGlobal = pageCursorGlobal;
        const endGlobal = pageCursorGlobal + n - 1;
        docMeta.push({
          criterionId: doc.criterionId,
          docId: doc.docId,
          name: doc.name,
          partIndex: pi, // 0-based
          pagesInPart: n,
          startPageInPart: startPart,
          endPageInPart: endPart,
          startPageGlobal: startGlobal,
          endPageGlobal: endGlobal,
        });
        pageInPart += n;
        pageCursorGlobal += n;
      }
      parte.indice = pi + 1;
      parte.nome =
        partes.length === 1
          ? "ANEXOS.pdf"
          : `ANEXOS_parte_${String(pi + 1).padStart(2, "0")}.pdf`;
    }

    return { partes, docMeta, totalPartes: partes.length };
  }

  /**
   * Monta texto da coluna Comprovantes por critério.
   */
  function montarTextosComprovantes(criterionIdsOrdenados, docMeta, totalPartes) {
    const porCriterio = {};

    // Agrupa intervalos por critério e por parte
    const mapa = new Map(); // criterionId -> Map(partIndex -> {min,max})
    for (const m of docMeta) {
      if (!mapa.has(m.criterionId)) mapa.set(m.criterionId, new Map());
      const parts = mapa.get(m.criterionId);
      if (!parts.has(m.partIndex)) {
        parts.set(m.partIndex, {
          min: m.startPageInPart,
          max: m.endPageInPart,
        });
      } else {
        const r = parts.get(m.partIndex);
        r.min = Math.min(r.min, m.startPageInPart);
        r.max = Math.max(r.max, m.endPageInPart);
      }
    }

    function fmtRange(a, b) {
      if (a === b) return `Pág. ${a}`;
      return `Pág. ${a} a ${b}`;
    }

    for (const id of criterionIdsOrdenados) {
      const parts = mapa.get(id);
      if (!parts || parts.size === 0) {
        porCriterio[id] = "Não anexado";
        continue;
      }
      const indices = [...parts.keys()].sort((a, b) => a - b);
      if (totalPartes === 1) {
        const r = parts.get(0);
        porCriterio[id] = fmtRange(r.min, r.max);
      } else {
        porCriterio[id] = indices
          .map((pi) => {
            const r = parts.get(pi);
            const n = String(pi + 1).padStart(2, "0");
            return `${n}º Anexo ${fmtRange(r.min, r.max)}`;
          })
          .join("; ");
      }
    }
    return porCriterio;
  }

  /**
   * API principal.
   * @returns {Promise<{partes, comprovantesPorCriterio, docMeta, totalPartes, semAnexos:boolean}>}
   */
  async function montarAnexosConsolidados(opts) {
    if (!global.PDFLib || !global.PDFLib.PDFDocument) {
      throw new Error("PDFLib não carregado. Inclua pdf-lib.min.js antes deste script.");
    }

    const maxBytes = opts.maxBytes || MAX_BYTES_DEFAULT;
    const criteriaOrder = opts.criteriaOrder || [];
    const pdfs = listarPdfsOrdenados(
      opts.selections || [],
      opts.documents || [],
      criteriaOrder
    );

    const orderedSels = ordenarSelections(opts.selections || [], criteriaOrder);
    const criterionIds = orderedSels.map((s) => s.criterionId);

    if (!pdfs.length) {
      const comprovantesPorCriterio = {};
      criterionIds.forEach((id) => {
        comprovantesPorCriterio[id] = "Não anexado";
      });
      return {
        partes: [],
        docMeta: [],
        totalPartes: 0,
        comprovantesPorCriterio,
        semAnexos: true,
      };
    }

    const { partes, docMeta, totalPartes } = await particionarSemCortar(pdfs, maxBytes);
    const comprovantesPorCriterio = montarTextosComprovantes(
      criterionIds,
      docMeta,
      totalPartes
    );

    // Critérios sem PDF ficam "Não anexado"
    criterionIds.forEach((id) => {
      if (!comprovantesPorCriterio[id]) comprovantesPorCriterio[id] = "Não anexado";
    });

    return {
      partes,
      docMeta,
      totalPartes,
      comprovantesPorCriterio,
      semAnexos: false,
    };
  }

  /**
   * Injeta coluna "Comprovantes" em HTML de requerimento já gerado
   * (fallback se o template original for post-processado).
   */
  function injetarColunaComprovantesNoHtml(html, comprovantesPorCriterio, criteriaById) {
    if (!html || typeof html !== "string") return html;

    // Cabeçalho: após Pontuação obtida
    let out = html.replace(
      /(<th[^>]*>Pontua[cç][aã]o obtida<\/th>)/i,
      '$1\n            <th style="width:120px;text-align:center;">Comprovantes</th>'
    );

    // Subtotal: já costuma ter <td></td> extra; se não, ajusta
    // Linhas de item: tentamos casar por id de critério no texto da linha
    // Estratégia mais segura: se o gerador usar data-criterion-id, preencher.
    // Senão, o hook de exportação gera o HTML completo com a coluna.

    if (comprovantesPorCriterio && criteriaById) {
      // Marcador opcional: <!--COMPROVANTE:I.1--> substituído
      out = out.replace(/<!--COMPROVANTE:([A-Za-z0-9.]+)-->/g, (_, id) => {
        return comprovantesPorCriterio[id] || "Não anexado";
      });
    }

    return out;
  }

  global.RSCAnexosConsolidados = {
    MAX_BYTES_DEFAULT,
    montarAnexosConsolidados,
    listarPdfsOrdenados,
    ordenarSelections,
    injetarColunaComprovantesNoHtml,
    base64ToUint8Array,
  };
})(typeof window !== "undefined" ? window : globalThis);
