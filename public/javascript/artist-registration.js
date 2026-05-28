/**
 * Kauara – Artist Registration
 * Handles the full multi-step artist application flow.
 */
document.addEventListener("DOMContentLoaded", () => {

    // ─── Firebase ──────────────────────────────────────────────────────────────
    const firebaseConfig = {
        apiKey:            "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain:        "kauara1.firebaseapp.com",
        projectId:         "kauara1",
        storageBucket:     "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId:             "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId:     "G-KL18R1CJ6S",
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth    = firebase.auth();
    const db      = firebase.firestore();
    const storage = firebase.storage();

    let currentUser     = null;
    let currentUserId   = null;
    let currentUserData = null;

    // ─── Inject styles ────────────────────────────────────────────────────────
    const styleEl = document.createElement("style");
    styleEl.textContent = `
        /* ── Tokens ───────────────────────────────────────────────────────── */
        :root {
            --k-ink:          #1a1410;
            --k-sand:         #f5f0e8;
            --k-clay:         #c8855a;
            --k-terra:        #b05e38;
            --k-warm-gray:    #8a7f76;
            --k-light-clay:   #f0e0d0;
            --k-white:        #fefcf8;
            --k-success:      #4a7c59;
            --k-error:        #a63a2e;
            --k-border:       rgba(26,20,16,.14);
            --k-radius:       10px;
            --k-radius-lg:    16px;
            --k-transition:   .2s ease;
            --k-font-display: 'Playfair Display', Georgia, serif;
            --k-font-body:    'DM Sans', system-ui, sans-serif;
        }

        /* ── Notification ─────────────────────────────────────────────────── */
        .k-notif {
            position: fixed; top: 24px; right: 24px;
            padding: 14px 20px; border-radius: 40px;
            color: var(--k-white); font-weight: 500; z-index: 99999;
            font-size: 14px; font-family: var(--k-font-body);
            box-shadow: 0 8px 32px rgba(0,0,0,.18);
            animation: k-slideIn .22s ease;
            transition: opacity .3s;
            max-width: 340px;
            line-height: 1.4;
        }
        .k-notif--success { background: var(--k-success); }
        .k-notif--error   { background: var(--k-error); }
        .k-notif--info    { background: var(--k-ink); }
        @keyframes k-slideIn {
            from { opacity: 0; transform: translateX(50px) scale(.96); }
            to   { opacity: 1; transform: translateX(0)   scale(1); }
        }

        /* ── Overlay & Modal ──────────────────────────────────────────────── */
        .k-overlay {
            position: fixed; inset: 0;
            background: rgba(26,20,16,.6);
            backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            z-index: 9998; padding: 16px;
            animation: k-fadeIn .2s ease;
        }
        @keyframes k-fadeIn {
            from { opacity: 0; } to { opacity: 1; }
        }

        .k-modal {
            background: var(--k-white);
            border-radius: var(--k-radius-lg);
            width: 100%; max-width: 540px;
            max-height: 92vh; overflow-y: auto;
            padding: 40px 36px 32px;
            position: relative;
            font-family: var(--k-font-body);
            animation: k-slideUp .25s ease;
            scrollbar-width: thin;
            scrollbar-color: var(--k-light-clay) transparent;
        }
        @keyframes k-slideUp {
            from { opacity: 0; transform: translateY(24px) scale(.98); }
            to   { opacity: 1; transform: translateY(0)    scale(1); }
        }

        /* ── Close button ─────────────────────────────────────────────────── */
        .k-close {
            position: absolute; top: 16px; right: 18px;
            border: none; background: none;
            width: 32px; height: 32px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: var(--k-warm-gray);
            font-size: 20px; line-height: 1;
            transition: background var(--k-transition), color var(--k-transition);
        }
        .k-close:hover { background: var(--k-light-clay); color: var(--k-ink); }

        /* ── Progress ─────────────────────────────────────────────────────── */
        .k-progress {
            margin-bottom: 32px;
        }
        .k-progress__meta {
            display: flex; justify-content: space-between;
            margin-bottom: 8px;
        }
        .k-progress__meta span {
            font-size: 12px; color: var(--k-warm-gray);
            font-weight: 500; letter-spacing: .03em;
        }
        .k-progress__track {
            height: 3px; background: var(--k-light-clay);
            border-radius: 3px; overflow: hidden;
        }
        .k-progress__fill {
            height: 100%; background: var(--k-clay);
            border-radius: 3px; transition: width .35s ease;
        }

        /* ── Step heading ─────────────────────────────────────────────────── */
        .k-step-title {
            font-family: var(--k-font-display);
            font-size: 26px; font-weight: 400;
            color: var(--k-ink); margin: 0 0 6px;
        }
        .k-step-desc {
            font-size: 14px; font-weight: 300;
            color: var(--k-warm-gray); margin: 0 0 24px;
            line-height: 1.6;
        }

        /* ── Form fields ──────────────────────────────────────────────────── */
        .k-fields { display: flex; flex-direction: column; gap: 16px; }

        .k-field { display: flex; flex-direction: column; gap: 5px; }
        .k-field--row { flex-direction: row; gap: 14px; }
        .k-field--row .k-field { flex: 1; }

        .k-label {
            font-size: 12px; font-weight: 500;
            color: var(--k-warm-gray); letter-spacing: .04em;
            text-transform: uppercase;
        }

        .k-input {
            width: 100%; padding: 11px 14px;
            border: 1.5px solid var(--k-border);
            border-radius: var(--k-radius);
            font-size: 15px; font-family: var(--k-font-body);
            color: var(--k-ink); background: var(--k-white);
            outline: none; box-sizing: border-box;
            transition: border-color var(--k-transition), box-shadow var(--k-transition);
        }
        .k-input:focus {
            border-color: var(--k-clay);
            box-shadow: 0 0 0 3px rgba(200,133,90,.12);
        }
        .k-input::placeholder { color: rgba(138,127,118,.5); }
        .k-input:disabled { opacity: .5; cursor: not-allowed; }

        /* ── Terms box ────────────────────────────────────────────────────── */
        .k-terms {
            background: var(--k-sand);
            border: 1px solid var(--k-border);
            border-radius: var(--k-radius);
            padding: 16px 18px;
            font-size: 13px; line-height: 1.75;
            color: rgba(26,20,16,.65);
            max-height: 180px; overflow-y: auto;
            margin-bottom: 16px;
        }
        .k-terms strong { color: var(--k-ink); font-weight: 600; }

        /* ── Checkbox ─────────────────────────────────────────────────────── */
        .k-checkbox {
            display: flex; align-items: flex-start; gap: 10px;
            cursor: pointer; font-size: 14px; line-height: 1.5;
            color: var(--k-ink);
        }
        .k-checkbox input[type="checkbox"] {
            width: 18px; height: 18px; margin-top: 1px;
            accent-color: var(--k-clay); cursor: pointer; flex-shrink: 0;
        }

        /* ── Already-accepted badge ───────────────────────────────────────── */
        .k-accepted {
            display: flex; align-items: center; gap: 10px;
            background: #e8f0eb; border-radius: var(--k-radius);
            padding: 12px 16px; color: var(--k-success);
            font-size: 14px; font-weight: 500;
        }

        /* ── Art grid ─────────────────────────────────────────────────────── */
        .k-art-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px; margin-bottom: 12px;
        }

        .k-art-card {
            aspect-ratio: 1; border-radius: var(--k-radius);
            overflow: hidden; background: var(--k-light-clay);
            position: relative;
        }

        .k-art-card img {
            width: 100%; height: 100%; object-fit: cover;
            display: block; transition: transform var(--k-transition);
        }
        .k-art-card:hover img { transform: scale(1.04); }

        .k-art-card__remove {
            position: absolute; top: 5px; right: 5px;
            width: 24px; height: 24px; border-radius: 50%;
            background: rgba(26,20,16,.72); border: none;
            color: #fff; cursor: pointer; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity var(--k-transition);
            line-height: 1;
        }
        .k-art-card:hover .k-art-card__remove { opacity: 1; }

        .k-art-footer {
            display: flex; justify-content: space-between; align-items: center;
            margin-top: 4px;
        }
        .k-art-counter {
            font-size: 13px; color: var(--k-warm-gray);
        }

        .k-add-art {
            padding: 8px 16px;
            border: 1.5px dashed var(--k-border);
            border-radius: var(--k-radius);
            background: transparent;
            cursor: pointer; font-size: 13px;
            color: var(--k-warm-gray);
            font-family: var(--k-font-body);
            transition: border-color var(--k-transition), color var(--k-transition);
        }
        .k-add-art:hover {
            border-color: var(--k-clay); color: var(--k-clay);
        }

        /* ── Navigation ───────────────────────────────────────────────────── */
        .k-nav {
            display: flex; gap: 10px; margin-top: 28px;
        }

        .k-btn {
            flex: 1; padding: 13px 20px; border-radius: var(--k-radius);
            font-family: var(--k-font-body); font-size: 15px;
            font-weight: 500; cursor: pointer;
            transition: background var(--k-transition), transform .12s, opacity var(--k-transition);
        }
        .k-btn:disabled { opacity: .5; cursor: not-allowed; }
        .k-btn:not(:disabled):active { transform: scale(.98); }

        .k-btn--secondary {
            border: 1.5px solid var(--k-border);
            background: transparent; color: var(--k-ink);
            flex: 0 0 auto; padding: 13px 18px;
        }
        .k-btn--secondary:hover:not(:disabled) {
            background: var(--k-sand);
        }

        .k-btn--primary {
            border: none; background: var(--k-ink);
            color: var(--k-white); flex: 2;
        }
        .k-btn--primary:hover:not(:disabled) { background: #2e2520; }

        /* ── Danger zone ──────────────────────────────────────────────────── */
        .k-danger-zone {
            margin-top: 20px; padding-top: 20px;
            border-top: 1px solid var(--k-border);
        }

        .k-btn--ghost-danger {
            width: 100%; padding: 12px; border-radius: var(--k-radius);
            border: 1.5px solid rgba(166,58,46,.3);
            background: transparent; color: var(--k-error);
            cursor: pointer; font-size: 14px; font-weight: 500;
            font-family: var(--k-font-body);
            transition: background var(--k-transition), border-color var(--k-transition);
        }
        .k-btn--ghost-danger:hover {
            background: rgba(166,58,46,.06);
            border-color: var(--k-error);
        }

        /* ── Edit header ──────────────────────────────────────────────────── */
        .k-edit-header { margin-bottom: 24px; }
        .k-edit-header h2 {
            font-family: var(--k-font-display);
            font-size: 26px; font-weight: 400;
            margin: 0 0 6px;
        }
        .k-edit-header p {
            font-size: 14px; color: var(--k-warm-gray);
            font-weight: 300; margin: 0;
        }

        /* ── Confirm dialog ───────────────────────────────────────────────── */
        .k-confirm-overlay {
            position: fixed; inset: 0;
            background: rgba(26,20,16,.65); backdrop-filter: blur(6px);
            display: flex; align-items: center; justify-content: center;
            z-index: 10001; padding: 16px;
        }
        .k-confirm-box {
            background: var(--k-white); border-radius: var(--k-radius-lg);
            width: 100%; max-width: 400px;
            padding: 32px 28px; text-align: center;
            font-family: var(--k-font-body);
            animation: k-slideUp .2s ease;
        }
        .k-confirm-box h3 {
            font-family: var(--k-font-display);
            font-size: 22px; font-weight: 400;
            margin: 0 0 10px;
        }
        .k-confirm-box p {
            font-size: 14px; color: var(--k-warm-gray);
            line-height: 1.6; margin: 0 0 28px;
        }
        .k-confirm-actions { display: flex; gap: 12px; }
    `;
    document.head.appendChild(styleEl);

    // ─── Notification ─────────────────────────────────────────────────────────
    function showNotification(message, type = "info") {
        const el = document.createElement("div");
        el.className = `k-notif k-notif--${type}`;
        el.textContent = message;
        document.body.appendChild(el);

        setTimeout(() => {
            el.style.opacity = "0";
            setTimeout(() => el.remove(), 320);
        }, 3200);
    }

    // ─── Confirm dialog ───────────────────────────────────────────────────────
    function confirmAction(message) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "k-confirm-overlay";
            overlay.innerHTML = `
                <div class="k-confirm-box">
                    <h3>Confirmar ação</h3>
                    <p>${message}</p>
                    <div class="k-confirm-actions">
                        <button id="kConfirmNo"  class="k-btn k-btn--secondary" style="flex:1">Cancelar</button>
                        <button id="kConfirmYes" class="k-btn k-btn--primary"   style="background:var(--k-error);flex:2">Sim, confirmar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const done = (result) => { overlay.remove(); resolve(result); };
            overlay.querySelector("#kConfirmYes").addEventListener("click", () => done(true));
            overlay.querySelector("#kConfirmNo").addEventListener("click",  () => done(false));
            overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
        });
    }

    // ─── Resolve user ID ──────────────────────────────────────────────────────
    async function resolveUserId(uid, userObj) {
        const q = await db.collection("users").where("firebaseUID", "==", uid).limit(1).get();
        if (!q.empty) {
            currentUserData = q.docs[0].data();
            return q.docs[0].id;
        }

        if (userObj?.email) {
            const eq = await db.collection("users").where("email", "==", userObj.email).limit(1).get();
            if (!eq.empty) {
                await eq.docs[0].ref.update({ firebaseUID: uid });
                currentUserData = eq.docs[0].data();
                return eq.docs[0].id;
            }
        }

        const newRef = db.collection("users").doc();
        await newRef.set({
            firebaseUID:  uid,
            email:        userObj?.email        || "",
            displayName:  userObj?.displayName  || "",
            candidato:    false,
            artista:      false,
            createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
        });
        currentUserData = { candidato: false, artista: false };
        return newRef.id;
    }

    // ─── Candidate arts helpers ───────────────────────────────────────────────
    async function fetchCandidateArts(userId) {
        const snap = await db.collection("candidate_arts")
            .where("userId", "==", userId)
            .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async function deleteCandidateArts(userId) {
        const arts = await fetchCandidateArts(userId);
        for (const art of arts) {
            try { await storage.refFromURL(art.imageUrl).delete(); }
            catch (e) { console.warn("[Kauara] Storage delete failed:", art.imageUrl); }
            await db.collection("candidate_arts").doc(art.id).delete();
        }
    }

    // ─── Input helpers ────────────────────────────────────────────────────────
    function maskCPF(v) {
        v = v.replace(/\D/g, "").slice(0, 11);
        return v
            .replace(/(\d{3})(\d)/,       "$1.$2")
            .replace(/(\d{3})(\d)/,       "$1.$2")
            .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }

    function maskPhone(v) {
        v = v.replace(/\D/g, "").slice(0, 11);
        return v.length <= 10
            ? v.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3")
            : v.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
    }

    function esc(s) {
        if (!s) return "";
        return s.replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
    }

    function val(id) { return (document.getElementById(id)?.value || "").trim(); }

    // ─── Auth ─────────────────────────────────────────────────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (!user) return;
        try {
            currentUser   = user;
            currentUserId = await resolveUserId(user.uid, user);
            syncButtonState();
        } catch (e) {
            console.error("[Kauara] Auth error:", e);
        }
    });

    function syncButtonState() {
        const btn = document.getElementById("showArtistModalBtn");
        if (!btn) return;

        btn.classList.remove("is-loading", "is-edit", "is-pending");

        if (!currentUserData) {
            btn.textContent = "🎨 Quero me cadastrar";
            return;
        }

        const approved = currentUserData.candidato === true || currentUserData.artista === true;
        const hasCpf   = !!currentUserData.cpf;

        if (approved) {
            btn.textContent = "✏️ Editar informações";
            btn.classList.add("is-edit");
        } else if (hasCpf) {
            btn.textContent = "✏️ Editar candidatura";
            btn.classList.add("is-pending");
        } else {
            btn.textContent = "🎨 Quero me cadastrar";
        }
    }

    // ─── Open modal ───────────────────────────────────────────────────────────
    async function openModal() {
        if (!currentUser) {
            showNotification("Faça login para continuar.", "error");
            return;
        }

        // Refresh data before opening
        const userDoc = await db.collection("users").doc(currentUserId).get();
        currentUserData = userDoc.data();

        const existingArts       = await fetchCandidateArts(currentUserId);
        let   existingArtworkUrls = existingArts.map(a => a.imageUrl);

        const isEditing = !!(
            currentUserData?.candidato === true ||
            currentUserData?.artista   === true ||
            existingArts.length > 0    ||
            currentUserData?.cpf
        );

        // ── Modal state ────────────────────────────────────────────────────
        const TOTAL   = 4;
        const MAX_IMG = 10;
        const MIN_IMG = 3;

        let step              = 1;
        let artworkFiles      = [];
        let artworkIdsToDelete = [];

        // ── Build overlay ──────────────────────────────────────────────────
        const overlay = document.createElement("div");
        overlay.className = "k-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", isEditing ? "Editar informações" : "Cadastro de Artista");

        overlay.innerHTML = `
            <div class="k-modal">
                <button class="k-close" id="kRegClose" aria-label="Fechar">&times;</button>

                ${!isEditing ? `
                <div class="k-progress">
                    <div class="k-progress__meta">
                        <span>Etapa <span id="kStepNum">1</span> de ${TOTAL}</span>
                        <span id="kStepLabel">Dados pessoais</span>
                    </div>
                    <div class="k-progress__track">
                        <div class="k-progress__fill" id="kProgressFill" style="width:25%"></div>
                    </div>
                </div>
                ` : `
                <div class="k-edit-header">
                    <h2>Editar informações</h2>
                    <p>Atualize seus dados de cadastro abaixo.</p>
                </div>
                `}

                <div id="kStepContent"></div>

                <div class="k-nav">
                    <button id="kRegBack" class="k-btn k-btn--secondary" style="${!isEditing ? 'display:none' : ''}">← Voltar</button>
                    <button id="kRegNext" class="k-btn k-btn--primary">
                        ${isEditing ? 'Salvar alterações' : 'Próximo →'}
                    </button>
                </div>

                ${isEditing ? `
                <div class="k-danger-zone">
                    <button id="kCancelApp" class="k-btn--ghost-danger">
                        Desistir da candidatura
                    </button>
                </div>
                ` : ''}
            </div>
        `;

        document.body.appendChild(overlay);

        const stepContentEl = overlay.querySelector("#kStepContent");
        const progressFill  = overlay.querySelector("#kProgressFill");
        const stepNumEl     = overlay.querySelector("#kStepNum");
        const stepLabelEl   = overlay.querySelector("#kStepLabel");
        const nextBtn       = overlay.querySelector("#kRegNext");
        const backBtn       = overlay.querySelector("#kRegBack");

        overlay.querySelector("#kRegClose").addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        document.addEventListener("keydown", function escHandler(e) {
            if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", escHandler); }
        });

        if (isEditing) {
            overlay.querySelector("#kCancelApp")?.addEventListener("click", async () => {
                const ok = await confirmAction(
                    "Tem certeza? Todas as suas obras e informações serão removidas permanentemente."
                );
                if (!ok) return;
                try {
                    await deleteCandidateArts(currentUserId);
                    await db.collection("users").doc(currentUserId).update({
                        candidato:       false,
                        artista:         false,
                        candidatoSentAt: firebase.firestore.FieldValue.delete(),
                        fullLegalName:   firebase.firestore.FieldValue.delete(),
                        idade:           firebase.firestore.FieldValue.delete(),
                        cpf:             firebase.firestore.FieldValue.delete(),
                        telefone:        firebase.firestore.FieldValue.delete(),
                        pixKey:          firebase.firestore.FieldValue.delete(),
                        updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    showNotification("Candidatura cancelada. Seus dados foram removidos.", "info");
                    overlay.remove();
                    syncButtonState();
                } catch (err) {
                    console.error("[Kauara] cancel error:", err);
                    showNotification("Erro ao cancelar: " + err.message, "error");
                }
            });
        }

        // ── Step definitions ───────────────────────────────────────────────
        const steps = [
            {
                label: "Dados pessoais",
                render() {
                    const nome  = esc(currentUserData?.fullLegalName || currentUserData?.displayName || "");
                    const idade = currentUserData?.idade || "";
                    const cpf   = maskCPF(currentUserData?.cpf || "");
                    return `
                        <h2 class="k-step-title">Dados pessoais</h2>
                        <p class="k-step-desc">Precisamos verificar sua identidade para continuar.</p>
                        <div class="k-fields">
                            <div class="k-field">
                                <label class="k-label" for="rNome">Nome completo *</label>
                                <input class="k-input" id="rNome" type="text"
                                    placeholder="Como aparece no seu documento"
                                    value="${nome}" autocomplete="name">
                            </div>
                            <div class="k-field--row k-field">
                                <div class="k-field">
                                    <label class="k-label" for="rIdade">Idade *</label>
                                    <input class="k-input" id="rIdade" type="number"
                                        min="18" max="120" placeholder="18+" value="${idade}">
                                </div>
                                <div class="k-field">
                                    <label class="k-label" for="rCpf">CPF *</label>
                                    <input class="k-input" id="rCpf" type="text"
                                        placeholder="000.000.000-00" maxlength="14" value="${cpf}"
                                        inputmode="numeric">
                                </div>
                            </div>
                        </div>
                    `;
                },
                afterRender() {
                    const cpfEl = document.getElementById("rCpf");
                    cpfEl?.addEventListener("input", e => { e.target.value = maskCPF(e.target.value); });
                },
                validate() {
                    const nome  = val("rNome");
                    const idade = parseInt(val("rIdade"), 10);
                    const cpf   = val("rCpf").replace(/\D/g, "");
                    if (!nome)            { showNotification("Informe seu nome completo.", "error");         return false; }
                    if (!idade || idade < 18) { showNotification("Você precisa ter 18 anos ou mais.", "error"); return false; }
                    if (cpf.length !== 11) { showNotification("CPF inválido.", "error");                     return false; }
                    return true;
                },
            },
            {
                label: "Contato & Pix",
                render() {
                    const tel   = esc(currentUserData?.telefone || "");
                    const email = esc(currentUser?.email || currentUserData?.email || "");
                    const pix   = esc(currentUserData?.pixKey || "");
                    return `
                        <h2 class="k-step-title">Contato & Pix</h2>
                        <p class="k-step-desc">Como entramos em contato e como você recebe suas vendas.</p>
                        <div class="k-fields">
                            <div class="k-field">
                                <label class="k-label" for="rTel">Celular *</label>
                                <input class="k-input" id="rTel" type="tel"
                                    placeholder="(00) 00000-0000" value="${tel}"
                                    inputmode="tel" autocomplete="tel">
                            </div>
                            <div class="k-field">
                                <label class="k-label" for="rEmail">E-mail *</label>
                                <input class="k-input" id="rEmail" type="email"
                                    placeholder="seu@email.com" value="${email}"
                                    autocomplete="email">
                            </div>
                            <div class="k-field">
                                <label class="k-label" for="rPix">Chave Pix *</label>
                                <input class="k-input" id="rPix" type="text"
                                    placeholder="CPF, e-mail, telefone ou chave aleatória"
                                    value="${pix}">
                            </div>
                        </div>
                    `;
                },
                afterRender() {
                    const telEl = document.getElementById("rTel");
                    telEl?.addEventListener("input", e => { e.target.value = maskPhone(e.target.value); });
                },
                validate() {
                    const tel   = val("rTel").replace(/\D/g, "");
                    const email = val("rEmail");
                    const pix   = val("rPix");
                    if (tel.length < 10)       { showNotification("Telefone inválido.", "error");      return false; }
                    if (!email.includes("@"))  { showNotification("E-mail inválido.", "error");        return false; }
                    if (!pix)                  { showNotification("Informe sua chave Pix.", "error");  return false; }
                    return true;
                },
            },
            {
                label: "Licença & Privacidade",
                render() {
                    const hasAccepted = isEditing && (
                        currentUserData?.candidato === true || currentUserData?.artista === true
                    );
                    return `
                        <h2 class="k-step-title">Licença & Privacidade</h2>
                        <p class="k-step-desc">Leia e aceite os termos antes de continuar.</p>
                        <div class="k-terms">
                            <strong>Termos de uso para artistas Kauara</strong><br><br>
                            Ao se cadastrar como artista na plataforma Kauara, você autoriza o uso das
                            suas obras para exibição e venda dentro do ambiente da plataforma. Seus dados
                            pessoais serão tratados de acordo com a LGPD (Lei Geral de Proteção de Dados
                            – Lei nº 13.709/2018). A Kauara não vende nem compartilha seus dados com
                            terceiros sem consentimento. O cadastro está sujeito à aprovação manual pela
                            equipe Kauara. Após aprovação, você poderá publicar obras e receber pagamentos
                            via Pix.<br><br>
                            Ao aceitar, você confirma ter lido e concordado com todos os termos acima.
                        </div>
                        ${hasAccepted
                            ? `<div class="k-accepted">✅ Você já aceitou os termos anteriormente.</div>`
                            : `<label class="k-checkbox">
                                <input type="checkbox" id="rLicenca">
                                Eu li e aceito a licença de privacidade e os termos de uso.
                               </label>`
                        }
                    `;
                },
                validate() {
                    const checkbox = document.getElementById("rLicenca");
                    if (checkbox && !checkbox.checked) {
                        showNotification("Você precisa aceitar os termos para continuar.", "error");
                        return false;
                    }
                    return true;
                },
            },
            {
                label: "Portfólio",
                render() {
                    return `
                        <h2 class="k-step-title">Portfólio</h2>
                        <p class="k-step-desc">
                            Envie entre ${MIN_IMG} e ${MAX_IMG} imagens das suas obras.
                            Nossa equipe irá analisá-las com cuidado.
                        </p>
                        <div class="k-art-grid" id="kArtGrid"></div>
                        <div class="k-art-footer">
                            <span class="k-art-counter" id="kArtCounter">0 / ${MAX_IMG}</span>
                            <button class="k-add-art" id="kAddArt">+ Adicionar imagem</button>
                        </div>
                        <input type="file" id="kArtFileInput" accept="image/*" multiple style="display:none">
                    `;
                },
                afterRender() { initArtGrid(); },
                validate() {
                    const total = artworkFiles.length +
                        (existingArtworkUrls.length - artworkIdsToDelete.length);
                    if (total < MIN_IMG) {
                        showNotification(`Envie pelo menos ${MIN_IMG} imagens.`, "error");
                        return false;
                    }
                    return true;
                },
            },
        ];

        // ── Render step ────────────────────────────────────────────────────
        function renderStep() {
            const s = steps[step - 1];
            stepContentEl.innerHTML = s.render();
            if (s.afterRender) s.afterRender();

            if (!isEditing) {
                if (stepNumEl)  stepNumEl.textContent   = step;
                if (stepLabelEl) stepLabelEl.textContent = s.label;
                if (progressFill) progressFill.style.width = `${(step / TOTAL) * 100}%`;
                backBtn.style.display   = step > 1 ? "block" : "none";
                nextBtn.textContent     = step === TOTAL ? "Enviar candidatura ✓" : "Próximo →";
            } else {
                backBtn.style.display   = step > 1 ? "block" : "none";
                nextBtn.textContent     = "Salvar alterações";
            }

            // Focus first field
            setTimeout(() => stepContentEl.querySelector("input, button")?.focus(), 60);
        }

        // ── Art grid ───────────────────────────────────────────────────────
        function initArtGrid() {
            const grid     = document.getElementById("kArtGrid");
            const fileInp  = document.getElementById("kArtFileInput");
            const addBtn   = document.getElementById("kAddArt");
            const counter  = document.getElementById("kArtCounter");

            function fileToDataURL(file) {
                return new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload  = e => res(e.target.result);
                    r.onerror = rej;
                    r.readAsDataURL(file);
                });
            }

            async function renderGrid() {
                grid.innerHTML = "";
                const activeUrls = existingArtworkUrls.filter(u => !artworkIdsToDelete.includes(u));

                for (const url of activeUrls) {
                    const card = document.createElement("div");
                    card.className = "k-art-card";
                    card.innerHTML = `
                        <img src="${url}" alt="Obra existente" loading="lazy">
                        <button class="k-art-card__remove" data-url="${url}" aria-label="Remover imagem">&times;</button>
                    `;
                    card.querySelector("button").addEventListener("click", (e) => {
                        artworkIdsToDelete.push(e.currentTarget.dataset.url);
                        renderGrid();
                    });
                    grid.appendChild(card);
                }

                for (let i = 0; i < artworkFiles.length; i++) {
                    const url  = await fileToDataURL(artworkFiles[i]);
                    const card = document.createElement("div");
                    card.className = "k-art-card";
                    card.innerHTML = `
                        <img src="${url}" alt="Nova obra">
                        <button class="k-art-card__remove" data-idx="${i}" aria-label="Remover imagem">&times;</button>
                    `;
                    card.querySelector("button").addEventListener("click", (e) => {
                        artworkFiles.splice(+e.currentTarget.dataset.idx, 1);
                        renderGrid();
                    });
                    grid.appendChild(card);
                }

                const total = (existingArtworkUrls.length - artworkIdsToDelete.length) + artworkFiles.length;
                counter.textContent = `${total} / ${MAX_IMG} imagens`;
            }

            fileInp.addEventListener("change", (e) => {
                const slots = MAX_IMG - (
                    (existingArtworkUrls.length - artworkIdsToDelete.length) + artworkFiles.length
                );
                const picked = Array.from(e.target.files).slice(0, slots);
                if (Array.from(e.target.files).length > slots)
                    showNotification(`Limite de ${MAX_IMG} imagens atingido.`, "error");
                artworkFiles.push(...picked);
                renderGrid();
                fileInp.value = "";
            });

            addBtn.addEventListener("click", () => fileInp.click());
            renderGrid();
        }

        // ── Navigation ─────────────────────────────────────────────────────
        nextBtn.addEventListener("click", async () => {
            const s = steps[step - 1];
            if (!s.validate()) return;

            if (!isEditing && step < TOTAL) {
                step++;
                renderStep();
            } else {
                await submit();
            }
        });

        backBtn.addEventListener("click", () => {
            if (step > 1) { step--; renderStep(); }
        });

        renderStep();

        // ── Submit ─────────────────────────────────────────────────────────
        async function submit() {
            nextBtn.disabled = true;

            // Progress bar
            overlay.querySelector(".k-nav").insertAdjacentHTML("beforebegin", `
                <div id="kSubmitProgress" style="margin-top:16px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span id="kSubmitLabel" style="font-size:13px;color:var(--k-warm-gray);">
                            ${isEditing ? "Salvando…" : "Enviando candidatura…"}
                        </span>
                        <span id="kSubmitPct" style="font-size:13px;color:var(--k-warm-gray);">0%</span>
                    </div>
                    <div style="height:3px;background:var(--k-light-clay);border-radius:3px;overflow:hidden;">
                        <div id="kSubmitFill" style="height:100%;background:var(--k-clay);border-radius:3px;width:0%;transition:width .25s ease;"></div>
                    </div>
                </div>
            `);

            const setProgress = (pct, label) => {
                const fill  = overlay.querySelector("#kSubmitFill");
                const pctEl = overlay.querySelector("#kSubmitPct");
                const lblEl = overlay.querySelector("#kSubmitLabel");
                if (fill)  fill.style.width = `${pct}%`;
                if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
                if (lblEl && label) lblEl.textContent = label;
            };

            try {
                const totalSteps = artworkIdsToDelete.length + artworkFiles.length + 1;
                let done = 0;
                const tick = (label) => { done++; setProgress((done / totalSteps) * 100, label); };

                // Delete removed artworks in parallel
                await Promise.all(artworkIdsToDelete.map(async (urlToDelete) => {
                    const snap = await db.collection("candidate_arts")
                        .where("userId",   "==", currentUserId)
                        .where("imageUrl", "==", urlToDelete)
                        .limit(1).get();
                    if (!snap.empty) {
                        try { await storage.refFromURL(urlToDelete).delete(); } catch (_) {}
                        await snap.docs[0].ref.delete();
                    }
                    tick("Removendo imagens…");
                }));

                // Upload new artworks in parallel
                await Promise.all(artworkFiles.map(async (file, i) => {
                    const ext = file.name.split(".").pop();
                    const ref = storage.ref(`candidate_arts/${currentUserId}/${Date.now()}_${i}.${ext}`);
                    await ref.put(file);
                    const downloadUrl = await ref.getDownloadURL();
                    await db.collection("candidate_arts").add({
                        userId:    currentUserId,
                        imageUrl:  downloadUrl,
                        fileName:  file.name,
                        fileSize:  file.size,
                        mimeType:  file.type,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    tick(`Enviando imagens…`);
                }));

                // Save user doc
                setProgress(95, "Salvando dados…");
                const wasApproved = currentUserData?.candidato === true || currentUserData?.artista === true;
                await db.collection("users").doc(currentUserId).set({
                    displayName:     val("rNome"),
                    fullLegalName:   val("rNome"),
                    idade:           parseInt(val("rIdade"), 10),
                    cpf:             val("rCpf"),
                    telefone:        val("rTel"),
                    email:           val("rEmail"),
                    pixKey:          val("rPix"),
                    candidato:       wasApproved ? currentUserData.candidato : false,
                    artista:         wasApproved ? currentUserData.artista   : false,
                    candidatoSentAt: wasApproved
                        ? currentUserData.candidatoSentAt
                        : firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });

                setProgress(100, "Concluído!");
                await new Promise(r => setTimeout(r, 400));

                showNotification(
                    isEditing
                        ? "Alterações salvas com sucesso! ✅"
                        : "Candidatura enviada! 🎉 Aguarde nossa análise.",
                    "success"
                );
                overlay.remove();
                syncButtonState();

            } catch (err) {
                console.error("[Kauara] submit error:", err);
                showNotification("Erro ao enviar: " + err.message, "error");
                overlay.querySelector("#kSubmitProgress")?.remove();
                nextBtn.disabled = false;
            }
        }
    }

    // ── Bind trigger ──────────────────────────────────────────────────────────
    document.getElementById("showArtistModalBtn")
        ?.addEventListener("click", openModal);
});