// Apps Script Web App URL (exec). Replace with your deployment URL
// Example: https://script.google.com/macros/s/AKfycbx.../exec
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbys5tkzAYOJdrjoSITBUDm2rkypN4OW34IHyDYBEzSMkChcHUukKyog7a3a5MypPFYLdw/exec";
let __AUTH_ID_TOKEN = null;

function setAuthToken(idToken) {
  __AUTH_ID_TOKEN = idToken || null;
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
  deleteMultipleTeachers: (originalIndices) =>
    gasRequest("deleteMultipleTeachers", { originalIndices }),
  updateActivityHeaders: (headers) =>
    gasRequest("updateActivityHeaders", { headers }),
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
