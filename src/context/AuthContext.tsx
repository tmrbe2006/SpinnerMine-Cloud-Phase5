import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { 
  User as FirebaseUser, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  signOut, 
  sendPasswordResetEmail,
  updateProfile,
  IdTokenResult
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase/config';
import { UserProfile, Language } from '../types';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  registerWithEmail: (email: string, pass: string, name: string, refCode?: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateMiningConsent: (consent: boolean) => Promise<void>;
  updateUserLanguage: (lang: Language) => Promise<void>;
  refreshAdminClaims: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Dedicated ref to ensure zero leaked Firestore listeners
  const profileUnsubRef = useRef<(() => void) | null>(null);

  // Check custom claims from verified token
  const evaluateAdminClaims = async (user: FirebaseUser | null, forceRefresh = false): Promise<boolean> => {
    if (!user) {
      setIsAdmin(false);
      return false;
    }
    try {
      const idTokenResult: IdTokenResult = await user.getIdTokenResult(forceRefresh);
      const hasClaim = Boolean(
        idTokenResult.claims.admin === true || 
        idTokenResult.claims.role === 'admin'
      );
      setIsAdmin(hasClaim);
      return hasClaim;
    } catch (err) {
      console.warn('Failed to evaluate custom claims:', err);
      setIsAdmin(false);
      return false;
    }
  };

  const refreshAdminClaims = async (): Promise<boolean> => {
    if (!auth.currentUser) {
      setIsAdmin(false);
      return false;
    }
    return evaluateAdminClaims(auth.currentUser, true);
  };

  // Sync Auth State with complete listener cleanup
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      // 1. Immediately clean up previous Firestore listener if account changed
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }

      setCurrentUser(user);

      if (user) {
        // Evaluate trusted Custom Claims
        await evaluateAdminClaims(user);

        const userDocRef = doc(db, 'users', user.uid);

        // 2. Attach new scoped listener
        const unsub = onSnapshot(
          userDocRef,
          async (snapshot) => {
            if (snapshot.exists()) {
              setUserProfile(snapshot.data() as UserProfile);
            } else {
              // Create default client profile: Role is strictly 'user' (never elevated from client)
              const initialProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                displayName: user.displayName || user.email?.split('@')[0] || 'Miner',
                photoURL: user.photoURL || '',
                role: 'user', // Explicit least-privilege default
                language: 'en',
                miningConsent: false,
                referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };

              try {
                await setDoc(userDocRef, initialProfile);
                setUserProfile(initialProfile);
              } catch (err) {
                console.error('Failed to initialize user document:', err);
              }
            }
            setLoading(false);
          },
          (err) => {
            try {
              handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
            } catch (handled) {
              console.warn('Non-blocking user profile sync warning:', handled);
            }
            setLoading(false);
          }
        );

        profileUnsubRef.current = unsub;
      } else {
        setUserProfile(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    // Fallback timer ensures the preview never hangs indefinitely if auth network is slow
    const fallbackTimer = setTimeout(() => {
      setLoading((prev) => (prev ? false : prev));
    }, 2000);

    // Component unmount cleanup
    return () => {
      clearTimeout(fallbackTimer);
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }
      unsubscribeAuth();
    };
  }, []);

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), pass);
  };

  const registerWithEmail = async (email: string, pass: string, name: string, refCode?: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    if (name) {
      await updateProfile(cred.user, { displayName: name });
    }

    // Role is strictly locked to 'user' from the browser client (Zero Admin elevation from client)
    // Passwords are NEVER written or stored in Firestore
    const newProfile: UserProfile = {
      uid: cred.user.uid,
      email: email.trim(),
      displayName: name || email.split('@')[0],
      photoURL: cred.user.photoURL || '',
      role: 'user', // Least privilege default
      language: 'en',
      miningConsent: false,
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(refCode && refCode.trim() ? { referredBy: refCode.trim().toUpperCase() } : {})
    };

    try {
      await setDoc(doc(db, 'users', cred.user.uid), newProfile);
      setUserProfile(newProfile);
      
      if (refCode && refCode.trim()) {
        await setDoc(doc(db, 'referrals', `${cred.user.uid}_ref`), {
          referralId: `${cred.user.uid}_ref`,
          referrerId: 'pending_attribution',
          referredUserId: cred.user.uid,
          referralCode: refCode.trim().toUpperCase(),
          bonusEarned: 0,
          createdAt: new Date().toISOString()
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to create user Firestore document:', err);
      handleFirestoreError(err, OperationType.WRITE, `users/${cred.user.uid}`);
    }
  };

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    if (profileUnsubRef.current) {
      profileUnsubRef.current();
      profileUnsubRef.current = null;
    }
    setUserProfile(null);
    setIsAdmin(false);
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const updateMiningConsent = async (consent: boolean) => {
    if (!currentUser) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    const updateData = {
      miningConsent: consent,
      consentTimestamp: new Date().toISOString(),
      consentVersion: 'v1.0',
      updatedAt: new Date().toISOString()
    };

    try {
      await updateDoc(userDocRef, updateData);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const updateUserLanguage = async (lang: Language) => {
    if (!currentUser) return;
    const userDocRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDocRef, {
        language: lang,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        isAdmin,
        loading,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        resetPassword,
        updateMiningConsent,
        updateUserLanguage,
        refreshAdminClaims
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
