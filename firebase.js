const PROJECT_ID = "what-are-we-gonna-eat-tonight";
const API_KEY = "AIzaSyB9XQYfYrXAISiRtQIXbb6vOEjIHzRt2rg";

// ✅ 用來暫存登入後的 Firebase idToken / refreshToken
let authToken = '';
let authRefreshToken = '';
let authTokenExpiresAt = 0;

// ✅ 設定目前登入 session
// expiresIn 通常是 3600 秒；這裡會提早 5 分鐘當作過期，避免 request 時剛好失效
export const setAuthToken = (token, refreshToken = '', expiresIn = 3600) => {
  authToken = token || '';

  if (refreshToken) {
    authRefreshToken = refreshToken;
  }

  const expiresInSeconds = Number(expiresIn || 3600);
  authTokenExpiresAt = Date.now() + Math.max(expiresInSeconds - 300, 60) * 1000;
};

// ✅ 清除登入 token
export const clearAuthToken = () => {
  authToken = '';
  authRefreshToken = '';
  authTokenExpiresAt = 0;
};


// 封裝註冊功能
export const registerWithEmail = async (email, password) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || '註冊失敗');
  }

  return data;
};

// 封裝登入功能
export const loginWithEmail = async (email, password) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || '登入失敗');
  }

  return data;
};

// 刪除 Firebase Auth 帳號
export const deleteCurrentAccount = async () => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: authToken
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || '刪除帳號失敗');
  }

  return data;
};
// 用途：用 refreshToken 重新取得新的 idToken，讓同一手機可以保持登入
export const refreshAuthToken = async (refreshToken) => {
  const safeRefreshToken = String(refreshToken || authRefreshToken || '').trim();

  if (!safeRefreshToken) {
    throw new Error('沒有 refresh token，請重新登入。');
  }

  const url = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(safeRefreshToken)}`
  });

  const data = await response.json();

  if (!response.ok) {
    console.log('refreshAuthToken error:', data);
    throw new Error(data.error?.message || '登入狀態已失效，請重新登入。');
  }

  // securetoken endpoint 回傳是 snake_case
  const nextIdToken = data.id_token || '';
  const nextRefreshToken = data.refresh_token || safeRefreshToken;
  const expiresInSeconds = Number(data.expires_in || 3600);

  authToken = nextIdToken;
  authRefreshToken = nextRefreshToken;
  authTokenExpiresAt = Date.now() + Math.max(expiresInSeconds - 300, 60) * 1000;

  return {
    idToken: nextIdToken,
    refreshToken: nextRefreshToken,
    userId: data.user_id || '',
    expiresIn: expiresInSeconds
  };
};

// 用途：Firestore request 前確認 idToken 仍然有效；如果過期就自動 refresh
const ensureFreshAuthToken = async () => {
  if (!authToken) {
    return '';
  }

  // token 未過期，直接用現有 token
  if (authTokenExpiresAt && Date.now() < authTokenExpiresAt) {
    return authToken;
  }

  // token 過期，但有 refreshToken，就自動換新 idToken
  if (authRefreshToken) {
    const refreshedUser = await refreshAuthToken(authRefreshToken);
    return refreshedUser.idToken;
  }

  // 沒有 refreshToken，只能回傳現有 token；之後 request 可能會失敗
  return authToken;
};

// 用途：刪除帳號 / 改密碼等敏感操作前，重新登入取得新的 idToken
export const reauthenticateCurrentUser = async (email, password) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || '重新驗證失敗');
  }

// 重要：更新目前使用中的 token
// deleteCurrentAccount() 之後會用這個最新 token 去刪帳號
setAuthToken(data.idToken, data.refreshToken, data.expiresIn);

return data;
};

// ✅ Firestore 回傳值解析
const parseFirestoreValue = (field) => {
  if (!field) return null;

  if (field.stringValue !== undefined) return field.stringValue;
  if (field.doubleValue !== undefined) return Number(field.doubleValue);
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.timestampValue !== undefined) return field.timestampValue;

  if (field.arrayValue !== undefined) {
    return (field.arrayValue.values || []).map(parseFirestoreValue);
  }

  if (field.mapValue !== undefined) {
    const result = {};
    const fields = field.mapValue.fields || {};

    Object.keys(fields).forEach(key => {
      result[key] = parseFirestoreValue(fields[key]);
    });

    return result;
  }

  return null;
};

// ✅ 將 JS value 轉成 Firestore REST API 格式
const formatFirestoreValue = (value) => {
  if (value instanceof Date) {
    return {
      timestampValue: value.toISOString()
    };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(item => formatFirestoreValue(item))
      }
    };
  }

  if (typeof value === 'string') {
    return {
      stringValue: value
    };
  }

  if (typeof value === 'number') {
    return {
      doubleValue: value
    };
  }

  if (typeof value === 'boolean') {
    return {
      booleanValue: value
    };
  }

  if (value && typeof value === 'object') {
    const fields = {};

    Object.keys(value).forEach(key => {
      fields[key] = formatFirestoreValue(value[key]);
    });

    return {
      mapValue: {
        fields
      }
    };
  }

  return {
    stringValue: ''
  };
};

// ✅ 將普通 object 轉成 Firestore fields
const formatFirestoreFields = (data) => {
  const formattedFields = {};

  Object.keys(data || {}).forEach(key => {
    formattedFields[key] = formatFirestoreValue(data[key]);
  });

  return formattedFields;
};

// ✅ 取得 Firestore request headers
// 重要：每次 Firestore request 前都先確認 token 未過期
const getFirestoreHeaders = async (includeContentType = false) => {
  const headers = {};

  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  const freshToken = await ensureFreshAuthToken();

  if (freshToken) {
    headers.Authorization = `Bearer ${freshToken}`;
  }

  return headers;
};


// ✅ Firestore document parser
const parseFirestoreDocument = (doc) => {
  const parsed = {
    id: doc.name.split('/').pop()
  };

  const fields = doc.fields || {};

  Object.keys(fields).forEach(key => {
    parsed[key] = parseFirestoreValue(fields[key]);
  });

  return parsed;
};

export const db = {
  collection: (collectionName) => {
    return {
      // ✅ 更新 document
      update: async (docId, data) => {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}/${docId}`;

        const formattedFields = formatFirestoreFields(data);

        const response = await fetch(url, {
          method: 'PATCH',
          headers: await getFirestoreHeaders(true),
          body: JSON.stringify({
            fields: formattedFields
          })
        });

        const result = await response.json();

        if (!response.ok) {
          console.log('Firestore update error:', {
            collectionName,
            docId,
            status: response.status,
            result
          });

          throw new Error(
            result.error?.message ||
            `無法更新資料：${collectionName}/${docId}，HTTP ${response.status}`
          );
        }

        return result;
      },
// ✅ 指定 document id 新增 / 覆蓋 document
set: async (docId, data) => {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}/${docId}`;

  const formattedFields = formatFirestoreFields(data);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: await getFirestoreHeaders(true),
    body: JSON.stringify({
      fields: formattedFields
    })
  });

  const result = await response.json();

  if (!response.ok) {
    console.log('Firestore set error:', {
      collectionName,
      docId,
      status: response.status,
      result
    });

    throw new Error(
      result.error?.message ||
      `無法設定資料：${collectionName}/${docId}，HTTP ${response.status}`
    );
  }

  return result;
},
      // ✅ 刪除 document
      delete: async (docId) => {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}/${docId}`;

        const response = await fetch(url, {
          method: 'DELETE',
          headers: await getFirestoreHeaders(false)
        });

        if (!response.ok) {
          const result = await response.json();

          console.log('Firestore delete error:', {
            collectionName,
            docId,
            status: response.status,
            result
          });

          throw new Error(
            result.error?.message ||
            `無法刪除資料：${collectionName}/${docId}，HTTP ${response.status}`
          );
        }

        return true;
      },

      // ✅ 新增 document
      add: async (data) => {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}`;

        const formattedFields = formatFirestoreFields(data);

        const response = await fetch(url, {
          method: 'POST',
          headers: await getFirestoreHeaders(true),
          body: JSON.stringify({
            fields: formattedFields
          })
        });

        const result = await response.json();

        if (!response.ok) {
          console.log('Firestore add error:', {
            collectionName,
            status: response.status,
            result
          });

          throw new Error(
            result.error?.message ||
            `無法寫入資料庫：${collectionName}，HTTP ${response.status}`
          );
        }

        return result;
      },

      // ✅ 讀取整個 collection
// ✅ 讀取整個 collection，支援 Firestore REST 分頁
getAll: async () => {
  let allDocs = [];
  let pageToken = '';

  try {
    do {
      const params = new URLSearchParams();

      // 用途：每次盡量多取一點，避免公開菜式多時只讀到第一頁
      params.append('pageSize', '100');

      if (pageToken) {
        params.append('pageToken', pageToken);
      }

      const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}?${params.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: await getFirestoreHeaders(false)
      });

      const data = await response.json();

      if (!response.ok) {
        console.log('Firestore getAll error:', {
          collectionName,
          status: response.status,
          data
        });

        throw new Error(
          data.error?.message ||
          `無法讀取資料庫：${collectionName}，HTTP ${response.status}`
        );
      }

      const docs = data.documents || [];
      allDocs = [...allDocs, ...docs];

      pageToken = data.nextPageToken || '';
    } while (pageToken);

    return allDocs.map(parseFirestoreDocument);
  } catch (error) {
    console.log('Firestore getAll paginated error:', {
      collectionName,
      error
    });

    throw error;
  }
},

      // ✅ 查詢 array 欄位包含指定值的 documents
      // 用法例子：
      // db.collection('requests').whereArrayContains('groupMemberEmails', email)
      whereArrayContains: async (fieldName, value) => {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;

        const response = await fetch(url, {
          method: 'POST',
          headers: await getFirestoreHeaders(true),
          body: JSON.stringify({
            structuredQuery: {
              from: [
                {
                  collectionId: collectionName
                }
              ],
              where: {
                fieldFilter: {
                  field: {
                    fieldPath: fieldName
                  },
                  op: 'ARRAY_CONTAINS',
                  value: {
                    stringValue: value
                  }
                }
              }
            }
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.log('Firestore whereArrayContains error:', {
            collectionName,
            fieldName,
            value,
            status: response.status,
            data
          });

          throw new Error(
            data.error?.message ||
            `無法查詢資料庫：${collectionName}，HTTP ${response.status}`
          );
        }

        return (data || [])
          .filter(item => item.document)
          .map(item => parseFirestoreDocument(item.document));
      }
    };
  }
};