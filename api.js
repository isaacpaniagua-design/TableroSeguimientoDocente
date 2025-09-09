// Apps Script Web App URL (exec). Replace with your deployment URL
// Example: https://script.google.com/macros/s/AKfycbx.../exec
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbys5tkzAYOJdrjoSITBUDm2rkypN4OW34IHyDYBEzSMkChcHUukKyog7a3a5MypPFYLdw/exec";
let __AUTH_ID_TOKEN = null;
try {
  const saved =
    typeof sessionStorage !== "undefined" && sessionStorage.getItem("ID_TOKEN");
  if (saved) __AUTH_ID_TOKEN = saved;
} catch (e) {}

function setAuthToken(idToken) {
  __AUTH_ID_TOKEN = idToken || null;
  try {
    if (idToken) {
      sessionStorage.setItem("ID_TOKEN", idToken);
    } else {
      sessionStorage.removeItem("ID_TOKEN");
    }
  } catch (e) {}
}

// JSONP request helper for Apps Script (avoids CORS limits)
function gasRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!WEB_APP_URL || WEB_APP_URL.startsWith("REEMPLAZA_")) {
      reject(new Error("Configura WEB_APP_URL en api.js"));
      return;
    }

    const callbackName = `__gas_cb_${Date.now()}_${Math.floor(
      Math.random() * 1e6
    )}`;
    const script = document.createElement("script");
    const url = new URL(WEB_APP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    if (__AUTH_ID_TOKEN) {
      url.searchParams.set("idToken", __AUTH_ID_TOKEN);
    }
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (Array.isArray(v) || typeof v === "object") {
        url.searchParams.set(k, JSON.stringify(v));
      } else {
        url.searchParams.set(k, String(v));
      }
    });

    const cleanup = () => {
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }
      if (script && script.parentNode) script.parentNode.removeChild(script);
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = (err) => {
      cleanup();
      reject(err);
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

// Optional loader wrapper: uses global showLoading/hideLoading if available
async function callWithLoader(message, fn) {
  const hasShow = typeof window !== "undefined" && typeof window.showLoading === "function";
  const hasHide = typeof window !== "undefined" && typeof window.hideLoading === "function";
  try {
    if (hasShow) window.showLoading(message);
    return await fn();
  } finally {
    if (hasHide) window.hideLoading();
  }
}

// Emit UI refresh events after data changes
function emitChange(op, detail) {
  try {
    const payload = { op: String(op || 'change'), ...(detail || {}) };
    window.dispatchEvent(new CustomEvent('data:changed', { detail: payload }));
  } catch (e) {}
}

// High-level API wrappers
const api = {
  getPagedData: (page = 1, pageSize = 1000) =>
    gasRequest("getPagedData", { page, pageSize }),
  getDashboardStatistics: () => gasRequest("getDashboardStatistics"),
  getAllTeachersForReport: () => gasRequest("getAllTeachersForReport"),
  addOrUpdateTeacher: (id, name, lastName) =>
    gasRequest("addOrUpdateTeacher", { id, name, lastName }),
  updateTeacherData: (originalIndex, id, name, lastName) =>
    gasRequest("updateTeacherData", { originalIndex, id, name, lastName }),
  updateCheckboxState: (originalIndex, colIndex, value) =>
    gasRequest("updateCheckboxState", { originalIndex, colIndex, value }),
  deleteMultipleTeachers: async (originalIndices) =>
    callWithLoader("Eliminando docentes...", () =>
      gasRequest("deleteMultipleTeachers", { originalIndices })
    ),
  updateActivityHeaders: async (headers) =>
    callWithLoader("Guardando actividades...", () =>
      gasRequest("updateActivityHeaders", { headers })
    ),
  // Subjects (Materias)
  getTeacherSubjects: (id) => gasRequest("getTeacherSubjects", { id }),
  setTeacherSubjects: (id, subjects) =>
    gasRequest("setTeacherSubjects", { id, subjects }),
  listAllSubjects: () => gasRequest("listAllSubjects", {}),
  // Bulk ops for import
  bulkAddOrUpdateTeachers: (rows) => gasRequest("bulkAddOrUpdateTeachers", { rows }),
  bulkSetSubjects: (items) => gasRequest("bulkSetSubjects", { items }),
};

// Utility to map Apps Script teacher rows to UI model
function mapPagedResponseToModel(resp) {
  if (!resp || !resp.success) return { teachers: [], activities: [] };
  const headers = Array.isArray(resp.headers) ? resp.headers : [];
  const activities = headers.slice(4);
  const teachers = (resp.teachers || []).map((t) => {
    const activitiesObj = {};
    activities.forEach((a) => {
      activitiesObj[a] = !!t[a];
    });
    return {
      id: t.id,
      name: t.name,
      lastName: t.lastName,
      activities: activitiesObj,
      originalIndex: t.originalIndex,
    };
  });
  return { teachers, activities };
}

// expose globally
window.api = api;
window.setAuthToken = setAuthToken;

// ---- Firebase integration ----
(function(){
  var USE_FIREBASE = true; // flip to false to fall back to Apps Script
  if (!USE_FIREBASE) return;
  function ensureFB(){ if (!window.__fb || !__fb.db) throw new Error('Firebase no inicializado'); return __fb; }
  var __pageMap = { indexToId: [], activities: [] };
  async function fbGetActivities(){
    var fb = ensureFB();
    try {
      var snap = await fb.db.collection('settings').doc('activities').get();
      var headers = (snap.exists && Array.isArray(snap.data().headers)) ? snap.data().headers : [];
      return headers;
    } catch(e){ return []; }
  }
  function normalizeTeacherDoc(d){
    var data = d.data() || {}; var activities = data.activities || {}; var subjects = Array.isArray(data.subjects)?data.subjects:[];
    return { id: data.id || d.id, name: data.name||'', lastName: data.lastName||'', activities: activities, subjects: subjects };
  }
  window.api = {
    getPagedData: async function(page=1,pageSize=1000){
      var fb = ensureFB();
      var activities = await fbGetActivities();
      var q = fb.db.collection('teachers').orderBy('lastName').limit(pageSize);
      var snap = await q.get();
      var docs = snap.docs.map(normalizeTeacherDoc);
      __pageMap.indexToId = docs.map(function(t){ return t.id; });
      __pageMap.activities = activities.slice();
      var headers = ['Sel.','ID','Nombre','Apellidos'].concat(activities);
      var teachers = docs.map(function(t, idx){
        var row = { originalIndex: idx, id: t.id, name: t.name, lastName: t.lastName };
        activities.forEach(function(h){ row[h] = !!(t.activities && t.activities[h]); });
        return row;
      });
      return { success:true, teachers: teachers, headers: headers, totalTeachers: teachers.length, currentPage: 1 };
    },
    getDashboardStatistics: async function(){
      var resp = await this.getPagedData(1,1000);
      if (!resp.success) return { success:false, message:'No data' };
      var headers = Array.isArray(resp.headers)?resp.headers:[];
      var activityHeaders = headers.slice(4);
      var teachers = resp.teachers||[];
      var totalActivities = teachers.length * activityHeaders.length;
      var completedActivities = 0;
      var activityTotals = activityHeaders.map(function(){return 0;});
      teachers.forEach(function(t){
        activityHeaders.forEach(function(h, i){
          if (t[h]) { completedActivities++; activityTotals[i]++; }
        });
      });
      return { success:true, stats:{ totalActivities: totalActivities, completedActivities: completedActivities, activityTotals: activityTotals, totalTeachers: teachers.length }, activityHeaders: activityHeaders };
    },
    getAllTeachersForReport: async function(){
      var fb = ensureFB();
      var activities = await fbGetActivities();
      var snap = await fb.db.collection('teachers').orderBy('lastName').get();
      var rows = snap.docs.map(normalizeTeacherDoc).map(function(t){
        var obj = { id: t.id, name: t.name, lastName: t.lastName }; activities.forEach(function(h){ obj[h] = !!(t.activities && t.activities[h]); }); return obj;
      });
      var headers = ['Sel.','ID','Nombre','Apellidos'].concat(activities);
      return { success:true, teachers: rows, headers: headers };
    },
    addOrUpdateTeacher: async function(id,name,lastName){
      var fb = ensureFB();
      var activities = await fbGetActivities();
      var acts = {}; activities.forEach(function(h){ acts[h]=false; });
      await fb.db.collection('teachers').doc(String(id)).set({ id:String(id), name:String(name||''), lastName:String(lastName||''), activities: acts, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      emitChange('teacher:addOrUpdate', { id: String(id) });
      return { success:true };
    },
    updateTeacherData: async function(originalIndex,id,name,lastName){
      var fb = ensureFB();
      await fb.db.collection('teachers').doc(String(id)).set({ id:String(id), name:String(name||''), lastName:String(lastName||''), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      emitChange('teacher:update', { id: String(id) });
      return { success:true };
    },
    updateCheckboxState: async function(originalIndex,colIndex,value){
      var fb = ensureFB();
      var id = __pageMap.indexToId[Number(originalIndex)||0];
      var activity = __pageMap.activities[Number(colIndex)||0];
      if (!id || !activity) return { success:false, message:'Contexto no disponible' };
      var ref = fb.db.collection('teachers').doc(String(id));
      var data = {}; data['activities.'+activity] = !!value; data['updatedAt'] = firebase.firestore.FieldValue.serverTimestamp();
      await ref.update(data).catch(async function(){ await ref.set(data, { merge:true }); });
      emitChange('teacher:activityUpdate', { id: String(id), activity: String(activity), value: !!value });
      return { success:true };
    },
    deleteMultipleTeachers: async function(originalIndices){
      var fb = ensureFB();
      var ids = (originalIndices||[]).map(function(i){ return __pageMap.indexToId[Number(i)||0]; }).filter(Boolean);
      var batch = fb.db.batch(); ids.forEach(function(id){ batch.delete(fb.db.collection('teachers').doc(String(id))); }); await batch.commit();
      emitChange('teacher:deleteMultiple', { ids: ids });
      return { success:true };
    },
    updateActivityHeaders: async function(headers){
      var fb = ensureFB();
      await fb.db.collection('settings').doc('activities').set({ headers: Array.isArray(headers)?headers:[], updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      emitChange('activities:updateHeaders', { headers: Array.isArray(headers)?headers:[] });
      return { success:true };
    },
    getTeacherSubjects: async function(id){
      var fb = ensureFB();
      var snap = await fb.db.collection('teachers').doc(String(id)).get();
      var arr = (snap.exists && Array.isArray((snap.data()||{}).subjects)) ? snap.data().subjects : [];
      return { subjects: arr };
    },
    setTeacherSubjects: async function(id, subjects){
      var fb = ensureFB();
      await fb.db.collection('teachers').doc(String(id)).set({ subjects: Array.isArray(subjects)?subjects:[], updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      emitChange('teacher:setSubjects', { id: String(id) });
      return { success:true };
    },
    listAllSubjects: async function(){
      var fb = ensureFB();
      var snap = await fb.db.collection('teachers').get();
      var out = []; snap.docs.forEach(function(d){ var data=d.data()||{}; var subs = Array.isArray(data.subjects)?data.subjects:[]; out.push({ id: data.id || d.id, subjects: subs }); });
      return { items: out };
    },
    bulkAddOrUpdateTeachers: async function(rows){
      var fb = ensureFB(); var batch = fb.db.batch();
      var activities = await fbGetActivities(); var actsTemplate={}; activities.forEach(function(h){actsTemplate[h]=false;});
      (rows||[]).forEach(function(r){ var id=String((r&&r.id)||''); if(!id) return; var ref=fb.db.collection('teachers').doc(id); batch.set(ref, { id:id, name:String(r.name||''), lastName:String(r.lastName||''), activities: actsTemplate, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }); });
      await batch.commit();
      emitChange('teacher:bulkAddOrUpdate', { count: (rows||[]).length });
      return { result: (rows||[]).map(function(r){ return { id:r&&r.id, success:true }; }) };
    },
    bulkSetSubjects: async function(items){
      var fb = ensureFB(); var batch = fb.db.batch();
      (items||[]).forEach(function(it){ var id=String((it&&it.id)||''); if(!id) return; var ref=fb.db.collection('teachers').doc(id); batch.set(ref, { subjects: Array.isArray(it.subjects)?it.subjects:[] }, { merge:true }); });
      await batch.commit();
      emitChange('teacher:bulkSetSubjects', { count: (items||[]).length });
      return { success:true };
    }
  };
})();
