/**
 * =============================================================================
 * ANEXOS I–VI com capa (modelo COMPROVANTES / REQUISITO) — pt-BR
 * =============================================================================
 */
(function (global) {
  "use strict";

  const CATS = ["I", "II", "III", "IV", "V", "VI"];

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

  function itemNumeroFromId(criterionId) {
    const id = String(criterionId || "");
    const m = id.match(/^[IVX]+\.(\d+)/i);
    return m ? m[1] : id;
  }

  async function contagemPaginasPdf(bytes) {
    const { PDFDocument } = global.PDFLib;
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  }

  /**
   * Desenha capa(s) com fonte maior e texto em português correto.
   */
  async function adicionarCapas(outPdf, opts, fonts) {
    const { font, fontBold } = fonts;
    const wrap = global.RSCPdfFontes.wrapText;
    const fmt = global.RSCPdfFontes.fmtPt;
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 50;
    const maxW = pageWidth - margin * 2;
    const black = global.PDFLib.rgb(0.05, 0.05, 0.05);

    // Tamanhos aumentados
    const SZ = {
      anexo: 20,
      requisito: 13,
      item: 12.5,
      tabela: 11,
      tabelaHead: 11,
      comprovantesTitulo: 14,
      comprovantesItem: 12,
    };

    let page = outPdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - 64;
    let coverPages = 1;

    function newPage() {
      page = outPdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - 64;
      coverPages++;
    }

    function ensureSpace(h) {
      if (y - h < 48) newPage();
    }

    function drawLines(lines, size, bold, lineH, align) {
      for (const ln of lines) {
        ensureSpace(lineH + 2);
        const f = bold ? fontBold : font;
        let x = margin;
        if (align === "center") {
          x = (pageWidth - f.widthOfTextAtSize(ln, size)) / 2;
        }
        page.drawText(ln, {
          x,
          y: y - size,
          size,
          font: f,
          color: black,
        });
        y -= lineH;
      }
    }

    // ANEXO X
    drawLines([`ANEXO ${opts.category}`], SZ.anexo, true, 28, "center");
    y -= 20;

    // REQUISITO em CAIXA ALTA
    const reqTitle = `REQUISITO ${opts.category} - ${String(
      opts.categoryTitle || ""
    ).toUpperCase()}`;
    drawLines(
      wrap(reqTitle, fontBold, SZ.requisito, maxW),
      SZ.requisito,
      true,
      18,
      "left"
    );
    y -= 16;

    // Item
    const itemHead = `Item ${opts.itemNum} - ${opts.itemDescription || ""}`;
    drawLines(
      wrap(itemHead, font, SZ.item, maxW),
      SZ.item,
      false,
      17,
      "left"
    );
    y -= 20;

    // Tabela
    const rowH = 26;
    ensureSpace(rowH * 3 + 16);
    const col1 = margin;
    const col2 = margin + maxW * 0.55;
    const tableTop = y;
    const tableW = maxW;

    page.drawRectangle({
      x: col1,
      y: tableTop - rowH * 3,
      width: tableW,
      height: rowH * 3,
      borderColor: black,
      borderWidth: 1,
    });
    page.drawLine({
      start: { x: col1, y: tableTop - rowH },
      end: { x: col1 + tableW, y: tableTop - rowH },
      thickness: 0.8,
      color: black,
    });
    page.drawLine({
      start: { x: col1, y: tableTop - rowH * 2 },
      end: { x: col1 + tableW, y: tableTop - rowH * 2 },
      thickness: 0.8,
      color: black,
    });
    page.drawLine({
      start: { x: col2, y: tableTop },
      end: { x: col2, y: tableTop - rowH * 3 },
      thickness: 0.8,
      color: black,
    });

    const cellPad = 8;
    const mid1 = tableTop - rowH * 0.5 - SZ.tabelaHead / 2;
    const mid2 = tableTop - rowH * 1.5 - SZ.tabela / 2;
    const mid3 = tableTop - rowH * 2.5 - SZ.tabela / 2;

    page.drawText("UNIDADE DE MEDIDA", {
      x: col1 + cellPad,
      y: mid1,
      size: SZ.tabelaHead,
      font: fontBold,
      color: black,
    });
    page.drawText("PONTOS", {
      x: col2 + cellPad,
      y: mid1,
      size: SZ.tabelaHead,
      font: fontBold,
      color: black,
    });
    page.drawText(String(opts.unit || "—"), {
      x: col1 + cellPad,
      y: mid2,
      size: SZ.tabela,
      font,
      color: black,
    });
    page.drawText(fmt(opts.pointsPerUnit), {
      x: col2 + cellPad,
      y: mid2,
      size: SZ.tabela,
      font,
      color: black,
    });
    const q = Number(opts.quantity) || 0;
    const total = q * (Number(opts.pointsPerUnit) || 0);
    page.drawText(`Total de ${String(q).padStart(2, "0")} unidade(s)`, {
      x: col1 + cellPad,
      y: mid3,
      size: SZ.tabela,
      font,
      color: black,
    });
    page.drawText(
      `Total (${fmt(opts.pointsPerUnit)} × ${q}) = ${fmt(total)}`,
      {
        x: col2 + cellPad,
        y: mid3,
        size: SZ.tabela,
        font: fontBold,
        color: black,
      }
    );

    y = tableTop - rowH * 3 - 32;

    drawLines(["COMPROVANTES:"], SZ.comprovantesTitulo, true, 22, "left");
    y -= 8;

    const lista = opts.comprovantes || [];
    if (!lista.length) {
      drawLines(
        ["Nenhum comprovante em PDF anexado a este item."],
        SZ.comprovantesItem,
        false,
        17,
        "left"
      );
    } else {
      // Descrição em peso normal; "pág. x a y" em negrito
      lista.forEach((c, idx) => {
        const size = SZ.comprovantesItem;
        const lineH = 17;
        const pag =
          c.startPage === c.endPage
            ? `(pág. ${c.startPage})`
            : `(pág. ${c.startPage} a ${c.endPage})`;
        const body = `${idx + 1}- ${c.title || c.name || "Comprovante"}`;
        const lines = wrap(body, font, size, maxW);
        const spaceW = font.widthOfTextAtSize(" ", size);
        const pagW = fontBold.widthOfTextAtSize(pag, size);

        lines.forEach((ln, i) => {
          ensureSpace(lineH + 2);
          const isLast = i === lines.length - 1;
          const baseY = y - size;
          page.drawText(ln, {
            x: margin,
            y: baseY,
            size,
            font,
            color: black,
          });
          if (isLast) {
            const lnW = font.widthOfTextAtSize(ln, size);
            if (lnW + spaceW + pagW <= maxW) {
              page.drawText(pag, {
                x: margin + lnW + spaceW,
                y: baseY,
                size,
                font: fontBold,
                color: black,
              });
              y -= lineH;
            } else {
              y -= lineH;
              ensureSpace(lineH + 2);
              page.drawText(pag, {
                x: margin,
                y: y - size,
                size,
                font: fontBold,
                color: black,
              });
              y -= lineH;
            }
          } else {
            y -= lineH;
          }
        });
        y -= 6;
      });
    }

    return coverPages;
  }

  async function mesclarPaginas(outPdf, srcBytes) {
    const { PDFDocument } = global.PDFLib;
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pages = await outPdf.copyPages(src, src.getPageIndices());
    pages.forEach((p) => outPdf.addPage(p));
    return src.getPageCount();
  }

  function docsDaSelecao(sel, docMap) {
    const ids = Array.isArray(sel.documentIds) ? sel.documentIds.map(String) : [];
    const out = [];
    for (const id of ids) {
      const d = docMap.get(id);
      if (!d || !d.data) continue;
      if (!isPdfName(d.name, d.type)) continue;
      const bytes = base64ToUint8Array(d.data);
      if (!bytes || !bytes.length) continue;
      out.push({
        id,
        name: d.name || "anexo.pdf",
        title: String(d.title || "").trim(),
        bytes,
      });
    }
    if (!out.length && Array.isArray(sel.files)) {
      for (const f of sel.files) {
        if (!f || !f.data || !isPdfName(f.name, f.type)) continue;
        const bytes = base64ToUint8Array(f.data);
        if (!bytes || !bytes.length) continue;
        out.push({
          id: f.id || f.name,
          name: f.name || "anexo.pdf",
          title: String(f.title || f.name || "").trim(),
          bytes,
        });
      }
    }
    return out;
  }

  function ordenarSelections(selections, criteriaOrder) {
    const orderIndex = new Map();
    (criteriaOrder || []).forEach((id, i) => orderIndex.set(id, i));
    return [...(selections || [])]
      .filter((s) => Number(s.quantity) > 0 && s.criterionId)
      .sort((a, b) => {
        const ia = orderIndex.has(a.criterionId) ? orderIndex.get(a.criterionId) : 9999;
        const ib = orderIndex.has(b.criterionId) ? orderIndex.get(b.criterionId) : 9999;
        if (ia !== ib) return ia - ib;
        return String(a.criterionId).localeCompare(String(b.criterionId), "pt-BR", {
          numeric: true,
        });
      });
  }

  function listarSemDescricao(selections, documents) {
    const docMap = new Map();
    (documents || []).forEach((d) => docMap.set(String(d.id), d));
    const faltando = [];
    for (const sel of selections || []) {
      if (!(Number(sel.quantity) > 0)) continue;
      const ids = Array.isArray(sel.documentIds) ? sel.documentIds.map(String) : [];
      for (const id of ids) {
        const d = docMap.get(id);
        if (!d) continue;
        if (!isPdfName(d.name, d.type)) continue;
        if (!(d.title && String(d.title).trim())) {
          faltando.push({
            criterionId: sel.criterionId,
            docId: id,
            name: d.name,
          });
        }
      }
    }
    return faltando;
  }

  async function montarItemPdf(item, cat, catTitle, pageCursorStart, fonts) {
    const { PDFDocument } = global.PDFLib;

    async function build(coverPagesGuess) {
      const pdf = await PDFDocument.create();
      // re-embed fonts no PDF temporário
      const itemFonts = await global.RSCPdfFontes.embedNoto(pdf);
      let next = pageCursorStart + coverPagesGuess;
      const comprovantes = item.docs.map((d) => {
        const start = next;
        const end = next + d.pageCount - 1;
        next = end + 1;
        return {
          title: d.title,
          name: d.name,
          startPage: start,
          endPage: end,
        };
      });
      const coverPages = await adicionarCapas(
        pdf,
        {
          category: cat,
          categoryTitle: catTitle,
          itemNum: itemNumeroFromId(item.criterionId),
          itemDescription: item.description,
          unit: item.unit,
          pointsPerUnit: item.pointsPerUnit,
          quantity: item.quantity,
          comprovantes,
        },
        itemFonts
      );
      for (const d of item.docs) {
        await mesclarPaginas(pdf, d.bytes);
      }
      return { pdf, coverPages };
    }

    let { pdf, coverPages } = await build(1);
    if (coverPages !== 1) {
      ({ pdf, coverPages } = await build(coverPages));
    }
    const bytes = new Uint8Array(await pdf.save({ useObjectStreams: false }));
    const totalPages = await contagemPaginasPdf(bytes);
    return { bytes, totalPages, coverPages };
  }

  async function montarAnexosPorCategoria(opts) {
    if (!global.PDFLib || !global.PDFLib.PDFDocument) {
      throw new Error("PDFLib não carregado.");
    }
    if (!global.RSCPdfFontes) {
      throw new Error("RSCPdfFontes não carregado.");
    }

    const meta = opts.criteriaMeta || global.RSC_CRITERIOS_META || {};
    const catTitles = opts.categorias || global.RSC_CATEGORIAS || {};
    const criteriaOrder = opts.criteriaOrder || global.RSC_CRITERIOS_ORDEM || [];
    const selections = ordenarSelections(opts.selections || [], criteriaOrder);
    const docMap = new Map();
    (opts.documents || []).forEach((d) => docMap.set(String(d.id), d));

    const byCat = {};
    for (const cat of CATS) byCat[cat] = [];

    for (const sel of selections) {
      const m = meta[sel.criterionId];
      const cat = (m && m.category) || String(sel.criterionId).split(".")[0];
      if (!byCat[cat]) continue;
      const docs = docsDaSelecao(sel, docMap);
      if (!docs.length) continue;
      const docsWithPages = [];
      for (const d of docs) {
        const n = await contagemPaginasPdf(d.bytes);
        docsWithPages.push({ ...d, pageCount: n });
      }
      byCat[cat].push({
        criterionId: sel.criterionId,
        description: (m && m.description) || sel.criterionId,
        unit: (m && m.unit) || "",
        pointsPerUnit: (m && m.pointsPerUnit) || 0,
        quantity: Number(sel.quantity) || 0,
        docs: docsWithPages,
      });
    }

    const anexos = [];
    const { PDFDocument } = global.PDFLib;

    for (const cat of CATS) {
      const items = byCat[cat];
      if (!items.length) continue;

      const outPdf = await PDFDocument.create();
      let pageCursor = 1;

      for (const item of items) {
        const { bytes, totalPages } = await montarItemPdf(
          item,
          cat,
          catTitles[cat] || "",
          pageCursor,
          null
        );
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await outPdf.copyPages(src, src.getPageIndices());
        pages.forEach((p) => outPdf.addPage(p));
        pageCursor += totalPages;
      }

      const saved = await outPdf.save({ useObjectStreams: false });
      anexos.push({
        category: cat,
        nomeArquivo: `Anexo ${cat}.pdf`,
        bytes: new Uint8Array(saved),
        numPaginas: pageCursor - 1,
      });
    }

    return { anexos, semAnexos: anexos.length === 0 };
  }

  async function montarAnexosConsolidados(opts) {
    const r = await montarAnexosPorCategoria(opts);
    return {
      partes: r.anexos.map((a) => ({
        nome: a.nomeArquivo,
        bytes: a.bytes,
        numPaginas: a.numPaginas,
        category: a.category,
      })),
      comprovantesPorCriterio: {},
      docMeta: [],
      totalPartes: r.anexos.length,
      semAnexos: r.semAnexos,
    };
  }

  global.RSCAnexosConsolidados = {
    montarAnexosPorCategoria,
    montarAnexosConsolidados,
    listarSemDescricao,
    ordenarSelections,
    base64ToUint8Array,
    CATS,
  };
})(typeof window !== "undefined" ? window : globalThis);
