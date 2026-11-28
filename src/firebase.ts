import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function createFirestoreClient(): Firestore {
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(
        app,
        { experimentalForceLongPolling: true },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = createFirestoreClient();
export const auth = getAuth(app);
if (typeof window !== 'undefined') {
  void setPersistence(auth, browserSessionPersistence).catch(() => undefined);
}
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFirestoreUserMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Unable to sync showroom data with Firebase.';
  }
  let messageText = err.message;
  try {
    const parsed = JSON.parse(err.message) as Partial<FirestoreErrorInfo>;
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      messageText = parsed.error;
    }
  } catch {
    // Plain error message
  }
  const lower = messageText.toLowerCase();
  if (lower.includes('quota exceeded') || lower.includes('resource-exhausted') || lower.includes('resource_exhausted')) {
    return 'Firebase daily quota exceeded. Cloud sync is paused until usage limits reset tomorrow (or after upgrading your Firebase plan), so changes will not sync to other browsers yet.';
  }
  if (lower.includes('missing or insufficient permissions')) {
    return 'Permission denied by Firebase security rules. Sign in with an authorized admin account to publish changes.';
  }
  return messageText;
}

async function testConnection(): Promise<void> {
  // Showroom catalog runs on Cloudflare Worker D1 + R2 so we avoid unnecessary Firestore reads on startup.
  if (typeof window === 'undefined') {
    return;
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}
