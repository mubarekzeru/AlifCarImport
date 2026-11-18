import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

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
  try {
    const parsed = JSON.parse(err.message) as Partial<FirestoreErrorInfo>;
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      const raw = parsed.error;
      if (raw.toLowerCase().includes('quota exceeded')) {
        return 'Firebase daily quota exceeded. Usage limits reset tomorrow.';
      }
      if (raw.toLowerCase().includes('missing or insufficient permissions')) {
        return 'Permission denied by Firebase security rules. Sign in with alifcarimports@gmail.com to publish changes.';
      }
      return raw;
    }
  } catch {
    // Plain error message
  }
  return err.message;
}

async function testConnection(): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  ) {
    window.addEventListener('online', () => void testConnection(), { once: true });
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
