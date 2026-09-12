/**
 * drive-sync.js — sync opt-in com o Google Drive do usuário.
 * Só roda no service worker (importScripts). O popup fala via mensagens.
 *
 * Pasta: Meu Drive / Chrome Extensions / SnipStashi / snipstashi-sync.json
 * Escopo: drive.file (só arquivos criados por esta extensão).
 */

const SYNC_META_KEY = "fichario_sync_v1";
const DRIVE_ROOT_FOLDER = "Chrome Extensions";
const DRIVE_APP_FOLDER = "SnipStashi";
const DRIVE_SYNC_FILE = "snipstashi-sync.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SYNC_ALARM_DEBOUNCE = "snipstashi-sync-debounce";
const SYNC_ALARM_PERIODIC = "snipstashi-sync-periodic";
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_PERIOD_MINUTES = 15;

const DEFAULT_SYNC_META = {
  enabled: false,
  connected: false,
  accountEmail: null,
  rootFolderId: null,
  appFolderId: null,
  fileId: null,
  lastSyncedAt: null,
  lastError: null,
  lastStatus: "idle" // idle | syncing | ok | error | needs_auth
};

/** Evita loop: escrita local vinda do próprio sync não agenda outro sync. */
let syncApplyLock = false;
let syncInFlight = null;
/** Incrementa no disconnect para invalidar syncs antigos em andamento. */
let syncEpoch = 0;

function loadSyncMeta() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SYNC_META_KEY], (result) => {
      resolve(Object.assign({}, DEFAULT_SYNC_META, result[SYNC_META_KEY] || {}));
    });
  });
}

function saveSyncMeta(meta) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SYNC_META_KEY]: meta }, () => resolve(meta));
  });
}

function patchSyncMeta(patch) {
  return loadSyncMeta().then((meta) => saveSyncMeta(Object.assign({}, meta, patch)));
}

function isOAuthConfigured() {
  const oauth = chrome.runtime.getManifest().oauth2;
  const id = oauth && oauth.client_id;
  if (!id || typeof id !== "string") return false;
  return !/REPLACE|YOUR_CLIENT|exemplo/i.test(id);
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!isOAuthConfigured()) {
      reject(
        new Error(
          "OAuth ainda não configurado. Veja o README (seção Google Drive sync)."
        )
      );
      return;
    }
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(
          new Error(
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              "Não foi possível autenticar no Google."
          )
        );
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function clearAllAuthTokens() {
  if (chrome.identity.clearAllCachedAuthTokens) {
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    });
  }
}

async function fetchAccountEmail(token) {
  try {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.email || null;
  } catch (_) {
    return null;
  }
}

async function driveRequest(token, url, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {}, {
    Authorization: "Bearer " + token
  });
  let res;
  try {
    res = await fetch(url, Object.assign({}, opts, { headers }));
  } catch (err) {
    const msg = (err && err.message) || "Failed to fetch";
    throw new Error(
      "Rede/CSP ao falar com o Drive (" + msg + "). Recarregue a extensão."
    );
  }
  if (res.status === 401) {
    await removeCachedToken(token);
    const authErr = new Error("Sessão Google expirada. Conecte o Drive de novo.");
    authErr.code = "auth";
    throw authErr;
  }
  return res;
}

async function driveJson(token, url, options) {
  const res = await driveRequest(token, url, options);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = (body.error && body.error.message) || JSON.stringify(body);
    } catch (_) {
      detail = await res.text();
    }
    throw new Error("Drive API (" + res.status + "): " + (detail || res.statusText));
  }
  if (res.status === 204) return null;
  return res.json();
}

function encodeQuery(q) {
  return encodeURIComponent(q);
}

async function findChild(token, name, mimeType, parentId) {
  const parent = parentId || "root";
  const q =
    "name='" +
    name.replace(/'/g, "\\'") +
    "' and mimeType='" +
    mimeType +
    "' and '" +
    parent +
    "' in parents and trashed=false";
  const url =
    DRIVE_API +
    "/files?q=" +
    encodeQuery(q) +
    "&spaces=drive&fields=files(id,name)&pageSize=1";
  const data = await driveJson(token, url);
  return data.files && data.files[0] ? data.files[0] : null;
}

async function createFolder(token, name, parentId) {
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId || "root"]
  };
  return driveJson(token, DRIVE_API + "/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function ensureFolder(token, name, parentId) {
  const existing = await findChild(
    token,
    name,
    "application/vnd.google-apps.folder",
    parentId
  );
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

async function createSyncFile(token, parentId) {
  const meta = {
    name: DRIVE_SYNC_FILE,
    parents: [parentId],
    mimeType: "application/json"
  };
  const empty = JSON.stringify(
    {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      syncedAt: Date.now(),
      app: "SnipStashi",
      data: structuredClone(DEFAULT_DATA)
    },
    null,
    2
  );
  const boundary = "snipstashi_" + Date.now();
  const body =
    "--" +
    boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(meta) +
    "\r\n--" +
    boundary +
    "\r\nContent-Type: application/json\r\n\r\n" +
    empty +
    "\r\n--" +
    boundary +
    "--";

  return driveJson(
    token,
    DRIVE_UPLOAD + "/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body
    }
  );
}

async function ensureDriveLocations(token, meta) {
  let rootFolderId = meta.rootFolderId;
  let appFolderId = meta.appFolderId;
  let fileId = meta.fileId;

  if (rootFolderId) {
    const ok = await driveFileExists(token, rootFolderId);
    if (!ok) rootFolderId = null;
  }
  if (!rootFolderId) {
    const root = await ensureFolder(token, DRIVE_ROOT_FOLDER, "root");
    rootFolderId = root.id;
  }

  if (appFolderId) {
    const ok = await driveFileExists(token, appFolderId);
    if (!ok) appFolderId = null;
  }
  if (!appFolderId) {
    const app = await ensureFolder(token, DRIVE_APP_FOLDER, rootFolderId);
    appFolderId = app.id;
  }

  if (fileId) {
    const ok = await driveFileExists(token, fileId);
    if (!ok) fileId = null;
  }
  if (!fileId) {
    const existing = await findChild(
      token,
      DRIVE_SYNC_FILE,
      "application/json",
      appFolderId
    );
    if (existing) {
      fileId = existing.id;
    } else {
      const created = await createSyncFile(token, appFolderId);
      fileId = created.id;
    }
  }

  return { rootFolderId, appFolderId, fileId };
}

async function driveFileExists(token, fileId) {
  try {
    const res = await driveRequest(
      token,
      DRIVE_API + "/files/" + encodeURIComponent(fileId) + "?fields=id,trashed"
    );
    if (!res.ok) return false;
    const json = await res.json();
    return json && !json.trashed;
  } catch (_) {
    return false;
  }
}

async function downloadSyncFile(token, fileId) {
  const res = await driveRequest(
    token,
    DRIVE_API + "/files/" + encodeURIComponent(fileId) + "?alt=media"
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error("Falha ao baixar sync do Drive (" + res.status + ").");
  }
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("Arquivo de sync no Drive está corrompido.");
  }
}

async function uploadSyncFile(token, fileId, payload) {
  const body = JSON.stringify(payload, null, 2);
  const res = await driveRequest(
    token,
    DRIVE_UPLOAD +
      "/files/" +
      encodeURIComponent(fileId) +
      "?uploadType=media",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body
    }
  );
  if (!res.ok) {
    throw new Error("Falha ao enviar sync ao Drive (" + res.status + ").");
  }
}

function buildSyncPayload(data) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    syncedAt: Date.now(),
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

function remotePayloadToData(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.format === BACKUP_FORMAT && payload.data) {
    return migrateData(payload.data);
  }
  if (Array.isArray(payload.items) || Array.isArray(payload.tags)) {
    return migrateData(payload);
  }
  return null;
}

/**
 * Merge por id / updatedAt + tombstones.
 * Tombstone vence se deletedAt >= updatedAt do item/tag.
 */
function mergeDatasets(localData, remoteData) {
  const local = migrateData(localData);
  const remote = migrateData(remoteData);

  const itemTombs = mergeTombstoneMaps(
    local.tombstones.items,
    remote.tombstones.items
  );
  const tagTombs = mergeTombstoneMaps(
    local.tombstones.tags,
    remote.tombstones.tags
  );

  const items = mergeEntityLists(local.items, remote.items, itemTombs);
  const tags = mergeEntityLists(local.tags, remote.tags, tagTombs);

  const localSettingsAt = (local.settings && local.settings.updatedAt) || 0;
  const remoteSettingsAt = (remote.settings && remote.settings.updatedAt) || 0;
  const settings =
    remoteSettingsAt > localSettingsAt
      ? Object.assign({}, DEFAULT_DATA.settings, remote.settings)
      : Object.assign({}, DEFAULT_DATA.settings, local.settings);

  return {
    schemaVersion: SCHEMA_VERSION,
    items,
    tags,
    settings,
    tombstones: {
      items: pruneTombstoneList(itemTombs),
      tags: pruneTombstoneList(tagTombs)
    }
  };
}

function mergeTombstoneMaps(aList, bList) {
  const map = Object.create(null);
  for (const list of [aList || [], bList || []]) {
    for (const t of list) {
      if (!t || !t.id) continue;
      const at = typeof t.deletedAt === "number" ? t.deletedAt : 0;
      if (map[t.id] == null || at > map[t.id]) map[t.id] = at;
    }
  }
  return map;
}

function pruneTombstoneList(map) {
  const maxAge = 1000 * 60 * 60 * 24 * 365; // 1 ano
  const now = Date.now();
  return Object.keys(map)
    .map((id) => ({ id, deletedAt: map[id] }))
    .filter((t) => now - t.deletedAt < maxAge);
}

function mergeEntityLists(localList, remoteList, tombMap) {
  const map = new Map();
  for (const entity of [].concat(localList || [], remoteList || [])) {
    if (!entity || !entity.id) continue;
    const prev = map.get(entity.id);
    const t = typeof entity.updatedAt === "number" ? entity.updatedAt : 0;
    const pt = prev && typeof prev.updatedAt === "number" ? prev.updatedAt : 0;
    if (!prev || t >= pt) map.set(entity.id, entity);
  }

  const out = [];
  for (const [id, entity] of map) {
    const deletedAt = tombMap[id];
    const updatedAt =
      typeof entity.updatedAt === "number" ? entity.updatedAt : 0;
    if (deletedAt != null && deletedAt >= updatedAt) continue;
    out.push(entity);
  }
  return out;
}

function datasetsEqualForSync(a, b) {
  const norm = (d) =>
    JSON.stringify({
      items: (d.items || [])
        .map((i) => ({ id: i.id, updatedAt: i.updatedAt, text: i.text, order: i.order, tagIds: i.tagIds, pinned: i.pinned }))
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      tags: (d.tags || [])
        .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }))
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      settings: d.settings || {},
      tombstones: normalizeTombstones(d.tombstones)
    });
  return norm(a) === norm(b);
}

async function runDriveSync(options) {
  const opts = options || {};

  // Conectar/reconectar não pode “pegar carona” num sync antigo (ex.: skipped/disabled).
  if (syncInFlight) {
    if (opts.forceConnect) {
      try {
        await syncInFlight;
      } catch (_) {
        /* ignore */
      }
    } else {
      return syncInFlight;
    }
  }

  const epochAtStart = syncEpoch;

  const run = (async () => {
    const meta = await loadSyncMeta();
    if (epochAtStart !== syncEpoch) {
      return { ok: false, skipped: true, reason: "cancelled" };
    }
    if (!meta.enabled && !opts.forceConnect) {
      return { ok: false, skipped: true, reason: "disabled" };
    }

    await patchSyncMeta({ lastStatus: "syncing", lastError: null });

    try {
      const token = await getAuthToken(!!opts.interactive);
      if (epochAtStart !== syncEpoch) {
        return { ok: false, skipped: true, reason: "cancelled" };
      }

      const locations = await ensureDriveLocations(token, meta);
      const email =
        meta.accountEmail || (await fetchAccountEmail(token)) || null;

      const remotePayload = await downloadSyncFile(token, locations.fileId);
      const remoteData = remotePayloadToData(remotePayload);
      const localData = await loadData();

      let merged = localData;
      if (remoteData) {
        merged = mergeDatasets(localData, remoteData);
      }

      if (epochAtStart !== syncEpoch) {
        return { ok: false, skipped: true, reason: "cancelled" };
      }

      if (!datasetsEqualForSync(merged, localData)) {
        syncApplyLock = true;
        try {
          await saveData(merged);
        } finally {
          setTimeout(() => {
            syncApplyLock = false;
          }, 50);
        }
      }

      const payload = buildSyncPayload(merged);
      await uploadSyncFile(token, locations.fileId, payload);

      if (epochAtStart !== syncEpoch) {
        return { ok: false, skipped: true, reason: "cancelled" };
      }

      const next = await saveSyncMeta({
        enabled: true,
        connected: true,
        accountEmail: email,
        rootFolderId: locations.rootFolderId,
        appFolderId: locations.appFolderId,
        fileId: locations.fileId,
        lastSyncedAt: Date.now(),
        lastError: null,
        lastStatus: "ok"
      });

      ensurePeriodicAlarm();
      return { ok: true, meta: next, data: merged };
    } catch (err) {
      if (epochAtStart !== syncEpoch) {
        return { ok: false, skipped: true, reason: "cancelled" };
      }
      const message = (err && err.message) || "Erro desconhecido no sync.";
      const status = err && err.code === "auth" ? "needs_auth" : "error";
      const next = await patchSyncMeta({
        lastStatus: status,
        lastError: message,
        connected: false
      });
      return { ok: false, error: message, meta: next };
    }
  })();

  syncInFlight = run;
  try {
    return await run;
  } finally {
    if (syncInFlight === run) syncInFlight = null;
  }
}

function scheduleDriveSync() {
  if (syncApplyLock) return;
  loadSyncMeta().then((meta) => {
    if (!meta.enabled || !meta.connected) return;
    chrome.alarms.create(SYNC_ALARM_DEBOUNCE, {
      when: Date.now() + SYNC_DEBOUNCE_MS
    });
  });
}

function ensurePeriodicAlarm() {
  chrome.alarms.create(SYNC_ALARM_PERIODIC, {
    periodInMinutes: SYNC_PERIOD_MINUTES
  });
}

function clearSyncAlarms() {
  chrome.alarms.clear(SYNC_ALARM_DEBOUNCE);
  chrome.alarms.clear(SYNC_ALARM_PERIODIC);
}

async function connectDriveSync() {
  if (!isOAuthConfigured()) {
    return {
      ok: false,
      error:
        "OAuth ainda não configurado. Crie um Client ID no Google Cloud e coloque em manifest.json (oauth2.client_id). Detalhes no README."
    };
  }

  await patchSyncMeta({
    enabled: true,
    lastStatus: "syncing",
    lastError: null
  });
  const result = await runDriveSync({ interactive: true, forceConnect: true });
  if (!result.ok && !result.skipped) {
    await patchSyncMeta({
      enabled: false,
      connected: false,
      lastStatus: "error",
      lastError: result.error || "Falha ao conectar."
    });
  } else if (result.skipped && result.reason === "cancelled") {
    // disconnect no meio do caminho — meta já foi limpa
    return result;
  } else if (!result.ok) {
    await patchSyncMeta({
      enabled: false,
      connected: false,
      lastStatus: "error",
      lastError: "Não foi possível concluir a conexão. Tente de novo."
    });
  }
  return result;
}

async function disconnectDriveSync() {
  syncEpoch += 1;
  clearSyncAlarms();

  // Limpa o estado primeiro — a UI precisa refletir na hora.
  // Evita getAuthToken(false) aqui: em MV3 isso às vezes trava para sempre.
  const next = await saveSyncMeta(
    Object.assign({}, DEFAULT_SYNC_META, {
      lastStatus: "idle",
      lastError: null
    })
  );

  try {
    await Promise.race([
      clearAllAuthTokens(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  } catch (_) {
    /* ignore */
  }

  return { ok: true, meta: next };
}

async function getDriveSyncStatus() {
  const meta = await loadSyncMeta();
  return {
    meta,
    oauthConfigured: isOAuthConfigured(),
    folderPath: DRIVE_ROOT_FOLDER + " / " + DRIVE_APP_FOLDER + " / " + DRIVE_SYNC_FILE
  };
}

function initDriveSyncListeners() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[STORAGE_KEY]) return;
    scheduleDriveSync();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (
      alarm.name === SYNC_ALARM_DEBOUNCE ||
      alarm.name === SYNC_ALARM_PERIODIC
    ) {
      runDriveSync({ interactive: false });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    const reply = (promise) => {
      promise
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: (err && err.message) || "Erro no sync."
          })
        );
      return true;
    };

    if (message.type === "DRIVE_SYNC_CONNECT") {
      return reply(connectDriveSync());
    }
    if (message.type === "DRIVE_SYNC_DISCONNECT") {
      return reply(disconnectDriveSync());
    }
    if (message.type === "DRIVE_SYNC_NOW") {
      return reply(runDriveSync({ interactive: !!message.interactive }));
    }
    if (message.type === "DRIVE_SYNC_STATUS") {
      return reply(getDriveSyncStatus());
    }
  });

  loadSyncMeta().then((meta) => {
    if (meta.enabled && meta.connected) ensurePeriodicAlarm();
  });
}
