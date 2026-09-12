let state = {
  data: null,
  activeTagId: null, // null = "Todos" (respeita settings.defaultTagId no boot)
  searchTerm: "",
  editingId: null, // null = criando novo (modal)
  // edição inline no card: { id, text, tagIds, pinned, paperColor, washi } | null
  inlineEdit: null,
  // rascunho visual do modal: { paperColor, washi }
  modalDraft: null,
  // ids de cards com preview expandido (só sessão do popup)
  expandedIds: new Set()
};

/** Tags que tipicamente marcam trechos de código. */
const CODE_TAG_RE =
  /^(código|codigo|code|sql|css|js|ts|tsx|jsx|bash|shell|sh|python|py|html|json|regex|git|yaml|yml|xml|go|rust|java|c\+\+|cpp)$/i;

/** Heurística leve: tag de código ou texto com cara de snippet. */
function isCodeLike(item) {
  const tagNames = (item.tagIds || [])
    .map((tid) => state.data.tags.find((t) => t.id === tid)?.name || "")
    .filter(Boolean);
  if (tagNames.some((n) => CODE_TAG_RE.test(n))) return true;

  const t = item.text || "";
  if (/```/.test(t)) return true;
  if (
    /^\s*(function|const|let|var|import|export|SELECT|FROM|WHERE|def |class |#!\/|package |using )/m.test(
      t
    )
  ) {
    return true;
  }
  if (t.includes("\n") && /[{};]\s*$/m.test(t)) return true;
  if (t.split("\n").length >= 2 && /=>|::|&&|\|\||<\/?[a-zA-Z]/.test(t)) {
    return true;
  }
  return false;
}

const pendingExpandChecks = [];

function queueExpandCheck(itemId, textEl, btn) {
  pendingExpandChecks.push({ itemId, textEl, btn });
}

function flushExpandChecks() {
  if (pendingExpandChecks.length === 0) return;
  const batch = pendingExpandChecks.splice(0);
  requestAnimationFrame(() => {
    batch.forEach(({ itemId, textEl, btn }) => {
      if (!textEl.isConnected || !btn.isConnected) return;
      const expanded = state.expandedIds.has(itemId);
      if (expanded || textEl.scrollHeight > textEl.clientHeight + 1) {
        btn.hidden = false;
      }
    });
  });
}

const TAG_COLOR_KEYS = [
  "coral", "sun", "teal", "violet", "green", "orange", "blue", "pink", "slate"
];

const $ = (sel) => document.querySelector(sel);

const els = {
  searchInput: $("#searchInput"),
  tagBar: $("#tagBar"),
  searchTagResults: $("#searchTagResults"),
  list: $("#list"),
  emptyState: $("#emptyState"),
  addBtn: $("#addBtn"),
  settingsBtn: $("#settingsBtn"),

  editModal: $("#editModal"),
  modalTitle: $("#modalTitle"),
  itemText: $("#itemText"),
  tagPicker: $("#tagPicker"),
  newTagInput: $("#newTagInput"),
  newTagBtn: $("#newTagBtn"),
  pinCheckbox: $("#pinCheckbox"),
  paperColorPicker: $("#paperColorPicker"),
  washiSection: $("#washiSection"),
  washiPicker: $("#washiPicker"),
  deleteBtn: $("#deleteBtn"),
  cancelBtn: $("#cancelBtn"),
  saveBtn: $("#saveBtn"),

  settingsModal: $("#settingsModal"),
  defaultTagSelect: $("#defaultTagSelect"),
  closeSettingsBtn: $("#closeSettingsBtn"),
  tagManageList: $("#tagManageList"),
  deleteAllBtn: $("#deleteAllBtn"),
  minimalToggle: $("#minimalToggle"),
  exportBackupBtn: $("#exportBackupBtn"),
  importBackupBtn: $("#importBackupBtn"),
  importBackupInput: $("#importBackupInput"),
  connectDriveBtn: $("#connectDriveBtn"),
  disconnectDriveBtn: $("#disconnectDriveBtn"),
  syncNowBtn: $("#syncNowBtn"),
  connectDriveWrap: $("#connectDriveWrap"),
  disconnectDriveWrap: $("#disconnectDriveWrap"),
  syncNowWrap: $("#syncNowWrap"),
  driveSyncStatus: $("#driveSyncStatus"),
  driveSyncBlurb: $("#driveSyncBlurb"),

  confirmDeleteModal: $("#confirmDeleteModal"),
  confirmDeleteCheckbox: $("#confirmDeleteCheckbox"),
  confirmDeleteAllBtn: $("#confirmDeleteAllBtn"),
  cancelDeleteAllBtn: $("#cancelDeleteAllBtn"),

  toast: $("#toast")
};

const TRASH_SVG =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M4 6h12M8 6V4.5a1 1 0 011-1h2a1 1 0 011 1V6M6 6l.6 9.4a1 1 0 001 .93h4.8a1 1 0 001-.93L14 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

const DRAG_SVG =
  '<svg viewBox="0 0 12 18" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<circle cx="2" cy="2" r="1.3" fill="currentColor"/><circle cx="2" cy="9" r="1.3" fill="currentColor"/><circle cx="2" cy="16" r="1.3" fill="currentColor"/>' +
  '<circle cx="9" cy="2" r="1.3" fill="currentColor"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="16" r="1.3" fill="currentColor"/>' +
  "</svg>";

const EDIT_SVG =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
  "</svg>";

init();

async function init() {
  state.data = await loadData();
  state.activeTagId = state.data.settings.defaultTagId || null;

  applyTheme();
  render();

  els.searchInput.addEventListener("input", onSearchInput);
  els.addBtn.addEventListener("click", () => {
    cancelInlineEdit();
    openModal(null);
  });
  els.settingsBtn.addEventListener("click", () => {
    cancelInlineEdit();
    openSettings();
  });
  els.closeSettingsBtn.addEventListener("click", closeSettings);
  els.cancelBtn.addEventListener("click", closeModal);
  els.saveBtn.addEventListener("click", onSaveItem);
  els.deleteBtn.addEventListener("click", onDeleteItem);
  els.newTagBtn.addEventListener("click", onAddTagInModal);
  els.newTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onAddTagInModal(); }
  });
  els.editModal.addEventListener("click", (e) => {
    if (e.target === els.editModal) closeModal();
  });
  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });
  els.defaultTagSelect.addEventListener("change", async (e) => {
    const val = e.target.value || null;
    state.data.settings = await setSetting("defaultTagId", val);
  });

  els.tagBar.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      els.tagBar.scrollLeft += e.deltaY;
    },
    { passive: false }
  );

  els.deleteAllBtn.addEventListener("click", () => {
    els.confirmDeleteCheckbox.checked = false;
    els.confirmDeleteAllBtn.disabled = true;
    els.confirmDeleteModal.classList.remove("hidden");
  });
  els.confirmDeleteCheckbox.addEventListener("change", (e) => {
    els.confirmDeleteAllBtn.disabled = !e.target.checked;
  });
  els.cancelDeleteAllBtn.addEventListener("click", () => {
    els.confirmDeleteModal.classList.add("hidden");
  });
  els.confirmDeleteModal.addEventListener("click", (e) => {
    if (e.target === els.confirmDeleteModal) els.confirmDeleteModal.classList.add("hidden");
  });
  els.confirmDeleteAllBtn.addEventListener("click", async () => {
    await clearAllData();
    state.data = await loadData();
    state.activeTagId = null;
    els.confirmDeleteModal.classList.add("hidden");
    closeSettings();
    applyTheme();
    render();
  });

  els.minimalToggle.addEventListener("change", async (e) => {
    state.data.settings = await setSetting("minimalMode", e.target.checked);
    applyTheme();
  });

  els.exportBackupBtn.addEventListener("click", onExportBackup);
  els.importBackupBtn.addEventListener("click", () => els.importBackupInput.click());
  els.importBackupInput.addEventListener("change", onImportBackupFile);

  els.connectDriveBtn.addEventListener("click", onConnectDrive);
  els.disconnectDriveBtn.addEventListener("click", onDisconnectDrive);
  els.syncNowBtn.addEventListener("click", onSyncNow);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.fichario_data_v1) {
      loadData().then((data) => {
        state.data = data;
        applyTheme();
        render();
        if (!els.settingsModal.classList.contains("hidden")) {
          refreshSettingsForm();
        }
      });
    }
    if (changes.fichario_sync_v1 && !els.settingsModal.classList.contains("hidden")) {
      // Em operação local, só atualiza o cache — paintDrive respeita driveBusy
      sendDriveMessage({ type: "DRIVE_SYNC_STATUS" }).then((status) => {
        driveStatusCache = status;
        paintDriveStatusFromCache();
      });
    }
  });

  // Se o Drive já estiver conectado, puxa sync ao abrir o popup
  chrome.runtime.sendMessage({ type: "DRIVE_SYNC_STATUS" }, (status) => {
    if (chrome.runtime.lastError) return;
    if (status && status.meta && status.meta.enabled && status.meta.connected) {
      chrome.runtime.sendMessage({ type: "DRIVE_SYNC_NOW", interactive: false });
    }
  });

  els.pinCheckbox.addEventListener("change", () => {
    if (!state.modalDraft) return;
    if (els.pinCheckbox.checked) {
      if (!state.modalDraft.washi) state.modalDraft.washi = randomWashi();
    } else {
      state.modalDraft.washi = null;
    }
    syncModalVisual();
  });
}

function applyTheme() {
  document.body.classList.toggle("theme-minimal", !!state.data.settings.minimalMode);
}

function tagColorClass(name) {
  let h = 0;
  const s = (name || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "tag-" + TAG_COLOR_KEYS[h % TAG_COLOR_KEYS.length];
}

/* ---------------- Render ---------------- */

function render() {
  renderTagBar();
  renderSearchTagResults();
  renderList();
}

function renderTagBar() {
  els.tagBar.innerHTML = "";
  const allTab = makeTagTab("todos", state.activeTagId === null, () => {
    state.activeTagId = null;
    render();
  });
  els.tagBar.appendChild(allTab);

  state.data.tags.forEach((tag) => {
    const tab = makeTagTab("#" + tag.name, state.activeTagId === tag.id, () => {
      state.activeTagId = tag.id;
      render();
    }, tagColorClass(tag.name));
    els.tagBar.appendChild(tab);
  });

  const activeTab = els.tagBar.querySelector(".tag-tab.active");
  if (activeTab) {
    activeTab.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }
}

function makeTagTab(label, active, onClick, colorClass) {
  const btn = document.createElement("button");
  btn.className = "tag-tab" + (active ? " active" : "");
  if (active && colorClass && label !== "todos") {
    btn.classList.add(colorClass);
  }
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderSearchTagResults() {
  const term = state.searchTerm.trim().toLowerCase();
  if (!term) {
    els.searchTagResults.classList.add("hidden");
    els.searchTagResults.innerHTML = "";
    return;
  }
  const matchingTags = state.data.tags.filter((t) =>
    t.name.toLowerCase().includes(term)
  );
  if (matchingTags.length === 0) {
    els.searchTagResults.classList.add("hidden");
    els.searchTagResults.innerHTML = "";
    return;
  }
  els.searchTagResults.classList.remove("hidden");
  els.searchTagResults.innerHTML = "";
  matchingTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "search-tag-chip " + tagColorClass(tag.name);
    chip.textContent = "#" + tag.name;
    chip.addEventListener("click", () => {
      state.activeTagId = tag.id;
      state.searchTerm = "";
      els.searchInput.value = "";
      render();
    });
    els.searchTagResults.appendChild(chip);
  });
}

function getFilteredItems() {
  const term = state.searchTerm.trim().toLowerCase();
  let items = state.data.items.slice();

  if (term) {
    items = items.filter((i) => i.text.toLowerCase().includes(term));
  } else if (state.activeTagId) {
    items = items.filter((i) => (i.tagIds || []).includes(state.activeTagId));
  }

  items.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (a.order || 0) - (b.order || 0);
  });

  return items;
}

function renderList() {
  const items = getFilteredItems();
  els.list.innerHTML = "";

  if (items.length === 0) {
    els.emptyState.classList.remove("hidden");
    const title = els.emptyState.querySelector(".empty-title");
    const sub = els.emptyState.querySelector(".empty-sub");
    const mascots = els.emptyState.querySelector(".empty-mascots");
    if (state.searchTerm.trim() || state.activeTagId) {
      if (title) title.textContent = "Nada encontrado";
      if (sub) sub.textContent = "Tente outros termos ou limpe os filtros.";
      if (mascots) mascots.classList.add("hidden");
    } else {
      if (title) title.textContent = "SnipStashi vazio";
      if (sub) {
        sub.textContent =
          'Toque em “+” ou selecione um texto em qualquer página e use o botão direito → Salvar no SnipStashi.';
      }
      if (mascots) mascots.classList.remove("hidden");
    }
    return;
  }
  els.emptyState.classList.add("hidden");

  items.forEach((item) => {
    els.list.appendChild(renderCard(item));
  });
  flushExpandChecks();
}

function renderCard(item) {
  const isEditing = !!(state.inlineEdit && state.inlineEdit.id === item.id);
  const draft = isEditing ? state.inlineEdit : null;

  const card = document.createElement("article");
  card.className =
    "card" +
    ((isEditing ? draft.pinned : item.pinned) ? " pinned" : "") +
    (isEditing ? " card-editing" : "");
  card.dataset.id = item.id;
  card.style.setProperty("--card-rot", (item.rotation || 0) + "deg");
  card.style.setProperty(
    "--card-bg",
    (isEditing ? draft.paperColor : item.paperColor) || "#fdfae8"
  );

  // Washi OUTSIDE the clipped paper (sibling)
  const showWashi = isEditing
    ? !!(draft.pinned && draft.washi)
    : !!(item.pinned && item.washi);
  if (showWashi) {
    const washi = document.createElement("div");
    washi.className = "card-washi " + (isEditing ? draft.washi : item.washi);
    washi.setAttribute("aria-hidden", "true");
    card.appendChild(washi);
  }

  const paper = document.createElement("div");
  paper.className = "card-paper paper-shadow torn-" + (item.tornVariant || 1);

  if (item.pinned && !isEditing) {
    const stamp = document.createElement("span");
    stamp.className = "card-stamp stamp";
    stamp.textContent = "fixado";
    paper.appendChild(stamp);
  }

  if (!isEditing) {
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.title = "Arrastar para reordenar";
    handle.innerHTML = DRAG_SVG;
    attachDrag(handle, card);
    paper.appendChild(handle);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  if (isEditing) {
    const textarea = document.createElement("textarea");
    textarea.className = "card-text-edit";
    textarea.value = draft.text;
    textarea.rows = Math.min(8, Math.max(3, draft.text.split("\n").length + 1));
    textarea.setAttribute("aria-label", "Texto do item");
    textarea.addEventListener("click", (e) => e.stopPropagation());
    textarea.addEventListener("input", () => {
      state.inlineEdit.text = textarea.value;
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelInlineEdit();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commitInlineEdit();
      }
    });
    body.appendChild(textarea);

    const tagPicker = document.createElement("div");
    tagPicker.className = "card-inline-tags";
    state.data.tags.forEach((tag) => {
      const pill = document.createElement("button");
      pill.type = "button";
      const selected = draft.tagIds.includes(tag.id);
      pill.className =
        "tag-pick " + tagColorClass(tag.name) + (selected ? " selected" : "");
      pill.textContent = "#" + tag.name;
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = state.inlineEdit.tagIds.indexOf(tag.id);
        if (idx === -1) state.inlineEdit.tagIds.push(tag.id);
        else state.inlineEdit.tagIds.splice(idx, 1);
        render();
        focusInlineTextarea();
      });
      tagPicker.appendChild(pill);
    });
    body.appendChild(tagPicker);

    const pinLabel = document.createElement("label");
    pinLabel.className = "pin-toggle card-inline-pin";
    pinLabel.addEventListener("click", (e) => e.stopPropagation());
    const pinInput = document.createElement("input");
    pinInput.type = "checkbox";
    pinInput.checked = !!draft.pinned;
    pinInput.addEventListener("change", () => {
      state.inlineEdit.pinned = pinInput.checked;
      if (pinInput.checked) {
        if (!state.inlineEdit.washi) state.inlineEdit.washi = randomWashi();
      } else {
        state.inlineEdit.washi = null;
      }
      render();
      focusInlineTextarea();
    });
    const pinSpan = document.createElement("span");
    pinSpan.textContent = "Fixar no topo";
    pinLabel.appendChild(pinInput);
    pinLabel.appendChild(pinSpan);
    body.appendChild(pinLabel);

    const visual = document.createElement("div");
    visual.className = "card-inline-visual";
    visual.addEventListener("click", (e) => e.stopPropagation());

    const colorLabel = document.createElement("label");
    colorLabel.className = "modal-label";
    colorLabel.textContent = "Cor do papel";
    visual.appendChild(colorLabel);
    visual.appendChild(
      buildPaperColorPicker(draft.paperColor, (color) => {
        state.inlineEdit.paperColor = color;
        render();
        focusInlineTextarea();
      })
    );

    if (draft.pinned) {
      const washiLabel = document.createElement("label");
      washiLabel.className = "modal-label";
      washiLabel.textContent = "Washi";
      visual.appendChild(washiLabel);
      visual.appendChild(
        buildWashiPicker(draft.washi, (washi) => {
          state.inlineEdit.washi = washi;
          render();
          focusInlineTextarea();
        })
      );
    }
    body.appendChild(visual);

    const actions = document.createElement("div");
    actions.className = "card-inline-actions";
    actions.addEventListener("click", (e) => e.stopPropagation());

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-danger";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => deleteInlineEdit());

    const right = document.createElement("div");
    right.className = "card-inline-actions-right";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-ghost";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.addEventListener("click", cancelInlineEdit);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-primary";
    saveBtn.textContent = "Salvar";
    saveBtn.addEventListener("click", commitInlineEdit);

    right.appendChild(cancelBtn);
    right.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(right);
    body.appendChild(actions);
  } else {
    const expanded = state.expandedIds.has(item.id);
    const codeLike = isCodeLike(item);

    const text = document.createElement("div");
    text.className =
      "card-text" +
      (codeLike ? " is-code" : "") +
      (expanded ? " is-expanded" : "");
    text.textContent = item.text;
    body.appendChild(text);

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "card-expand-btn";
    expandBtn.hidden = !expanded;
    expandBtn.textContent = expanded ? "Ver menos" : "Ver mais";
    expandBtn.setAttribute(
      "aria-label",
      expanded ? "Recolher conteúdo" : "Expandir conteúdo"
    );
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.expandedIds.has(item.id)) state.expandedIds.delete(item.id);
      else state.expandedIds.add(item.id);
      render();
    });
    body.appendChild(expandBtn);
    if (!expanded) queueExpandCheck(item.id, text, expandBtn);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    (item.tagIds || []).forEach((tid) => {
      const tag = state.data.tags.find((t) => t.id === tid);
      if (!tag) return;
      const chip = document.createElement("span");
      chip.className = "card-tag " + tagColorClass(tag.name);
      chip.textContent = "#" + tag.name;
      meta.appendChild(chip);
    });
    if (meta.children.length > 0) body.appendChild(meta);
  }

  paper.appendChild(body);

  if (!isEditing) {
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.title = "Editar";
    editBtn.innerHTML = EDIT_SVG;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startInlineEdit(item.id);
    });
    paper.appendChild(editBtn);
  }

  card.appendChild(paper);

  if (!isEditing) {
    card.addEventListener("click", () => copyItem(item));
  } else {
    card.addEventListener("click", (e) => e.stopPropagation());
  }

  return card;
}

function startInlineEdit(itemId) {
  const item = state.data.items.find((i) => i.id === itemId);
  if (!item) return;
  state.inlineEdit = {
    id: item.id,
    text: item.text,
    tagIds: [...(item.tagIds || [])],
    pinned: !!item.pinned,
    paperColor: item.paperColor || randomPaperColor(),
    washi: item.pinned ? (item.washi || randomWashi()) : null
  };
  render();
  focusInlineTextarea();
}

function focusInlineTextarea() {
  requestAnimationFrame(() => {
    const ta = els.list.querySelector(".card-editing .card-text-edit");
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  });
}

function cancelInlineEdit() {
  state.inlineEdit = null;
  render();
}

async function commitInlineEdit() {
  if (!state.inlineEdit) return;
  const text = state.inlineEdit.text.trim();
  if (!text) {
    focusInlineTextarea();
    return;
  }
  const { id, tagIds, pinned, paperColor, washi } = state.inlineEdit;
  await updateItem(id, {
    text,
    tagIds,
    pinned,
    paperColor,
    washi: pinned ? washi : null
  });
  state.inlineEdit = null;
  state.data = await loadData();
  render();
  showToast("Salvo ✓");
}

async function deleteInlineEdit() {
  if (!state.inlineEdit) return;
  const id = state.inlineEdit.id;
  const item = state.data.items.find((i) => i.id === id);
  await deleteItem(id);
  state.inlineEdit = null;
  state.data = await loadData();
  render();
  if (item) showUndoToast(item);
}

/* ---------------- Copiar ---------------- */

async function copyItem(item) {
  try {
    await navigator.clipboard.writeText(item.text);
    showToast("Copiado ✓");
  } catch (err) {
    showToast("Não foi possível copiar");
  }
}

function showToast(msg) {
  clearTimeout(showToast._t);
  els.toast.innerHTML = "";
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 1400);
}

function showUndoToast(deletedItem) {
  clearTimeout(showToast._t);
  els.toast.innerHTML = "";

  const msg = document.createElement("span");
  msg.textContent = "Item excluído";

  const undoBtn = document.createElement("button");
  undoBtn.className = "toast-undo-btn";
  undoBtn.textContent = "Desfazer";
  undoBtn.addEventListener("click", async () => {
    clearTimeout(showToast._t);
    await restoreItem(deletedItem);
    state.data = await loadData();
    render();
    els.toast.classList.add("hidden");
  });

  els.toast.appendChild(msg);
  els.toast.appendChild(undoBtn);
  els.toast.classList.remove("hidden");
  showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 5000);
}

/* ---------------- Busca ---------------- */

function onSearchInput(e) {
  state.searchTerm = e.target.value;
  render();
}

/* ---------------- Modal criar/editar ---------------- */

function buildPaperColorPicker(selectedColor, onSelect) {
  const row = document.createElement("div");
  row.className = "swatch-picker";
  PAPER_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch" + (color === selectedColor ? " selected" : "");
    btn.style.background = color;
    btn.title = color;
    btn.setAttribute("aria-label", "Cor " + color);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(color);
    });
    row.appendChild(btn);
  });
  return row;
}

function buildWashiPicker(selectedWashi, onSelect) {
  const row = document.createElement("div");
  row.className = "washi-picker";
  WASHI_CLASSES.forEach((washi) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "washi-swatch " + washi + (washi === selectedWashi ? " selected" : "");
    btn.title = washi.replace("washi-", "");
    btn.setAttribute("aria-label", "Washi " + washi.replace("washi-", ""));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(washi);
    });
    row.appendChild(btn);
  });
  return row;
}

function syncModalVisual() {
  if (!state.modalDraft) return;
  const paper = els.editModal.querySelector(".modal-paper");
  const washiEl = els.editModal.querySelector(".modal-washi");
  if (paper) paper.style.background = state.modalDraft.paperColor;

  els.paperColorPicker.innerHTML = "";
  els.paperColorPicker.appendChild(
    buildPaperColorPicker(state.modalDraft.paperColor, (color) => {
      state.modalDraft.paperColor = color;
      syncModalVisual();
    })
  );

  const pinned = els.pinCheckbox.checked;
  els.washiSection.classList.toggle("hidden", !pinned);
  if (pinned) {
    if (!state.modalDraft.washi) state.modalDraft.washi = randomWashi();
    els.washiPicker.innerHTML = "";
    els.washiPicker.appendChild(
      buildWashiPicker(state.modalDraft.washi, (washi) => {
        state.modalDraft.washi = washi;
        syncModalVisual();
      })
    );
    if (washiEl) {
      washiEl.className = "modal-washi " + state.modalDraft.washi;
    }
  } else if (washiEl) {
    washiEl.className = "modal-washi washi-violet";
  }
}

function openModal(itemId) {
  state.editingId = itemId;
  const item = itemId ? state.data.items.find((i) => i.id === itemId) : null;

  els.modalTitle.textContent = item ? "Editar item" : "Novo item";
  els.itemText.value = item ? item.text : "";
  els.pinCheckbox.checked = !!(item && item.pinned);
  els.deleteBtn.classList.toggle("hidden", !item);

  state.modalDraft = {
    paperColor: item ? (item.paperColor || randomPaperColor()) : randomPaperColor(),
    washi: item && item.pinned
      ? (item.washi || randomWashi())
      : null
  };
  if (els.pinCheckbox.checked && !state.modalDraft.washi) {
    state.modalDraft.washi = randomWashi();
  }

  renderTagPicker(item ? item.tagIds || [] : []);
  syncModalVisual();

  els.editModal.classList.remove("hidden");
  els.itemText.focus();
}

function closeModal() {
  els.editModal.classList.add("hidden");
  state.editingId = null;
  state.modalDraft = null;
}

function renderTagPicker(selectedIds) {
  els.tagPicker.innerHTML = "";
  els.tagPicker.dataset.selected = JSON.stringify(selectedIds);

  state.data.tags.forEach((tag) => {
    const pill = document.createElement("button");
    pill.type = "button";
    const selected = selectedIds.includes(tag.id);
    pill.className =
      "tag-pick " + tagColorClass(tag.name) + (selected ? " selected" : "");
    pill.textContent = "#" + tag.name;
    pill.addEventListener("click", () => {
      const current = JSON.parse(els.tagPicker.dataset.selected || "[]");
      const idx = current.indexOf(tag.id);
      if (idx === -1) current.push(tag.id);
      else current.splice(idx, 1);
      renderTagPicker(current);
    });
    els.tagPicker.appendChild(pill);
  });
}

async function onAddTagInModal() {
  const name = els.newTagInput.value.trim();
  if (!name) return;
  const tag = await addTag(name);
  state.data = await loadData();
  els.newTagInput.value = "";
  const current = JSON.parse(els.tagPicker.dataset.selected || "[]");
  if (!current.includes(tag.id)) current.push(tag.id);
  renderTagPicker(current);
}

async function onSaveItem() {
  const text = els.itemText.value.trim();
  if (!text) {
    els.itemText.focus();
    return;
  }
  const tagIds = JSON.parse(els.tagPicker.dataset.selected || "[]");
  const pinned = els.pinCheckbox.checked;
  const paperColor = state.modalDraft
    ? state.modalDraft.paperColor
    : randomPaperColor();
  const washi = pinned
    ? (state.modalDraft && state.modalDraft.washi) || randomWashi()
    : null;

  if (state.editingId) {
    await updateItem(state.editingId, { text, tagIds, pinned, paperColor, washi });
  } else {
    await addItem({ text, tagIds, pinned, paperColor, washi });
  }

  state.data = await loadData();
  closeModal();
  render();
}

async function onDeleteItem() {
  if (!state.editingId) return;
  const item = state.data.items.find((i) => i.id === state.editingId);
  await deleteItem(state.editingId);
  state.data = await loadData();
  closeModal();
  render();
  if (item) showUndoToast(item);
}

/* ---------------- Configurações ---------------- */

function refreshSettingsForm() {
  els.minimalToggle.checked = !!state.data.settings.minimalMode;

  els.defaultTagSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "Todos";
  els.defaultTagSelect.appendChild(optAll);
  state.data.tags.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag.id;
    opt.textContent = tag.name;
    els.defaultTagSelect.appendChild(opt);
  });
  els.defaultTagSelect.value = state.data.settings.defaultTagId || "";

  renderTagManageList();
}

function openSettings() {
  refreshSettingsForm();
  refreshDriveSyncUi();
  els.settingsModal.classList.remove("hidden");
}

function sendDriveMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Falha ao falar com o sync."
        });
        return;
      }
      resolve(response || { ok: false, error: "Sem resposta do sync." });
    });
  });
}

function formatSyncTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return "";
  }
}

/** null | "connecting" | "syncing" | "disconnecting" */
let driveBusy = null;
/** Último status conhecido do background (para reaplicar botões). */
let driveStatusCache = null;

function setDriveStatusTone(tone) {
  els.driveSyncStatus.classList.remove("is-ok", "is-error", "is-syncing");
  if (tone) els.driveSyncStatus.classList.add(tone);
}

/**
 * Única fonte de verdade da UI dos botões de Drive.
 * - desconectado: só "Conectar"
 * - conectado: "Sincronizar agora" + "Desconectar"
 * - busy syncing/disconnecting: os dois ficam visíveis mas locked
 */
function setDriveBtnLocked(wrap, btn, locked) {
  wrap.classList.toggle("is-locked", !!locked);
  btn.disabled = !!locked;
  btn.setAttribute("aria-disabled", locked ? "true" : "false");
}

function setDriveBtnVisible(wrap, btn, visible) {
  wrap.classList.toggle("hidden", !visible);
  wrap.hidden = !visible;
  btn.hidden = !visible;
}

function applyDriveButtons(connected, oauthOk) {
  const showConnect = !connected;
  const showConnected = connected;

  setDriveBtnVisible(els.connectDriveWrap, els.connectDriveBtn, showConnect);
  setDriveBtnVisible(els.syncNowWrap, els.syncNowBtn, showConnected);
  setDriveBtnVisible(els.disconnectDriveWrap, els.disconnectDriveBtn, showConnected);

  if (!oauthOk) {
    setDriveBtnLocked(els.connectDriveWrap, els.connectDriveBtn, true);
    setDriveBtnLocked(els.syncNowWrap, els.syncNowBtn, true);
    setDriveBtnLocked(els.disconnectDriveWrap, els.disconnectDriveBtn, true);
    return;
  }

  const lockAll = driveBusy != null;
  const lockConnectedActions =
    driveBusy === "syncing" || driveBusy === "disconnecting";

  setDriveBtnLocked(
    els.connectDriveWrap,
    els.connectDriveBtn,
    lockAll || driveBusy === "connecting"
  );
  setDriveBtnLocked(
    els.syncNowWrap,
    els.syncNowBtn,
    lockConnectedActions
  );
  setDriveBtnLocked(
    els.disconnectDriveWrap,
    els.disconnectDriveBtn,
    lockConnectedActions
  );
}

function paintDriveStatusFromCache() {
  const status = driveStatusCache || {};
  const meta = status.meta || {};
  const connected = !!(meta.enabled && meta.connected);
  const oauthOk = !!status.oauthConfigured;
  const folderPath =
    status.folderPath ||
    "Chrome Extensions / SnipStashi / snipstashi-sync.json";

  if (driveBusy === "connecting") {
    els.driveSyncBlurb.textContent =
      "Conecte o Drive para sincronizar snips entre aparelhos. Sem conexão, tudo continua só neste Chrome.";
    els.driveSyncStatus.textContent = "Abrindo autorização do Google…";
    setDriveStatusTone("is-syncing");
    applyDriveButtons(false, oauthOk);
    return;
  }

  if (driveBusy === "syncing") {
    els.driveSyncBlurb.textContent =
      "Sync ativo em segundo plano. Arquivo no Drive: " + folderPath + ".";
    els.driveSyncStatus.textContent = "Sincronizando…";
    setDriveStatusTone("is-syncing");
    applyDriveButtons(true, oauthOk);
    return;
  }

  if (driveBusy === "disconnecting") {
    els.driveSyncBlurb.textContent =
      "Sync ativo em segundo plano. Arquivo no Drive: " + folderPath + ".";
    els.driveSyncStatus.textContent = "Desconectando…";
    setDriveStatusTone("is-syncing");
    applyDriveButtons(true, oauthOk);
    return;
  }

  els.driveSyncBlurb.textContent = connected
    ? "Sync ativo em segundo plano. Arquivo no Drive: " + folderPath + "."
    : "Conecte o Drive para sincronizar snips entre aparelhos. Sem conexão, tudo continua só neste Chrome.";

  applyDriveButtons(connected, oauthOk);

  if (!oauthOk) {
    els.driveSyncStatus.textContent =
      "OAuth pendente: configure o Client ID no manifest (veja o README).";
    setDriveStatusTone("is-error");
    return;
  }

  if (meta.lastStatus === "syncing") {
    els.driveSyncStatus.textContent = "Sincronizando…";
    setDriveStatusTone("is-syncing");
    applyDriveButtons(connected, oauthOk);
    if (connected && !driveBusy) {
      setDriveBtnLocked(els.syncNowWrap, els.syncNowBtn, true);
      setDriveBtnLocked(els.disconnectDriveWrap, els.disconnectDriveBtn, true);
    }
    return;
  }

  if (meta.lastError) {
    els.driveSyncStatus.textContent = meta.lastError;
    setDriveStatusTone("is-error");
    return;
  }

  if (connected) {
    const when = formatSyncTime(meta.lastSyncedAt);
    const account = meta.accountEmail ? " · " + meta.accountEmail : "";
    els.driveSyncStatus.textContent = when
      ? "Último sync: " + when + account
      : "Conectado" + account;
    setDriveStatusTone("is-ok");
    return;
  }

  els.driveSyncStatus.textContent = "Somente local — Drive não conectado.";
  setDriveStatusTone(null);
}

async function refreshDriveSyncUi() {
  const status = await sendDriveMessage({ type: "DRIVE_SYNC_STATUS" });
  driveStatusCache = status;
  paintDriveStatusFromCache();
}

async function onConnectDrive() {
  if (driveBusy) return;
  if (els.connectDriveWrap.hidden) return;

  const ok = window.confirm(
    "Conectar o Google Drive?\n\n" +
      "A extensão vai criar a pasta “Chrome Extensions / SnipStashi” no seu Drive " +
      "e sincronizar seus snips em segundo plano.\n\n" +
      "Sem conectar, os dados continuam só neste Chrome."
  );
  if (!ok) return;

  driveBusy = "connecting";
  paintDriveStatusFromCache();

  const result = await sendDriveMessage({ type: "DRIVE_SYNC_CONNECT" });
  driveBusy = null;

  if (result && result.ok) {
    if (result.data) state.data = result.data;
    applyTheme();
    render();
    refreshSettingsForm();
    showToast("Google Drive conectado");
  } else if (!(result && result.skipped)) {
    showToast((result && result.error) || "Não foi possível conectar o Drive");
  }
  await refreshDriveSyncUi();
}

async function onDisconnectDrive() {
  if (driveBusy) return;
  if (els.disconnectDriveWrap.hidden) return;

  const ok = window.confirm(
    "Desconectar o Google Drive?\n\n" +
      "Os snips neste Chrome permanecem. O arquivo no Drive não é apagado."
  );
  if (!ok) return;

  driveBusy = "disconnecting";
  paintDriveStatusFromCache();

  const result = await sendDriveMessage({ type: "DRIVE_SYNC_DISCONNECT" });
  driveBusy = null;

  if (result && result.ok) showToast("Drive desconectado");
  else showToast((result && result.error) || "Falha ao desconectar");
  await refreshDriveSyncUi();
}

async function onSyncNow() {
  if (driveBusy) return;
  if (els.syncNowWrap.hidden) return;

  driveBusy = "syncing";
  paintDriveStatusFromCache();

  const result = await sendDriveMessage({
    type: "DRIVE_SYNC_NOW",
    interactive: true
  });
  driveBusy = null;

  if (result && result.ok) {
    if (result.data) {
      state.data = result.data;
      applyTheme();
      render();
      refreshSettingsForm();
    }
    showToast("Sincronizado");
  } else if (!(result && result.skipped)) {
    showToast((result && result.error) || "Falha no sync");
  }
  await refreshDriveSyncUi();
}

function closeSettings() {
  els.settingsModal.classList.add("hidden");
}

async function onExportBackup() {
  try {
    const backup = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snipstashi-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const count = (backup.data && backup.data.items && backup.data.items.length) || 0;
    showToast(`Backup exportado (${count} snip${count === 1 ? "" : "s"})`);
  } catch (_) {
    showToast("Não foi possível exportar o backup");
  }
}

async function onImportBackupFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const currentCount = (state.data.items || []).length;
  const warn =
    currentCount > 0
      ? `Importar substitui todos os dados atuais (${currentCount} snip${currentCount === 1 ? "" : "s"}). Continuar?`
      : "Importar este backup agora?";
  if (!window.confirm(warn)) return;

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (_) {
    showToast("Arquivo JSON inválido");
    return;
  }

  const result = await importBackup(parsed);
  if (!result.ok) {
    showToast(result.error || "Falha ao importar");
    return;
  }

  state.data = result.data;
  state.activeTagId = state.data.settings.defaultTagId || null;
  state.expandedIds = new Set();
  applyTheme();
  render();
  openSettings();
  const n = (state.data.items || []).length;
  showToast(`Backup restaurado (${n} snip${n === 1 ? "" : "s"})`);
}

function renderTagManageList() {
  els.tagManageList.innerHTML = "";

  if (state.data.tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tag-manage-empty";
    empty.textContent = "Nenhuma tag criada ainda.";
    els.tagManageList.appendChild(empty);
    return;
  }

  state.data.tags.forEach((tag) => {
    const row = document.createElement("div");
    row.className = "tag-manage-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tag-manage-input";
    input.value = tag.name;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
    input.addEventListener("change", async () => {
      const newName = input.value.trim();
      if (!newName || newName === tag.name) {
        input.value = tag.name;
        return;
      }
      await renameTag(tag.id, newName);
      state.data = await loadData();
      render();
      renderTagManageList();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "tag-manage-delete";
    delBtn.title = "Excluir tag";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", async () => {
      await deleteTag(tag.id);
      state.data = await loadData();
      if (state.activeTagId === tag.id) state.activeTagId = null;
      render();
      renderTagManageList();
      els.defaultTagSelect.value = state.data.settings.defaultTagId || "";
    });

    row.appendChild(input);
    row.appendChild(delBtn);
    els.tagManageList.appendChild(row);
  });
}

/* ---------------- Drag & drop (reordenar) ---------------- */

function attachDrag(handle, card) {
  let dragging = false;
  let placeholder = null;

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    card.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);

    const rect = card.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.className = "card drag-placeholder";
    placeholder.style.height = rect.height + "px";
    placeholder.style.flexShrink = "0";
    card.after(placeholder);

    card.style.position = "fixed";
    card.style.width = rect.width + "px";
    card.style.zIndex = "50";
    card.style.margin = "0";
    moveCardTo(e.clientY);

    const onMove = (ev) => {
      if (!dragging) return;
      moveCardTo(ev.clientY);
      repositionPlaceholder(ev.clientY);
    };
    const onUp = async () => {
      dragging = false;
      card.classList.remove("dragging");
      card.style.position = "";
      card.style.width = "";
      card.style.top = "";
      card.style.left = "";
      card.style.zIndex = "";
      card.style.margin = "";
      if (placeholder && placeholder.parentNode) {
        placeholder.replaceWith(card);
      }
      placeholder = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);

      const orderedIds = Array.from(els.list.querySelectorAll(".card:not(.drag-placeholder)")).map(
        (c) => c.dataset.id
      );
      await reorderItems(orderedIds);
      state.data = await loadData();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  function moveCardTo(clientY) {
    const rect = els.list.getBoundingClientRect();
    card.style.top = clientY - 24 + "px";
    card.style.left = rect.left + 16 + "px";
  }

  function repositionPlaceholder(clientY) {
    const isPinned = card.classList.contains("pinned");
    const cards = Array.from(els.list.children).filter(
      (c) =>
        c !== card &&
        c !== placeholder &&
        c.classList.contains("card") &&
        !c.classList.contains("drag-placeholder") &&
        c.classList.contains("pinned") === isPinned
    );
    let inserted = false;
    for (const sibling of cards) {
      const box = sibling.getBoundingClientRect();
      const midpoint = box.top + box.height / 2;
      if (clientY < midpoint) {
        sibling.before(placeholder);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      if (isPinned) {
        els.list.insertBefore(placeholder, els.list.firstChild);
      } else {
        els.list.appendChild(placeholder);
      }
    }
  }
}
