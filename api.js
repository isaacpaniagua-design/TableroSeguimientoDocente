var __AUTH_ID_TOKEN = null;
try {
  const saved = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ID_TOKEN');
  if (saved) __AUTH_ID_TOKEN = saved;
} catch (e) {}

// Optional: persist an auth token in sessionStorage (used by UI helpers)
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


// expose helper
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
    return { id: data.id || d.id, name: data.name||'', lastName: data.lastName||'', activities: activities, subjects: subjects, email: data.email||'', controlNumber: data.controlNumber||'' };
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
        var row = { originalIndex: idx, id: t.id, name: t.name, lastName: t.lastName, email: t.email||'', controlNumber: t.controlNumber||'' };
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
    getRecentTeachers: async function(limit){
      var fb = ensureFB();
      var lim = Number(limit)||5;
      try {
        var snap = await fb.db.collection('teachers').orderBy('updatedAt','desc').limit(lim).get();
        var rows = snap.docs.map(normalizeTeacherDoc);
        return { items: rows };
      } catch (e) {
        // Fallback if no index on updatedAt
        var snap2 = await fb.db.collection('teachers').orderBy('id').limit(lim).get();
        var rows2 = snap2.docs.map(normalizeTeacherDoc);
        return { items: rows2 };
      }
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
    },
    seedDemoData: async function(){
      var fb = ensureFB();
      // Demo activities
      var activities = [
        'Planificación de clases',
        'Evaluación de estudiantes',
        'Reuniones de padres',
        'Capacitación docente',
        'Elaboración de materiales'
      ];
      await fb.db.collection('settings').doc('activities').set({ headers: activities, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      // Demo teachers
      var teachers = [
        { id:'DOC001', name:'Ana', lastName:'García López', activities:{ 'Planificación de clases':true, 'Evaluación de estudiantes':true, 'Reuniones de padres':false, 'Capacitación docente':true, 'Elaboración de materiales':false }, subjects:['Matemáticas I','Álgebra'] },
        { id:'DOC002', name:'Carlos', lastName:'Rodríguez Martín', activities:{ 'Planificación de clases':true, 'Evaluación de estudiantes':false, 'Reuniones de padres':true, 'Capacitación docente':false, 'Elaboración de materiales':true }, subjects:['Español','Literatura'] },
        { id:'DOC003', name:'María', lastName:'Hernández Pérez', activities:{ 'Planificación de clases':false, 'Evaluación de estudiantes':true, 'Reuniones de padres':true, 'Capacitación docente':true, 'Elaboración de materiales':false }, subjects:['Historia','Cívica'] },
        { id:'DOC004', name:'Luis', lastName:'Sánchez Díaz', activities:{ 'Planificación de clases':true, 'Evaluación de estudiantes':true, 'Reuniones de padres':true, 'Capacitación docente':false, 'Elaboración de materiales':false }, subjects:['Física','Cálculo'] },
        { id:'DOC005', name:'Elena', lastName:'Torres Gómez', activities:{ 'Planificación de clases':false, 'Evaluación de estudiantes':false, 'Reuniones de padres':true, 'Capacitación docente':true, 'Elaboración de materiales':true }, subjects:['Química','Biología'] },
      ];
      var batch = fb.db.batch();
      teachers.forEach(function(t){
        var ref = fb.db.collection('teachers').doc(t.id);
        batch.set(ref, { id:t.id, name:t.name, lastName:t.lastName, activities:t.activities, subjects:t.subjects, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      });
      await batch.commit();
      emitChange('seed:demo', { count: teachers.length });
      return { success:true, seeded: teachers.length };
    },
    seedDirectory: async function(){
      var fb = ensureFB();
      var items = [
        { name:'Aarón Gilberto León Flores', id:'00000092313', controlNumber:'87007190', email:'aaron.leon92313@potros.itson.edu.mx' },
        { name:'Arturo García Saiza', id:'00000090476', controlNumber:'87006214', email:'arturo.garcia90476@potros.itson.edu.mx' },
        { name:'Bertha Julia Valle Cruz', id:'00000013648', controlNumber:'85000551', email:'bertha.valle13648@potros.itson.edu.mx' },
        { name:'Carlos Alberto Ruiz Castrejón', id:'00000231195', controlNumber:'', email:'carlos.ruizc@potros.itson.edu.mx' },
        { name:'Cynthia Beatriz Pérez Castro', id:'00000160602', controlNumber:'85000882', email:'cynthia.perez@potros.itson.edu.mx' },
        { name:'Eduardo Lara García', id:'00000017041', controlNumber:'87006213', email:'eduardo.garcia17041@potros.itson.edu.mx' },
        { name:'Isaac Noé Paniagua Ruiz', id:'00000099645', controlNumber:'89003371', email:'isaac.paniagua@potros.itson.edu.mx' },
        { name:'Jesús Abraham Zazueta Castillo', id:'00000099610', controlNumber:'87006157', email:'jesus.zazueta99610@potros.itson.edu.mx' },
        { name:'Jesús Antonio Pérez Ceceña', id:'00000009726', controlNumber:'87005932', email:'jesus.perez9726@potros.itson.edu.mx' },
        { name:'Jesús Carlos Gaytán Salazar', id:'00000262383', controlNumber:'', email:'jesuscarlosgaytan@gmail.com' },
        { name:'Jesús Rigoberto Villavicencio Navarro', id:'00000162447', controlNumber:'89003065', email:'jesus.villavicencio162447@potros.itson.edu.mx' },
        { name:'Jorge Alberto Norzagaray Mora', id:'00000016329', controlNumber:'87005932', email:'jorge.norzagaray16329@potros.itson.edu.mx' },
        { name:'Juan Manuel Osuna Aceves', id:'00000019413', controlNumber:'87001734', email:'juan.osuna19413@potros.itson.edu.mx' },
        { name:'Julio Isaac Nava Cordero', id:'00000092307', controlNumber:'87007034', email:'julio.nava92307@potros.itson.edu.mx' },
        { name:'Marco Antonio Tellechea Rodríguez', id:'00000019294', controlNumber:'87902065', email:'marco.tellechea19294@potros.itson.edu.mx' },
        { name:'Miguel Ángel Moroyoqui Parra', id:'00000020641', controlNumber:'87004412', email:'miguel.moroyoqui20641@potros.itson.edu.mx' },
        { name:'Ricardo Daniel Carrasco Correa', id:'00000020122', controlNumber:'87005261', email:'ricardo.carrasco20122@potros.itson.edu.mx' },
        { name:'Roberto Limon Ulloa', id:'00000019401', controlNumber:'85000836', email:'roberto.limon@potros.itson.edu.mx' },
        { name:'Saúl Grijalva Varillas', id:'00000062125', controlNumber:'89002789', email:'saul.grijalva62125@potros.itson.edu.mx' },
        { name:'Sergio Castellanos Bustamante', id:'00000090851', controlNumber:'', email:'sergio.castellanos90851@potros.itson.edu.mx' },
        { name:'Vinko Antonio Nevescanín Moreno', id:'00000206923', controlNumber:'87007385', email:'vinko.nevescanin206923@potros.itson.edu.mx' },
        { name:'Zaira Guadalupe Bermúdez Pérez', id:'00000091125', controlNumber:'87006990', email:'zaira.bermudez91125@potros.itson.edu.mx' },
      ];
      var batch = fb.db.batch();
      items.forEach(function(it){
        var parts = String(it.name||'').trim().split(/\s+/);
        var lastName = parts.length>1 ? parts.slice(-2).join(' ') : (parts[0]||'');
        var firstName = parts.length>1 ? parts.slice(0,-2).join(' ') : '';
        var ref = fb.db.collection('teachers').doc(String(it.id));
        batch.set(ref, {
          id: String(it.id||''),
          name: String(firstName||''),
          lastName: String(lastName||''),
          email: String(it.email||''),
          controlNumber: String(it.controlNumber||''),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge:true });
      });
      await batch.commit();
      emitChange('seed:directory', { count: items.length });
      return { success:true, seeded: items.length };
    }
  };
})();

// Ensure a global `api` identifier exists for scripts that reference it
try { if (typeof window !== 'undefined') { window.api = window.api || {}; } } catch (e) {}
// Declare global var binding so `api` is defined
var api = (typeof window !== 'undefined' && window.api) ? window.api : {};
