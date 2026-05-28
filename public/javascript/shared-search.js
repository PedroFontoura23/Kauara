/**
 * shared-search.js
 * Kauava — Universal Search System
 *
 * Searches: users (user_Name), posts (title + description),
 *           arts  (title + description), products (name + description)
 *
 * Strategy:
 *   • Firestore range query  →  prefix match on primary field
 *   • Client-side filter      →  also catch matches anywhere in title/name
 *   • Autocomplete dropdown   →  top-5 mixed suggestions (all types)
 *   • Full-panel results      →  triggered on submit / suggestion click
 *
 * Requires: Firebase (app + auth + firestore) already initialised globally.
 * Drop this file AFTER firebase is ready (e.g. after app.js init block).
 */

(function () {
  "use strict";

  /* ─────────────────────────────────────────────────────────────────────────
   *  Wait for Firebase to be ready, then boot
   * ───────────────────────────────────────────────────────────────────────── */
  function waitForFirebase(cb, tries = 0) {
    if (
      typeof firebase !== "undefined" &&
      firebase.apps &&
      firebase.apps.length > 0
    ) {
      cb(firebase.firestore(), firebase.auth());
    } else if (tries < 30) {
      setTimeout(() => waitForFirebase(cb, tries + 1), 200);
    } else {
      console.error("[KauavaSearch] Firebase not ready after 6 s");
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  Icons (inline SVG – no external dep)
   * ───────────────────────────────────────────────────────────────────────── */
  const ICONS = {
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
    post: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>`,
    art: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r="1.2" fill="currentColor" stroke="none"/><path d="M12 21c1.5 0 3-1.5 2-3-1-1.5 1-3 2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    product: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
  };

  const TYPE_META = {
    users:    { label: "Users",    icon: ICONS.user,    color: "#7c6ff7" },
    posts:    { label: "Posts",    icon: ICONS.post,    color: "#f59e0b" },
    arts:     { label: "Arts",     icon: ICONS.art,     color: "#ec4899" },
    products: { label: "Products", icon: ICONS.product, color: "#10b981" },
  };

  /* ─────────────────────────────────────────────────────────────────────────
   *  Helpers
   * ───────────────────────────────────────────────────────────────────────── */
  function safe(str) {
    if (typeof str !== "string") return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function truncate(str, n = 90) {
    if (!str) return "";
    return str.length > n ? str.slice(0, n) + "…" : str;
  }

  /**
   * Firestore "starts-with" range query.
   * Also supports a secondary field for the same collection.
   */
  function prefixQuery(db, col, field, prefix, lim = 10) {
    const end =
      prefix.slice(0, -1) +
      String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
    return db
      .collection(col)
      .where(field, ">=", prefix)
      .where(field, "<", end)
      .limit(lim)
      .get();
  }

  /** Highlight query term inside a text node */
  function highlight(text, query) {
    if (!query || !text) return safe(text);
    const re = new RegExp(
      "(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")",
      "gi"
    );
    return safe(text).replace(re, "<mark>$1</mark>");
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  Inject CSS
   * ───────────────────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById("kauava-search-styles")) return;
    const style = document.createElement("style");
    style.id = "kauava-search-styles";
    style.textContent = `
      /* ── Search wrapper ─────────────────────────────────── */
      #kauava-search-wrap {
        position: relative;
        flex: 1;
        max-width: 520px;
        font-family: inherit;
        outline: none;
      }

      #kauava-search-bar {
        display: flex;
        align-items: center;
        background: transparent;
        border: none;
        border-radius: 0;
        padding: 0;
        gap: 10px;
        box-shadow: none;
        outline: none;
      }

      #kauava-search-bar:focus-within {
        border: none;
        box-shadow: none;
        outline: none;
      }

      /* Ícone de busca - ROXO (#7B5CF0) */
      #ks-search-icon-img {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        filter: brightness(0) saturate(100%) invert(37%) sepia(84%) saturate(1282%) hue-rotate(224deg) brightness(95%) contrast(93%);
        /* Isso transforma a imagem em #7B5CF0 */
      }

      #kauava-search-bar .ks-icon {
        width: 22px;
        height: 22px;
        color: #7B5CF0;
        flex-shrink: 0;
      }

      #kauava-search-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-size: 0.95rem;
        color: #1e293b;
        padding: 0;
        min-width: 0;
      }
      #kauava-search-input::placeholder {
        color: #aaa;
        font-weight: 400;
      }

      #kauava-search-clear {
        display: none;
        background: none;
        border: none;
        outline: none;
        padding: 2px;
        cursor: pointer;
        color: #aaa;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        transition: color .15s;
      }
      #kauava-search-clear:hover { color: #475569; }
      #kauava-search-clear svg { width: 14px; height: 14px; }

      /* ── Autocomplete dropdown ──────────────────────────── */
      #kauava-autocomplete {
        position: absolute;
        top: calc(100% + 10px);
        left: 0; right: 0;
        background: #fff;
        border: 1.5px solid #e2e8f0;
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,.12);
        overflow: hidden;
        z-index: 9999;
        display: none;
        animation: ks-fade-in .15s ease;
      }
      @keyframes ks-fade-in {
        from { opacity:0; transform:translateY(-4px); }
        to   { opacity:1; transform:translateY(0); }
      }

      .ks-ac-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        cursor: pointer;
        transition: background .12s;
        border-bottom: 1px solid #f1f5f9;
        text-decoration: none;
        color: inherit;
      }
      .ks-ac-item:last-child { border-bottom: none; }
      .ks-ac-item:hover { background: #f8faff; }

      .ks-ac-type-dot {
        width: 28px; height: 28px;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .ks-ac-type-dot svg { width: 14px; height: 14px; color: #fff; }

      .ks-ac-text { flex: 1; min-width: 0; }
      .ks-ac-title {
        font-size: 0.87rem;
        font-weight: 600;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ks-ac-title mark {
        background: transparent;
        color: #7c6ff7;
        font-weight: 700;
      }
      .ks-ac-sub {
        font-size: 0.75rem;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ks-ac-arrow { color: #cbd5e1; flex-shrink: 0; }
      .ks-ac-arrow svg { width: 14px; height: 14px; }

      .ks-ac-footer {
        padding: 8px 14px;
        text-align: center;
        font-size: 0.78rem;
        color: #7c6ff7;
        font-weight: 600;
        cursor: pointer;
        background: #faf9ff;
        border-top: 1px solid #ede9fe;
        transition: background .12s;
      }
      .ks-ac-footer:hover { background: #ede9fe; }

      .ks-ac-empty {
        padding: 14px;
        text-align: center;
        color: #94a3b8;
        font-size: 0.85rem;
      }

      /* ── Results panel (overlay) ────────────────────────── */
      #kauava-results-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15,23,42,.45);
        backdrop-filter: blur(3px);
        z-index: 9998;
        display: none;
        animation: ks-overlay-in .2s ease;
      }
      @keyframes ks-overlay-in {
        from { opacity: 0; } to { opacity: 1; }
      }

      #kauava-results-panel {
        position: fixed;
        top: 0; right: 0;
        width: min(480px, 100vw);
        height: 100vh;
        background: #fff;
        box-shadow: -8px 0 40px rgba(0,0,0,.15);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform .28s cubic-bezier(.4,0,.2,1);
        overflow: hidden;
      }
      #kauava-results-panel.ks-open { transform: translateX(0); }

      .ks-panel-head {
        padding: 18px 20px 14px;
        border-bottom: 1px solid #f1f5f9;
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex-shrink: 0;
      }
      .ks-panel-head-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .ks-panel-title {
        font-size: 1rem;
        font-weight: 700;
        color: #1e293b;
      }
      .ks-panel-query {
        color: #7c6ff7;
        font-style: italic;
      }
      .ks-panel-close {
        background: none; border: none;
        color: #94a3b8; cursor: pointer;
        width: 32px; height: 32px;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        transition: background .12s, color .12s;
      }
      .ks-panel-close:hover { background: #f1f5f9; color: #475569; }
      .ks-panel-close svg { width: 18px; height: 18px; }

      .ks-filter-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .ks-tab {
        padding: 4px 12px;
        border-radius: 99px;
        font-size: 0.75rem;
        font-weight: 600;
        border: 1.5px solid #e2e8f0;
        cursor: pointer;
        background: #fff;
        color: #64748b;
        transition: all .15s;
      }
      .ks-tab:hover { border-color: #7c6ff7; color: #7c6ff7; }
      .ks-tab.active {
        background: #7c6ff7;
        border-color: #7c6ff7;
        color: #fff;
      }

      .ks-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px 16px 20px;
        scroll-behavior: smooth;
      }
      .ks-panel-body::-webkit-scrollbar { width: 5px; }
      .ks-panel-body::-webkit-scrollbar-thumb {
        background: #e2e8f0;
        border-radius: 99px;
      }

      .ks-section-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 16px 0 8px;
      }
      .ks-section-head:first-child { margin-top: 4px; }
      .ks-section-icon {
        width: 24px; height: 24px;
        border-radius: 7px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .ks-section-icon svg { width: 13px; height: 13px; color: #fff; }
      .ks-section-label {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .ks-section-count {
        margin-left: auto;
        font-size: 0.7rem;
        color: #cbd5e1;
        font-weight: 600;
      }

      .ks-card {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 10px 12px;
        border-radius: 10px;
        cursor: pointer;
        transition: background .12s, transform .1s;
        margin-bottom: 4px;
        text-decoration: none;
        color: inherit;
      }
      .ks-card:hover {
        background: #f8faff;
        transform: translateX(2px);
      }

      .ks-card-avatar {
        width: 40px; height: 40px;
        border-radius: 10px;
        object-fit: cover;
        flex-shrink: 0;
        background: #f1f5f9;
      }
      .ks-card-avatar-placeholder {
        width: 40px; height: 40px;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .ks-card-avatar-placeholder svg { width: 18px; height: 18px; color: #fff; }

      .ks-card-text { flex: 1; min-width: 0; }
      .ks-card-title {
        font-size: 0.88rem;
        font-weight: 600;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ks-card-title mark {
        background: #ede9fe;
        color: #5b50c4;
        border-radius: 3px;
        font-weight: 700;
      }
      .ks-card-sub {
        font-size: 0.76rem;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
      }
      .ks-card-sub mark {
        background: transparent;
        color: #7c6ff7;
        font-weight: 600;
      }

      .ks-card-arrow { color: #e2e8f0; flex-shrink: 0; }
      .ks-card-arrow svg { width: 14px; height: 14px; }

      .ks-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 160px;
        gap: 12px;
        color: #94a3b8;
        font-size: 0.85rem;
      }
      .ks-spinner {
        width: 32px; height: 32px;
        border: 3px solid #e2e8f0;
        border-top-color: #7c6ff7;
        border-radius: 50%;
        animation: ks-spin .7s linear infinite;
      }
      @keyframes ks-spin { to { transform: rotate(360deg); } }

      .ks-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        gap: 10px;
        color: #94a3b8;
        font-size: 0.87rem;
        text-align: center;
      }
      .ks-empty-icon { font-size: 2.4rem; opacity: .4; }

      .ks-card-badge {
        font-size: 0.68rem;
        font-weight: 700;
        color: #7c6ff7;
        background: #ede9fe;
        border-radius: 6px;
        padding: 3px 8px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* ── Item popup ─────────────────────────────────────── */
      #ks-item-popup {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity .22s ease;
        padding: 16px;
      }
      #ks-item-popup.ks-ip-visible { opacity: 1; }

      .ks-ip-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15,23,42,.6);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }

      .ks-ip-dialog {
        position: relative;
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 32px 96px rgba(0,0,0,.28);
        width: min(440px, 100%);
        max-height: 88vh;
        overflow-y: auto;
        overflow-x: hidden;
        transform: translateY(20px) scale(.96);
        transition: transform .24s cubic-bezier(.4,0,.2,1);
        scrollbar-width: thin;
      }
      .ks-ip-dialog::-webkit-scrollbar { width: 4px; }
      .ks-ip-dialog::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }
      #ks-item-popup.ks-ip-visible .ks-ip-dialog {
        transform: translateY(0) scale(1);
      }

      .ks-ip-close {
        position: absolute;
        top: 10px; right: 10px;
        background: rgba(255,255,255,.92);
        border: none;
        border-radius: 50%;
        width: 30px; height: 30px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        z-index: 10;
        box-shadow: 0 2px 10px rgba(0,0,0,.18);
        transition: background .12s, transform .1s;
      }
      .ks-ip-close:hover { background: #f1f5f9; transform: scale(1.08); }
      .ks-ip-close svg { width: 14px; height: 14px; color: #475569; }

      .ks-ip-dialog .art-card {
        flex: none !important;
        width: 100% !important;
        min-width: 0 !important;
      }
      .ks-ip-dialog .art-card > div:first-child {
        height: 300px !important;
      }

      @media (max-width: 600px) {
        #kauava-results-panel { width: 100vw; }
        #kauava-search-wrap { max-width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  Build DOM (replaces old #searchForm contents)
   * ───────────────────────────────────────────────────────────────────────── */
  function buildDOM() {
      const oldForm = document.getElementById("searchForm");
      if (!oldForm) return false;

      // ── Cria o wrap e move o form pra dentro (sem destruir o HTML do Figma)
      const wrap = document.createElement("div");
      wrap.id = "kauava-search-wrap";
      oldForm.parentNode.insertBefore(wrap, oldForm);
      wrap.appendChild(oldForm);

      // ── Adiciona o id do bar ao próprio form (para o :focus-within do CSS)
      oldForm.id = "kauava-search-bar";

      // ── Garante que o ícone de busca tenha a classe correta e cor roxa
      const searchIcon = wrap.querySelector("#ks-search-icon-img");
      if (searchIcon) {
        // Garante que o ícone fique roxo via CSS filter
        searchIcon.style.filter = "brightness(0) saturate(100%) invert(37%) sepia(84%) saturate(1282%) hue-rotate(224deg) brightness(95%) contrast(93%)";
      }

      // ── Injeta o autocomplete abaixo do form
      if (!document.getElementById("kauava-autocomplete")) {
          const ac = document.createElement("div");
          ac.id = "kauava-autocomplete";
          ac.setAttribute("role", "listbox");
          ac.setAttribute("aria-label", "Sugestões de busca");
          wrap.appendChild(ac);
      }

      // ── Garante o botão clear (pode já existir no HTML)
      if (!document.getElementById("kauava-search-clear")) {
          const clearBtn = document.createElement("button");
          clearBtn.id = "kauava-search-clear";
          clearBtn.setAttribute("aria-label", "Limpar busca");
          clearBtn.innerHTML = ICONS.close;
          oldForm.appendChild(clearBtn);
      } else {
          // Se já existe no HTML, só injeta o ícone X
          document.getElementById("kauava-search-clear").innerHTML = ICONS.close;
      }

      // ── Bloqueia o submit padrão do form
      oldForm.addEventListener("submit", e => e.preventDefault());

      // ── Results panel + overlay (igual ao original)
      if (!document.getElementById("kauava-results-overlay")) {
          const overlay = document.createElement("div");
          overlay.id = "kauava-results-overlay";

          const panel = document.createElement("div");
          panel.id = "kauava-results-panel";
          panel.innerHTML = `
            <div class="ks-panel-head">
              <div class="ks-panel-head-top">
                <span class="ks-panel-title">
                  Resultados para <span class="ks-panel-query" id="ks-query-label"></span>
                </span>
                <button class="ks-panel-close" id="ks-panel-close">${ICONS.close}</button>
              </div>
              <div class="ks-filter-tabs" id="ks-filter-tabs">
                <button class="ks-tab active" data-filter="all">Todos</button>
                <button class="ks-tab" data-filter="users">Usuários</button>
                <button class="ks-tab" data-filter="posts">Posts</button>
                <button class="ks-tab" data-filter="arts">Artes</button>
                <button class="ks-tab" data-filter="products">Produtos</button>
              </div>
            </div>
            <div class="ks-panel-body" id="ks-panel-body"></div>
          `;
          document.body.appendChild(overlay);
          document.body.appendChild(panel);
      }

      // ── Remove containers legados
      document.getElementById("searchResultsContainer")?.remove();
      document.getElementById("searchResults")?.remove();

      return true;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  Main search engine
   * ───────────────────────────────────────────────────────────────────────── */
  function initSearch(db) {
    const input    = document.getElementById("kauava-search-input");
    const clearBtn = document.getElementById("kauava-search-clear");
    const acBox    = document.getElementById("kauava-autocomplete");
    const overlay  = document.getElementById("kauava-results-overlay");
    const panel    = document.getElementById("kauava-results-panel");
    const panelBody= document.getElementById("ks-panel-body");
    const queryLbl = document.getElementById("ks-query-label");
    const closeBtn = document.getElementById("ks-panel-close");
    const filterBar= document.getElementById("ks-filter-tabs");

    if (!input) return;

    let debounceTimer = null;
    let lastResults   = {};    // { users:[], posts:[], arts:[], products:[] }
    let activeFilter  = "all";

    // ── Helpers ────────────────────────────────────────────────────────────
    function openPanel(query) {
      queryLbl.textContent = `"${query}"`;
      overlay.style.display = "block";
      panel.classList.add("ks-open");
      // reset filter
      setFilter("all");
    }

    function closePanel() {
      panel.classList.remove("ks-open");
      overlay.style.display = "none";
    }

    function setFilter(f) {
      activeFilter = f;
      document.querySelectorAll(".ks-tab").forEach(t =>
        t.classList.toggle("active", t.dataset.filter === f)
      );
      renderResults(lastResults, input.value.trim());
    }

    function hideAutocomplete() {
      acBox.style.display = "none";
      acBox.innerHTML = "";
    }

    // ── Firestore fetch ────────────────────────────────────────────────────
    async function fetchAll(q) {
      // Real Firestore field names per collection:
      //   users    -> user_Name
      //   posts    -> postText   (no title field)
      //   arts     -> name       (not title)
      //   products -> productTitle (not name)
      const [uSnap, pSnap, aSnap, prSnap] = await Promise.all([
        prefixQuery(db, "users",    "user_Name",    q, 10),
        prefixQuery(db, "posts",    "postText",     q, 10),
        prefixQuery(db, "arts",     "name",         q, 10),
        prefixQuery(db, "products", "productTitle", q, 10),
      ]);

      // Also try capitalised first letter (common pattern)
      const qCap = q.charAt(0).toUpperCase() + q.slice(1);
      let extraSnaps = [];
      if (qCap !== q) {
        extraSnaps = await Promise.all([
          prefixQuery(db, "users",    "user_Name",    qCap, 5),
          prefixQuery(db, "posts",    "postText",     qCap, 5),
          prefixQuery(db, "arts",     "name",         qCap, 5),
          prefixQuery(db, "products", "productTitle", qCap, 5),
        ]);
      }

      function mergeSnaps(a, b, idField = null) {
        const seen = new Set();
        const out  = [];
        [a, b].forEach(snap => {
          if (!snap) return;
          snap.forEach(doc => {
            if (!seen.has(doc.id)) { seen.add(doc.id); out.push(doc); }
          });
        });
        return out;
      }

      return {
        users:    mergeSnaps(uSnap,  extraSnaps[0]),
        posts:    mergeSnaps(pSnap,  extraSnaps[1]),
        arts:     mergeSnaps(aSnap,  extraSnaps[2]),
        products: mergeSnaps(prSnap, extraSnaps[3]),
      };
    }

    // ── Autocomplete ────────────────────────────────────────────────────────
    async function doAutocomplete(q) {
      acBox.innerHTML = "";
      if (!q || q.length < 1) { hideAutocomplete(); return; }

      try {
        const res = await fetchAll(q);
        const items = [];

        res.users.slice(0,2).forEach(doc => {
          const d = doc.data();
          items.push({ type: "users", id: doc.id, title: d.user_Name || "Unknown", sub: "User", data: d });
        });
        res.posts.slice(0,2).forEach(doc => {
          const d = doc.data();
          items.push({ type: "posts", id: doc.id, title: d.postText || "Untitled", sub: truncate(d.postText, 50), data: d });
        });
        res.arts.slice(0,1).forEach(doc => {
          const d = doc.data();
          items.push({ type: "arts", id: doc.id, title: d.name || "Untitled", sub: truncate(d.description, 50), data: d });
        });
        res.products.slice(0,1).forEach(doc => {
          const d = doc.data();
          items.push({ type: "products", id: doc.id, title: d.productTitle || "Product", sub: truncate(d.description, 50), data: d });
        });

        if (items.length === 0) {
          acBox.innerHTML = `<div class="ks-ac-empty">No suggestions for "${safe(q)}"</div>`;
        } else {
          items.slice(0, 6).forEach(item => {
            const meta = TYPE_META[item.type];
            const el   = document.createElement("div");
            el.className = "ks-ac-item";
            el.setAttribute("role", "option");

            el.innerHTML = `
              <div class="ks-ac-type-dot" style="background:${meta.color}">${meta.icon}</div>
              <div class="ks-ac-text">
                <div class="ks-ac-title">${highlight(item.title, q)}</div>
                ${item.sub ? `<div class="ks-ac-sub">${safe(item.sub)}</div>` : ""}
              </div>
              <span class="ks-ac-arrow">${ICONS.arrow}</span>
            `;

            el.addEventListener("mousedown", e => {
              e.preventDefault();
              hideAutocomplete();
              navigateTo(item);
            });
            acBox.appendChild(el);
          });

          // Footer: "See all results"
          const footer = document.createElement("div");
          footer.className = "ks-ac-footer";
          footer.textContent = `See all results for "${q}"`;
          footer.addEventListener("mousedown", e => {
            e.preventDefault();
            hideAutocomplete();
            triggerFullSearch(q);
          });
          acBox.appendChild(footer);
        }
        acBox.style.display = "block";
      } catch (err) {
        console.error("[KauavaSearch] Autocomplete error:", err);
        hideAutocomplete();
      }
    }

    // ── Open item as popup — renders the real feed card with all interactions ──
    async function openItemPopup(type, id, d) {
      const postMgr    = window._kauavaPostManager;
      const artMgr     = window._kauavaArtManager;
      const productMgr = window._kauavaProductManager;
      const db         = firebase.firestore();

      // Get current user id
      let currentUserId = null;
      const mgr = postMgr || artMgr || productMgr;
      if (mgr && mgr.getCurrentUser) {
        const u = await mgr.getCurrentUser().catch(() => null);
        if (u) currentUserId = u.firestoreUserId;
      }

      // Config per type
      const cfg = {
        posts:    { col: "posts",    userField: "foreignUserId", likesCol: "likes",         likesId: "foreignPostId",  likesUser: "foreignUserId" },
        arts:     { col: "arts",     userField: "userId",        likesCol: "art_likes",     likesId: "artId",          likesUser: "userId" },
        products: { col: "products", userField: "designerUserId",likesCol: "product_likes", likesId: "productId",      likesUser: "userId" },
      }[type];

      // Fetch fresh doc
      let data = d;
      try {
        const snap = await db.collection(cfg.col).doc(id).get();
        if (snap.exists) data = snap.data();
      } catch(e) { console.warn("[KauavaSearch] fetch doc:", e); }

      // Cache author + prewarm likes using the manager
      const activeMgr = type === "posts" ? postMgr : type === "arts" ? artMgr : productMgr;
      if (activeMgr) {
        await activeMgr.cacheUsers([data[cfg.userField]]).catch(() => {});
        await activeMgr.likesManager.prewarmLikesCache([id], cfg.likesCol, cfg.likesId, cfg.likesUser, currentUserId).catch(() => {});
      }

      const userData = activeMgr?.usersCache?.[data[cfg.userField]] || {};

      // Build the real card element via the manager
      let cardEl;
      if      (type === "posts"    && postMgr)    cardEl = postMgr.createPostElement(id, data, userData, currentUserId);
      else if (type === "arts"     && artMgr)     cardEl = artMgr.createArtElement(id, data, userData, currentUserId);
      else if (type === "products" && productMgr) cardEl = productMgr.createProductElement(id, data, userData, currentUserId, data[cfg.userField] === currentUserId);

      if (!cardEl) return;

      // Override the card's fixed sizing so it fills the popup nicely
      cardEl.style.cssText = "width:100%;max-width:100%;min-width:0;flex:none;border-radius:0;box-shadow:none;";

      // Build popup shell
      document.getElementById("ks-item-popup")?.remove();
      const popup = document.createElement("div");
      popup.id = "ks-item-popup";

      const backdrop = document.createElement("div");
      backdrop.className = "ks-ip-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "ks-ip-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const closeBtn = document.createElement("button");
      closeBtn.className = "ks-ip-close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.innerHTML = ICONS.close;

      dialog.appendChild(closeBtn);
      dialog.appendChild(cardEl);
      popup.appendChild(backdrop);
      popup.appendChild(dialog);
      document.body.appendChild(popup);

      requestAnimationFrame(() => popup.classList.add("ks-ip-visible"));

      const close = () => {
        popup.classList.remove("ks-ip-visible");
        popup.addEventListener("transitionend", () => popup.remove(), { once: true });
      };
      backdrop.addEventListener("click", close);
      closeBtn.addEventListener("click", close);
      document.addEventListener("keydown", function esc(e) {
        if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
      });
    }

    // ── Full results panel ──────────────────────────────────────────────────
    async function triggerFullSearch(q) {
      if (!q || q.length < 1) return;

      openPanel(q);
      panelBody.innerHTML = `<div class="ks-loading"><div class="ks-spinner"></div><span>Searching…</span></div>`;

      try {
        const res = await fetchAll(q);
        lastResults = res;
        renderResults(res, q);
      } catch (err) {
        console.error("[KauavaSearch] Search error:", err);
        panelBody.innerHTML = `<div class="ks-empty"><div class="ks-empty-icon">⚠️</div>An error occurred. Please try again.</div>`;
      }
    }

    function renderResults(res, q) {
      panelBody.innerHTML = "";

      const order = ["users", "posts", "arts", "products"];
      let totalShown = 0;

      order.forEach(type => {
        if (activeFilter !== "all" && activeFilter !== type) return;

        const docs = res[type] || [];
        if (docs.length === 0) return;

        const meta = TYPE_META[type];

        const head = document.createElement("div");
        head.className = "ks-section-head";
        head.innerHTML = `
          <div class="ks-section-icon" style="background:${meta.color}">${meta.icon}</div>
          <span class="ks-section-label">${meta.label}</span>
          <span class="ks-section-count">${docs.length} result${docs.length !== 1 ? "s" : ""}</span>
        `;
        panelBody.appendChild(head);

        docs.forEach(doc => {
          const d    = doc.data();
          const card = buildCard(type, doc.id, d, q, meta);
          panelBody.appendChild(card);
          totalShown++;
        });
      });

      if (totalShown === 0) {
        panelBody.innerHTML = `
          <div class="ks-empty">
            <div class="ks-empty-icon">🔍</div>
            <strong>No results found</strong>
            <span>Try different keywords or check spelling</span>
          </div>
        `;
      }
    }

    // ── Card builder ────────────────────────────────────────────────────────
    // Users → navigate to profile (unchanged)
    // Posts / Arts / Products → filter in-page feed and close panel
    function buildCard(type, id, d, q, meta) {
      const card = document.createElement("div");
      card.className = "ks-card";
      card.setAttribute("role", "listitem");

      let avatarHTML, title, sub;

      if (type === "users") {
        title = d.user_Name || "Unknown User";
        sub   = d.user_Bio  || "Kauava member";
        if (d.profilePicture) {
          avatarHTML = `<img class="ks-card-avatar" src="data:image/jpeg;base64,${d.profilePicture}" alt="${safe(title)}" onerror="this.onerror=null;this.src='../images/default-profile.png'">`;
        } else {
          avatarHTML = `<div class="ks-card-avatar-placeholder" style="background:${meta.color}">${ICONS.user}</div>`;
        }
      } else if (type === "posts") {
        title      = d.postText     || "Untitled Post";
        sub        = "";
        avatarHTML = `<div class="ks-card-avatar-placeholder" style="background:${meta.color}">${ICONS.post}</div>`;
      } else if (type === "arts") {
        title      = d.name         || "Untitled Art";
        sub        = d.description  || "";
        avatarHTML = `<div class="ks-card-avatar-placeholder" style="background:${meta.color}">${ICONS.art}</div>`;
      } else {
        title      = d.productTitle || "Product";
        sub        = d.description  || "";
        avatarHTML = `<div class="ks-card-avatar-placeholder" style="background:${meta.color}">${ICONS.product}</div>`;
      }

      // Badge for non-user types to signal in-page behaviour
      const badge = type !== "users"
        ? `<span class="ks-card-badge">Open</span>`
        : `<span class="ks-card-arrow">${ICONS.arrow}</span>`;

      card.innerHTML = `
        ${avatarHTML}
        <div class="ks-card-text">
          <div class="ks-card-title">${highlight(title, q)}</div>
          ${sub ? `<div class="ks-card-sub">${highlight(truncate(sub, 80), q)}</div>` : ""}
        </div>
        ${badge}
      `;

      if (type === "users") {
        card.addEventListener("click", () => {
          window.location.href = `public-profile.html?userId=${encodeURIComponent(d.userId || id)}`;
        });
      } else {
        // Open item in popup — feed stays untouched underneath
        card.addEventListener("click", async () => {
          closePanel();
          await openItemPopup(type, id, d);
        });
      }

      return card;
    }

    // ── Navigate on autocomplete click ──────────────────────────────────────
    // Users → profile page; content types → open popup over the feed
    function navigateTo(item) {
      const { type, id, data: d } = item;
      if (type === "users") {
        window.location.href = `public-profile.html?userId=${encodeURIComponent(d.userId || id)}`;
      } else {
        hideAutocomplete();
        openItemPopup(type, id, d);
      }
    }

    // ── Events ─────────────────────────────────────────────────────────────
    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearBtn.style.display = q ? "flex" : "none";
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doAutocomplete(q), 220);
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        hideAutocomplete();
        triggerFullSearch(input.value.trim());
      }
      if (e.key === "Escape") {
        hideAutocomplete();
        closePanel();
      }
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.style.display = "none";
      hideAutocomplete();
      closePanel();
      input.focus();
    });

    closeBtn.addEventListener("click", closePanel);
    overlay.addEventListener("click", closePanel);

    // Filter tabs
    filterBar.addEventListener("click", e => {
      const tab = e.target.closest(".ks-tab");
      if (tab) setFilter(tab.dataset.filter);
    });

    // Hide autocomplete on outside click
    document.addEventListener("click", e => {
      const wrap = document.getElementById("kauava-search-wrap");
      if (wrap && !wrap.contains(e.target)) hideAutocomplete();
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  Boot
   * ───────────────────────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    injectStyles();
    const ok = buildDOM();
    if (!ok) {
      console.warn("[KauavaSearch] #searchForm not found — search not mounted.");
      return;
    }
    waitForFirebase((db) => initSearch(db));
  });

})();