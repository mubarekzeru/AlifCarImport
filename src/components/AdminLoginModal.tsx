import { useEffect, useState, type FormEvent } from 'react';
import { Lock, Mail, X } from 'lucide-react';
import { loginAdminByEmail } from '../utils/storeClient';

interface AdminLoginModalProps {
  isOpen: boolean;
  logoUrl?: string;
  companyName?: string;
  authorizedEmails?: string[];
  onClose: () => void;
  onAuthenticated: (email: string) => void;
}

export function AdminLoginModal({
  isOpen,
  logoUrl,
  companyName = 'Alif Car Import',
  authorizedEmails,
  onClose,
  onAuthenticated,
}: AdminLoginModalProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your admin email address.');
      return;
    }

    setSubmitting(true);
    try {
      const session = await loginAdminByEmail(trimmed, authorizedEmails);
      setEmail('');
      onAuthenticated(session.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-login-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover bg-white shrink-0"
              />
            ) : (
              <Lock className="w-4 h-4 text-[#D92027]" aria-hidden="true" />
            )}
            <h2 id="admin-login-title" className="font-display text-lg font-semibold text-white">
              Admin Sign In
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close admin sign in"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            Enter your authorized Alif Car Import administrator email to unlock inventory and content controls.
          </p>

          <div>
            <label htmlFor="admin-login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Admin Email *
            </label>
            <div className="relative">
              <Mail
                className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="admin-login-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full h-11 pl-9 pr-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-[#D92027]">
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-zinc-700 hover:border-white text-zinc-300 hover:text-white text-sm font-medium rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'Verifying...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
