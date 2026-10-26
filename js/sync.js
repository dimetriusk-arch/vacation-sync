import { store } from './store.js';
import * as drive from './google.js';

export async function connectGroupToDrive(groupId) {
  const g = store.state.groups[groupId];
  if (!g) throw new Error('Группа не найдена');
  let folderId = g.driveFolderId;
  if (!folderId) {
    const folder = await drive.createFolder('VacSync — ' + g.name);
    folderId = folder.id;
  }
  const snapshot = store.exportSnapshot();
  const file = await drive.upsertJSONFile({
    fileId: g.myFileId,
    folderId,
    name: `person-${snapshot.person.id}.json`,
    data: snapshot,
  });
  store.setGroupDrive(groupId, { driveFolderId: folderId, myFileId: file.id });
  return folderId;
}

export async function pushMySnapshot(groupId) {
  const g = store.state.groups[groupId];
  if (!g?.driveFolderId) throw new Error('Группа не подключена к Drive');
  const snapshot = store.exportSnapshot();
  const file = await drive.upsertJSONFile({
    fileId: g.myFileId,
    folderId: g.driveFolderId,
    name: `person-${snapshot.person.id}.json`,
    data: snapshot,
  });
  store.setGroupDrive(groupId, { myFileId: file.id });
}

export async function pullGroup(groupId) {
  const g = store.state.groups[groupId];
  if (!g?.driveFolderId) throw new Error('Группа не подключена к Drive');
  const files = await drive.listFolderFiles(g.driveFolderId);
  for (const f of files) {
    if (f.id === g.myFileId) continue;
    try {
      const snapshot = await drive.readFileJSON(f.id);
      const pid = store.importRemoteSnapshot(snapshot);
      if (pid) store.addMemberToGroup(groupId, pid);
    } catch (e) {
      console.warn('Не удалось прочитать файл участника', f.name, e);
    }
  }
}

export async function syncGroup(groupId) {
  const g = store.state.groups[groupId];
  if (!g) throw new Error('Группа не найдена');
  if (!g.driveFolderId) {
    await connectGroupToDrive(groupId);
  } else {
    await pushMySnapshot(groupId);
  }
  await pullGroup(groupId);
}

export function buildInviteLink(groupId) {
  const g = store.state.groups[groupId];
  if (!g?.driveFolderId) return null;
  const url = new URL(location.href);
  url.hash = `invite=${g.driveFolderId}&name=${encodeURIComponent(g.name)}`;
  return url.toString();
}

export async function acceptInvite(cfg, folderId, name) {
  const picked = await drive.openFolderPicker(cfg);
  if (!picked) return null;
  if (picked.id !== folderId) {
    throw new Error('Выбрана не та папка. Откройте диалог заново и выберите папку приглашения «' + name + '».');
  }
  const existing = Object.values(store.state.groups).find((g) => g.driveFolderId === folderId);
  const groupId = existing ? existing.id : store.addGroup(name);
  store.setGroupDrive(groupId, { driveFolderId: folderId });
  await syncGroup(groupId);
  return groupId;
}
