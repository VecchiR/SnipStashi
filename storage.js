/**
 * storage.js — camada de dados sobre chrome.storage.local
 * Carregado tanto pelo popup (<script src="storage.js">) quanto pelo
 * service worker (importScripts('storage.js')), por isso é escrito
 * em JS clássico (sem import/export de módulos ES).
 *
 * A chave STORAGE_KEY nunca deve mudar sem migração — é o que mantém
 * os dados entre atualizações da extensão.
 */

const STORAGE_KEY = "fichario_data_v1";
const SCHEMA_VERSION = 1;
const BACKUP_FORMAT = "snipstashi-backup";
/** v2: tombstones + updatedAt em tags/settings (compatível com leitura de v1). */
const BACKUP_FORMAT_VERSION = 2;

const PAPER_COLORS = [
  "#fdfae8", "#fff0e6", "#edfff5", "#f3eeff",
  "#ffeef6", "#e8f4ff", "#fffbe0", "#f0f9e8"
];

const WASHI_CLASSES = [
  "washi-sun", "washi-coral", "washi-teal", "washi-violet", "washi-mint"
];

const DEFAULT_DATA = {
  schemaVersion: SCHEMA_VERSION,
  items: [],
  tags: [],
  settings: {
    defaultTagId: null, // null = "Todos"
    minimalMode: false,
    updatedAt: 0
  },
  // Para sync: exclusões precisam sobreviver entre dispositivos
  tombstones: {
    items: [], // { id, deletedAt }
    tags: []
  }
};

function normalizeTombstones(raw) {
  const empty = { items: [], tags: [] };
  if (!raw || typeof raw !== "object") return empty;

  function list(arr) {
    if (!Array.isArray(arr)) return [];
    const map = Object.create(null);
    arr.forEach((t) => {
      if (!t || !t.id) return;
      const at = typeof t.deletedAt === "number" ? t.deletedAt : 0;
      if (map[t.id] == null || at > map[t.id]) map[t.id] = at;
    });
    return Object.keys(map).map((id) => ({ id, deletedAt: map[id] }));
  }

  return { items: list(raw.items), tags: list(raw.tags) };
}

function upsertTombstone(list, id, deletedAt) {
  const next = (list || []).filter((t) => t.id !== id);
  next.push({ id, deletedAt: deletedAt || Date.now() });
  return next;
}

function clearTombstone(list, id) {
  return (list || []).filter((t) => t.id !== id);
}

function generateId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickFrom(arr, seed) {
  return arr[seed % arr.length];
}

/** Gera metadados visuais estáveis a partir do id (itens antigos sem visual). */
function createVisualMeta(id, pinned) {
  const h = hashString(id || String(Math.random()));
  return {
    paperColor: pickFrom(PAPER_COLORS, h),
    tornVariant: (h % 3) + 1,
    rotation: ((h % 70) / 10) - 3.5, // -3.5 .. 3.4
    washi: pinned ? pickFrom(WASHI_CLASSES, h >>> 8) : null
  };
}

function ensureItemVisual(item) {
  if (
    item.paperColor &&
    item.tornVariant != null &&
    typeof item.rotation === "number"
  ) {
    return item;
  }
  const visual = createVisualMeta(item.id, item.pinned);
  return Object.assign({}, item, {
    paperColor: item.paperColor || visual.paperColor,
    tornVariant: item.tornVariant != null ? item.tornVariant : visual.tornVariant,
    rotation: typeof item.rotation === "number" ? item.rotation : visual.rotation,
    washi: item.washi !== undefined ? item.washi : visual.washi
  });
}

/** Normaliza e migra blobs antigos sem perder itens/tags. */
function migrateData(raw) {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_DATA);
  }

  const items = (Array.isArray(raw.items) ? raw.items : []).map(ensureItemVisual);
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((tag) => {
    if (!tag || typeof tag !== "object") return tag;
    return Object.assign({}, tag, {
      updatedAt:
        typeof tag.updatedAt === "number" ? tag.updatedAt : tag.createdAt || 0
    });
  });
  const settings = Object.assign({}, DEFAULT_DATA.settings, raw.settings || {});
  const tombstones = normalizeTombstones(raw.tombstones);

  // migra setting antigo flashyMode → minimalMode (flashy foi removido)
  if (settings.minimalMode == null && settings.flashyMode != null) {
    settings.minimalMode = false;
  }
  delete settings.flashyMode;
  if (typeof settings.updatedAt !== "number") settings.updatedAt = 0;

  const fromVersion =
    typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;

  // Espaço para migrações futuras (fromVersion < N). Hoje só preenche defaults.
  void fromVersion;

  return {
    schemaVersion: SCHEMA_VERSION,
    items,
    tags,
    settings,
    tombstones
  };
}

function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const raw = result[STORAGE_KEY];
      if (!raw) {
        resolve(structuredClone(DEFAULT_DATA));
        return;
      }
      const migrated = migrateData(raw);
      // Persiste migração silenciosa (ex.: schemaVersion em dados antigos)
      if (raw.schemaVersion !== migrated.schemaVersion) {
        chrome.storage.local.set({ [STORAGE_KEY]: migrated }, () => {
          resolve(migrated);
        });
      } else {
        resolve(migrated);
      }
    });
  });
}

function saveData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, () => resolve(data));
  });
}

function randomPaperColor() {
  return PAPER_COLORS[Math.floor(Math.random() * PAPER_COLORS.length)];
}

function randomWashi() {
  return WASHI_CLASSES[Math.floor(Math.random() * WASHI_CLASSES.length)];
}

/** Adiciona um novo item. Retorna o item criado. */
async function addItem({ text, tagIds = [], pinned = false, paperColor, washi } = {}) {
  const data = await loadData();
  const maxOrder = data.items.reduce((m, i) => Math.max(m, i.order || 0), 0);
  const id = generateId("item");
  const visual = createVisualMeta(id, pinned);
  const item = {
    id,
    text: text.trim(),
    tagIds,
    pinned,
    order: maxOrder + 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    paperColor: paperColor || visual.paperColor,
    tornVariant: visual.tornVariant,
    rotation: visual.rotation,
    washi: pinned ? (washi || visual.washi || randomWashi()) : null
  };
  data.items.push(item);
  data.tombstones.items = clearTombstone(data.tombstones.items, id);
  await saveData(data);
  return item;
}

async function updateItem(id, patch) {
  const data = await loadData();
  const idx = data.items.findIndex((i) => i.id === id);
  if (idx === -1) return null;

  const prev = data.items[idx];
  const next = Object.assign({}, prev, patch, { updatedAt: Date.now() });

  // Pin ligado → garante washi; pin desligado → remove washi
  if (Object.prototype.hasOwnProperty.call(patch, "pinned")) {
    if (patch.pinned && !next.washi) {
      next.washi = Object.prototype.hasOwnProperty.call(patch, "washi") && patch.washi
        ? patch.washi
        : pickFrom(WASHI_CLASSES, hashString(id) >>> 4);
    } else if (!patch.pinned) {
      next.washi = null;
    }
  }

  data.items[idx] = ensureItemVisual(next);
  await saveData(data);
  return data.items[idx];
}

async function deleteItem(id) {
  const data = await loadData();
  data.items = data.items.filter((i) => i.id !== id);
  data.tombstones.items = upsertTombstone(data.tombstones.items, id, Date.now());
  await saveData(data);
}

async function reorderItems(orderedIds) {
  const data = await loadData();
  const now = Date.now();
  orderedIds.forEach((id, idx) => {
    const item = data.items.find((i) => i.id === id);
    if (item) {
      item.order = idx;
      item.updatedAt = now;
    }
  });
  await saveData(data);
}

async function addTag(name) {
  const data = await loadData();
  const trimmed = name.trim();
  const existing = data.tags.find(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) return existing;
  const now = Date.now();
  const tag = { id: generateId("tag"), name: trimmed, updatedAt: now };
  data.tags.push(tag);
  data.tombstones.tags = clearTombstone(data.tombstones.tags, tag.id);
  await saveData(data);
  return tag;
}

async function deleteTag(id) {
  const data = await loadData();
  data.tags = data.tags.filter((t) => t.id !== id);
  data.items.forEach((i) => {
    i.tagIds = (i.tagIds || []).filter((tid) => tid !== id);
  });
  if (data.settings.defaultTagId === id) {
    data.settings.defaultTagId = null;
    data.settings.updatedAt = Date.now();
  }
  data.tombstones.tags = upsertTombstone(data.tombstones.tags, id, Date.now());
  await saveData(data);
}

async function setSetting(key, value) {
  const data = await loadData();
  data.settings[key] = value;
  data.settings.updatedAt = Date.now();
  await saveData(data);
  return data.settings;
}

async function renameTag(id, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return null;
  const data = await loadData();
  const tag = data.tags.find((t) => t.id === id);
  if (!tag) return null;
  tag.name = trimmed;
  tag.updatedAt = Date.now();
  await saveData(data);
  return tag;
}

/** Reinsere um item exatamente como estava (usado pelo "Desfazer"). */
async function restoreItem(item) {
  const data = await loadData();
  const restored = ensureItemVisual(item);
  data.items.push(restored);
  data.tombstones.items = clearTombstone(data.tombstones.items, restored.id);
  await saveData(data);
  return restored;
}

/** Apaga todos os itens, tags e configurações. Irreversível. */
async function clearAllData() {
  const data = await loadData();
  const now = Date.now();
  let itemTombs = data.tombstones.items || [];
  let tagTombs = data.tombstones.tags || [];
  (data.items || []).forEach((i) => {
    itemTombs = upsertTombstone(itemTombs, i.id, now);
  });
  (data.tags || []).forEach((t) => {
    tagTombs = upsertTombstone(tagTombs, t.id, now);
  });
  const fresh = structuredClone(DEFAULT_DATA);
  fresh.tombstones = { items: itemTombs, tags: tagTombs };
  fresh.settings.updatedAt = now;
  await saveData(fresh);
  return fresh;
}

/** Monta um arquivo de backup portável (JSON). */
async function exportBackup() {
  const data = await loadData();
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    app: "SnipStashi",
    data: {
      schemaVersion: data.schemaVersion || SCHEMA_VERSION,
      items: data.items || [],
      tags: data.tags || [],
      settings: Object.assign({}, DEFAULT_DATA.settings, data.settings || {}),
      tombstones: normalizeTombstones(data.tombstones)
    }
  };
}

/**
 * Valida e aplica um backup.
 * @returns {{ ok: true, data } | { ok: false, error: string }}
 */
async function importBackup(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Arquivo inválido." };
  }

  let rawData = null;

  if (payload.format === BACKUP_FORMAT && payload.data) {
    if (
      typeof payload.formatVersion === "number" &&
      payload.formatVersion > BACKUP_FORMAT_VERSION
    ) {
      return {
        ok: false,
        error: "Este backup é de uma versão mais nova. Atualize o SnipStashi."
      };
    }
    rawData = payload.data;
  } else if (Array.isArray(payload.items) || Array.isArray(payload.tags)) {
    // Aceita blob interno antigo (só o conteúdo de STORAGE_KEY)
    rawData = payload;
  } else {
    return {
      ok: false,
      error: "Não parece um backup do SnipStashi."
    };
  }

  if (!rawData || typeof rawData !== "object") {
    return { ok: false, error: "Backup sem dados." };
  }
  if (rawData.items != null && !Array.isArray(rawData.items)) {
    return { ok: false, error: "Lista de itens inválida." };
  }
  if (rawData.tags != null && !Array.isArray(rawData.tags)) {
    return { ok: false, error: "Lista de tags inválida." };
  }

  const data = migrateData(rawData);
  await saveData(data);
  return { ok: true, data };
}
