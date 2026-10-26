const STORAGE_KEY = 'vacsync:v1';

export const PALETTE = ['#2f6fed', '#e0542b', '#1f9e6e', '#9b4fd1', '#d1a21f', '#2bb3c0', '#d1457a', '#5a6b7a'];

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now();
}

function defaultState() {
  const meId = uid();
  return {
    me: meId,
    people: {
      [meId]: { id: meId, name: 'Я', email: '', color: PALETTE[0], isMe: true },
    },
    groups: {},
    periods: {},
    ui: { activeGroupId: null },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.people || !parsed.me) return defaultState();
    parsed.ui = parsed.ui || { activeGroupId: null };
    return parsed;
  } catch {
    return defaultState();
  }
}

class Store {
  constructor() {
    this.state = load();
    this.listeners = new Set();
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this.listeners.forEach((fn) => fn(this.state));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  nextColor() {
    const used = new Set(Object.values(this.state.people).map((p) => p.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(this.state.people).length % PALETTE.length];
  }

  // --- people ---
  upsertPerson({ id, name, email, color, isMe = false }) {
    const pid = id || uid();
    const existing = this.state.people[pid];
    this.state.people[pid] = {
      id: pid,
      name: name || existing?.name || 'Без имени',
      email: email || existing?.email || '',
      color: color || existing?.color || this.nextColor(),
      isMe: existing?.isMe ?? isMe,
    };
    this.save();
    return pid;
  }

  renamePerson(id, name) {
    if (!this.state.people[id]) return;
    this.state.people[id].name = name;
    this.save();
  }

  setMyProfile({ name, email }) {
    const me = this.state.people[this.state.me];
    me.name = name || me.name;
    me.email = email || me.email;
    this.save();
  }

  // --- groups ---
  addGroup(name) {
    const id = uid();
    this.state.groups[id] = {
      id,
      name,
      memberIds: [this.state.me],
      driveFolderId: null,
      myFileId: null,
    };
    this.state.ui.activeGroupId = id;
    this.save();
    return id;
  }

  renameGroup(id, name) {
    if (!this.state.groups[id]) return;
    this.state.groups[id].name = name;
    this.save();
  }

  deleteGroup(id) {
    delete this.state.groups[id];
    if (this.state.ui.activeGroupId === id) this.state.ui.activeGroupId = null;
    this.save();
  }

  setActiveGroup(id) {
    this.state.ui.activeGroupId = id;
    this.save();
  }

  addMemberToGroup(groupId, personId) {
    const g = this.state.groups[groupId];
    if (!g || g.memberIds.includes(personId)) return;
    g.memberIds.push(personId);
    this.save();
  }

  removeMemberFromGroup(groupId, personId) {
    const g = this.state.groups[groupId];
    if (!g) return;
    g.memberIds = g.memberIds.filter((id) => id !== personId);
    this.save();
  }

  setGroupDrive(groupId, { driveFolderId, myFileId }) {
    const g = this.state.groups[groupId];
    if (!g) return;
    if (driveFolderId !== undefined) g.driveFolderId = driveFolderId;
    if (myFileId !== undefined) g.myFileId = myFileId;
    this.save();
  }

  // --- periods ---
  addPeriod({ personId, title, kind, start, end, notes, color }) {
    const id = uid();
    this.state.periods[id] = {
      id,
      personId,
      title: title || 'Без названия',
      kind: kind || 'vacation',
      start,
      end,
      notes: notes || '',
      color: color || null,
      plans: [],
    };
    this.save();
    return id;
  }

  updatePeriod(id, patch) {
    const p = this.state.periods[id];
    if (!p) return;
    Object.assign(p, patch);
    this.save();
  }

  deletePeriod(id) {
    delete this.state.periods[id];
    this.save();
  }

  replacePersonPeriods(personId, periodsArray) {
    Object.values(this.state.periods)
      .filter((p) => p.personId === personId)
      .forEach((p) => delete this.state.periods[p.id]);
    for (const p of periodsArray) {
      this.state.periods[p.id] = { ...p, personId };
    }
    this.save();
  }

  addPlan(periodId, { title, date, note }) {
    const p = this.state.periods[periodId];
    if (!p) return;
    p.plans.push({ id: uid(), title, date, note: note || '' });
    this.save();
  }

  removePlan(periodId, planId) {
    const p = this.state.periods[periodId];
    if (!p) return;
    p.plans = p.plans.filter((pl) => pl.id !== planId);
    this.save();
  }

  // --- getters ---
  periodsForPerson(personId) {
    return Object.values(this.state.periods).filter((p) => p.personId === personId);
  }

  periodsForGroup(groupId) {
    const g = this.state.groups[groupId];
    if (!g) return [];
    return Object.values(this.state.periods).filter((p) => g.memberIds.includes(p.personId));
  }

  myPerson() {
    return this.state.people[this.state.me];
  }

  exportSnapshot() {
    const me = this.myPerson();
    return {
      person: { id: me.id, name: me.name, email: me.email, color: me.color },
      periods: this.periodsForPerson(me.id),
      updatedAt: new Date().toISOString(),
    };
  }

  importRemoteSnapshot(snapshot) {
    if (!snapshot || !snapshot.person) return;
    const pid = this.upsertPerson({ id: snapshot.person.id, name: snapshot.person.name, email: snapshot.person.email, color: snapshot.person.color });
    this.replacePersonPeriods(pid, snapshot.periods || []);
    return pid;
  }
}

export const store = new Store();
