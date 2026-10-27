import { Env } from './types';

export function toFirestoreValue(val: any): Record<string, any> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue)
      }
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return {
      mapValue: { fields }
    };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: Record<string, any>): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('mapValue' in val) {
    const fields = val.mapValue.fields || {};
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = fromFirestoreValue(v as any);
    }
    return obj;
  }
  if ('arrayValue' in val) {
    const values = val.arrayValue.values || [];
    return values.map((v: any) => fromFirestoreValue(v));
  }
  return null;
}

export function fromFirestoreDoc(doc: any): any {
  if (!doc || !doc.fields) return null;
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    data[k] = fromFirestoreValue(v as any);
  }
  // Extract document ID from name (e.g. projects/.../documents/miningWorkers/worker123)
  const nameParts = doc.name ? doc.name.split('/') : [];
  data.id = nameParts[nameParts.length - 1];
  return data;
}

export function getFirestoreBaseUrl(env: Env): string {
  const projectId = env.FIREBASE_PROJECT_ID || 'spinnermine-cloud-production';
  const databaseId = env.FIRESTORE_DATABASE_ID || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

export class FirestoreError extends Error {
  status: number;
  code: string;
  raw?: string;
  constructor(message: string, status: number, code: string, raw?: string) {
    super(message);
    this.name = 'FirestoreError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

function parseFirestoreError(status: number, errText: string): { message: string; code: string } {
  let code = status === 403 ? 'PERMISSION_DENIED' : (status === 404 ? 'NOT_FOUND' : 'DATABASE_ERROR');
  let message = errText;
  try {
    const json = JSON.parse(errText);
    if (json.error) {
      code = json.error.status || code;
      message = json.error.message || errText;
    }
  } catch {}
  return { message, code };
}

/**
 * Fetches a single Firestore document. Returns null if 404 (not found).
 */
export async function getDocument(
  collection: string,
  docId: string,
  token: string,
  env: Env
): Promise<any | null> {
  const baseUrl = getFirestoreBaseUrl(env);
  const url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const errText = await res.text();
    const { message, code } = parseFirestoreError(res.status, errText);
    throw new FirestoreError(`Firestore GET failed [${res.status}]: ${message}`, res.status, code, errText);
  }

  const json = await res.json();
  return fromFirestoreDoc(json);
}

/**
 * Sets/updates a Firestore document using PATCH with updateMask.
 */
export async function setDocument(
  collection: string,
  docId: string,
  data: Record<string, any>,
  token: string,
  env: Env,
  merge = true
): Promise<any> {
  const baseUrl = getFirestoreBaseUrl(env);
  const fields: Record<string, any> = {};
  const fieldPaths: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields[key] = toFirestoreValue(value);
      fieldPaths.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
    }
  }

  let url = `${baseUrl}/${collection}/${encodeURIComponent(docId)}`;
  if (merge && fieldPaths.length > 0) {
    url += `?${fieldPaths.join('&')}`;
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const errText = await res.text();
    const { message, code } = parseFirestoreError(res.status, errText);
    throw new FirestoreError(`Firestore PATCH failed [${res.status}]: ${message}`, res.status, code, errText);
  }

  const json = await res.json();
  return fromFirestoreDoc(json);
}

/**
 * Queries a collection with a field filter.
 */
export async function queryCollection(
  collection: string,
  filter: { field: string; op: 'EQUAL'; value: any } | null,
  token: string,
  env: Env
): Promise<any[]> {
  const baseUrl = getFirestoreBaseUrl(env);
  const url = `${baseUrl}:runQuery`;

  const structuredQuery: any = {
    from: [{ collectionId: collection }]
  };

  if (filter) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: filter.field },
        op: filter.op,
        value: toFirestoreValue(filter.value)
      }
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ structuredQuery })
  });

  if (!res.ok) {
    const errText = await res.text();
    const { message, code } = parseFirestoreError(res.status, errText);
    throw new FirestoreError(`Firestore query failed [${res.status}]: ${message}`, res.status, code, errText);
  }

  const results: any[] = await res.json();
  const docs: any[] = [];

  for (const item of results) {
    if (item.document) {
      docs.push(fromFirestoreDoc(item.document));
    }
  }

  return docs;
}

/**
 * Executes an atomic batch commit on Firestore.
 * Supports preconditions (e.g. currentDocument: { exists: false }) for replay prevention.
 */
export async function commitWrites(
  writes: any[],
  token: string,
  env: Env
): Promise<any> {
  const baseUrl = getFirestoreBaseUrl(env);
  const url = `${baseUrl}:commit`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ writes })
  });

  if (!res.ok) {
    const errText = await res.text();
    const error: any = new Error(`Firestore commit failed [${res.status}]: ${errText}`);
    error.status = res.status;
    error.raw = errText;
    throw error;
  }

  return await res.json();
}
