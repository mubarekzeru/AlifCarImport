import type { ConfiguredSocialLink, SocialPlatform } from '../utils/inventory';

interface IconProps {
  className?: string;
}

export function TelegramIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.944 4.103a1.5 1.5 0 0 0-1.563-.217L2.88 11.16a1.45 1.45 0 0 0 .095 2.712l4.41 1.44 1.693 5.293a1.15 1.15 0 0 0 1.946.418l2.587-2.662 4.534 3.337a1.45 1.45 0 0 0 2.28-.872l2.97-15.17a1.5 1.5 0 0 0-1.451-1.553ZM9.46 14.54l-.49 3.638-1.106-3.457 9.933-6.647-8.337 6.466Z" />
    </svg>
  );
}

export function InstagramIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function FacebookIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M13.5 21v-7.5h2.52l.38-3H13.5V8.58c0-.87.24-1.46 1.49-1.46h1.59V4.44A21.3 21.3 0 0 0 14.26 4.3c-2.3 0-3.87 1.4-3.87 3.98v2.22H7.8v3h2.59V21h3.11Z" />
    </svg>
  );
}

export function XIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

export function WhatsAppIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2a9.93 9.93 0 0 0-8.6 14.89L2 22l5.26-1.38A9.93 9.93 0 1 0 12.04 2Zm5.8 14.08c-.25.7-1.45 1.34-2 1.42-.52.08-1.18.11-1.91-.12-.44-.14-1-.33-1.72-.64-3.03-1.31-5.01-4.37-5.16-4.57-.15-.2-1.23-1.64-1.23-3.13 0-1.49.78-2.22 1.06-2.52.27-.3.6-.38.8-.38.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.08.15.13.33.03.53-.1.2-.15.33-.3.5-.15.17-.32.39-.45.52-.15.15-.3.31-.13.61.18.3.78 1.29 1.68 2.09 1.15 1.03 2.13 1.35 2.43 1.5.3.15.48.13.66-.08.18-.2.75-.88.95-1.18.2-.3.4-.25.67-.15.28.1 1.75.83 2.05.98.3.15.5.23.58.35.07.12.07.72-.18 1.42Z" />
    </svg>
  );
}

export function TikTokIcon({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1Z" />
    </svg>
  );
}

const PLATFORM_STYLES: Record<SocialPlatform, { badge: string; iconColor: string }> = {
  whatsapp: {
    badge: 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-400/60',
    iconColor: 'text-[#25D366]',
  },
  telegram: {
    badge: 'border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400/60',
    iconColor: 'text-[#229ED9]',
  },
  instagram: {
    badge: 'border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20 hover:border-pink-400/60',
    iconColor: 'text-[#E4405F]',
  },
  facebook: {
    badge: 'border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 hover:border-blue-400/60',
    iconColor: 'text-[#1877F2]',
  },
  x: {
    badge: 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800 hover:border-zinc-500',
    iconColor: 'text-white',
  },
  tiktok: {
    badge: 'border-zinc-700 bg-zinc-900 hover:bg-[#D92027]/20 hover:border-[#D92027]/60',
    iconColor: 'text-white',
  },
};

export function SocialPlatformIcon({
  platform,
  className = 'w-4 h-4',
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  switch (platform) {
    case 'telegram':
      return <TelegramIcon className={className} />;
    case 'instagram':
      return <InstagramIcon className={className} />;
    case 'facebook':
      return <FacebookIcon className={className} />;
    case 'x':
      return <XIcon className={className} />;
    case 'whatsapp':
      return <WhatsAppIcon className={className} />;
    case 'tiktok':
      return <TikTokIcon className={className} />;
  }
}

export function SocialMediaIconRow({
  links,
  companyName,
  showLabels = false,
  variant = 'tile',
}: {
  links: ConfiguredSocialLink[];
  companyName: string;
  showLabels?: boolean;
  variant?: 'tile' | 'circle';
}) {
  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {links.map((item) => {
        if (variant === 'circle') {
          return (
            <a
              key={item.platform}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${companyName} on ${item.label}`}
              title={`${item.label}: ${item.handleText}`}
              className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] hover:border-[#E11D2A]/60 hover:bg-white/[0.08] text-zinc-300 hover:text-white inline-flex items-center justify-center transition-colors"
            >
              <SocialPlatformIcon platform={item.platform} className="w-4 h-4" />
            </a>
          );
        }

        const styles = PLATFORM_STYLES[item.platform];
        return (
          <a
            key={item.platform}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${companyName} on ${item.label}`}
            title={`${item.label}: ${item.handleText}`}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border transition-colors ${
              showLabels ? 'h-10 px-3' : 'w-10 h-10'
            } ${styles.badge}`}
          >
            <SocialPlatformIcon platform={item.platform} className={`w-4 h-4 ${styles.iconColor}`} />
            {showLabels && (
              <span className="text-xs font-medium text-zinc-200">{item.label}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
