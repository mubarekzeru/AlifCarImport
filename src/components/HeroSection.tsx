import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ALIF_DEFAULT_HERO_POSTER,
  ALIF_DEFAULT_HERO_VIDEO,
  ALIF_DEFAULT_LOGO,
} from '../data/seedData';
import type { BrandingSettings, HeroPost } from '../types/showroom';
import {
  resolveHeroVideoUrl,
  resolvePublicAssetUrl,
  splitDisplayBrandLines,
} from '../utils/inventory';

interface HeroSectionProps {
  branding: BrandingSettings;
  hero: HeroPost;
  totalVehicles: number;
  availableCount: number;
  onBrowseClick: () => void;
  onContactClick?: () => void;
}

export function HeroSection({
  branding,
  hero,
  onBrowseClick,
}: HeroSectionProps) {
  const videoSrc = resolveHeroVideoUrl(hero.videoUrl, ALIF_DEFAULT_HERO_VIDEO);
  const rawPoster = resolvePublicAssetUrl(hero.imageUrl);
  const posterSrc =
    (rawPoster && !rawPoster.includes('1794743573450_afe14f04') ? rawPoster : '') ||
    resolvePublicAssetUrl(ALIF_DEFAULT_HERO_POSTER);
  const logoSrc = resolvePublicAssetUrl(branding.logoUrl) || ALIF_DEFAULT_LOGO;
  const brandLines = splitDisplayBrandLines(branding.companyName);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setHasRenderedFrame(false);
    setVideoFailed(false);

    const video = videoRef.current;
    if (!video || !videoSrc) return;

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;

    const tryPlay = () => {
      if (document.visibilityState === 'hidden') return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        setHasRenderedFrame(true);
      }
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            // Autoplay may be deferred on Data Saver / Battery Saver until user gesture; poster remains visible underneath
          });
        }
      }
    };

    const handleLoadedData = () => {
      if (video.videoWidth > 0) {
        setHasRenderedFrame(true);
      }
      tryPlay();
    };

    const handlePlaying = () => {
      setHasRenderedFrame(true);
    };

    const handleTimeUpdate = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        setHasRenderedFrame(true);
      }
    };

    const handleEmptied = () => {
      setHasRenderedFrame(false);
    };

    const handleError = () => {
      setVideoFailed(true);
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        tryPlay();
      }
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('canplay', tryPlay);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('emptied', handleEmptied);
    video.addEventListener('error', handleError);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('touchstart', tryPlay, { passive: true });
    window.addEventListener('pointerdown', tryPlay, { passive: true });

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const isVisible = entries.some((entry) => entry.isIntersecting);
          if (isVisible) {
            tryPlay();
          } else if (!video.paused) {
            video.pause();
          }
        },
        { threshold: 0.05 }
      );
      observer.observe(video);
    }

    tryPlay();

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('canplay', tryPlay);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('emptied', handleEmptied);
      video.removeEventListener('error', handleError);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('touchstart', tryPlay);
      window.removeEventListener('pointerdown', tryPlay);
      observer?.disconnect();
    };
  }, [videoSrc]);

  return (
    <section
      id="top"
      className="relative w-full min-h-[100dvh] flex items-end overflow-hidden bg-[#08080a]"
    >
      {/* Persistent opening frame so buffering, Data Saver, or suspended decoders never show a black void */}
      {posterSrc && (
        <img
          src={posterSrc}
          alt={hero.title || branding.companyName}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-[50%_56%] scale-[1.03] select-none pointer-events-none"
        />
      )}

      {videoSrc && !videoFailed && (
        <video
          ref={videoRef}
          key={videoSrc}
          src={videoSrc}
          poster={posterSrc || undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-label={hero.title || branding.companyName}
          className={`absolute inset-0 w-full h-full object-cover object-[50%_56%] scale-[1.03] select-none pointer-events-none transition-opacity duration-300 ${
            hasRenderedFrame ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Measured dark obsidian directional scrims ensuring high contrast across moving frames */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px bg-gradient-to-r from-[#08080a]/85 via-[#08080a]/55 to-[#08080a]/12"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px bg-gradient-to-t from-[#08080a] via-[#08080a]/20 to-[#08080a]/40"
      />
      {/* Solid bottom seal preventing any 1px subpixel/hardware-video edge seam */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-1 inset-x-0 h-16 bg-gradient-to-t from-[#08080a] from-20% via-[#08080a]/80 to-transparent"
      />

      {/* Brand Lockup & Editorial Composition resting cleanly over the lower hero video */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-12 sm:pt-28 sm:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl space-y-5"
        >
          <div className="flex items-center gap-4 sm:gap-5">
            {logoSrc && (
              <img
                src={logoSrc}
                alt={`${branding.companyName} emblem`}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  if (!e.currentTarget.src.endsWith(ALIF_DEFAULT_LOGO)) {
                    e.currentTarget.src = ALIF_DEFAULT_LOGO;
                  }
                }}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover bg-white ring-2 ring-white/30 shadow-[0_10px_28px_rgba(0,0,0,0.65)] shrink-0 select-none"
              />
            )}
            <h1 className="hero-brand-outline text-[clamp(2.25rem,7.2vw,4.5rem)] leading-[0.94] select-none">
              {brandLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
          </div>

          <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-[#FB3748]">
            {hero.kicker || 'Direct Imported Inventory'} · {branding.tagline}
          </p>

          <p className="text-sm sm:text-base lg:text-lg text-zinc-300/95 leading-relaxed max-w-xl">
            {hero.description}
          </p>
        </motion.div>
      </div>

      {/* Subtle centered scroll indicator on desktop */}
      <button
        type="button"
        onClick={onBrowseClick}
        aria-label="Scroll to collection"
        className="hidden md:flex flex-col items-center gap-2 absolute bottom-7 left-1/2 -translate-x-1/2 z-10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
      >
        <span className="text-[11px] font-medium tracking-wide">Scroll to explore</span>
        <span className="w-5 h-8 rounded-full border border-white/25 flex items-start justify-center p-1.5 overflow-hidden">
          <span className="w-1 h-2 rounded-full bg-[#E11D2A] animate-scroll-dot" />
        </span>
      </button>
    </section>
  );
}
