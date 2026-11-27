import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Film, Loader2, Play, X } from 'lucide-react';
import type { TikTokSectionConfig } from '../types/showroom';
import { getTikTokGridLayoutMetrics } from '../utils/firestoreSyncLogic';
import {
  buildSocialMediaUrl,
  deriveTitleFromVideoDescription,
  extractTikTokVideoId,
  filterActiveTikTokPosts,
  isPlaceholderTikTokCover,
  normalizeTikTokUrl,
} from '../utils/inventory';
import { fetchTikTokVideoMetadata } from '../utils/storeClient';
import { ScrollReveal } from './ScrollReveal';

interface TikTokShowcaseProps {
  tiktok: TikTokSectionConfig;
  loading?: boolean;
}

interface ResolvedPostMedia {
  coverUrl?: string;
  videoId?: string | null;
  title?: string;
  loading?: boolean;
}

export function TikTokShowcase({ tiktok, loading = false }: TikTokShowcaseProps) {
  const [activeEmbedId, setActiveEmbedId] = useState<string | null>(null);
  const [resolvedByPostId, setResolvedByPostId] = useState<Record<string, ResolvedPostMedia>>({});
  const [brokenCoverIds, setBrokenCoverIds] = useState<Record<string, boolean>>({});
  const attemptedFetchRef = useRef<Record<string, string>>({});
  const isMountedRef = useRef(true);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScrollHorizontally, setCanScrollHorizontally] = useState(false);
  const activePosts = filterActiveTikTokPosts(tiktok.posts);
  const layoutMetrics = getTikTokGridLayoutMetrics(activePosts.length);
  const activePostsKey = activePosts
    .map((p) => `${p.id}|${p.tiktokUrl}|${p.coverImageUrl || ''}`)
    .join('||');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) {
      setCanScrollHorizontally(false);
      return;
    }

    const measureOverflow = () => {
      setCanScrollHorizontally(el.scrollWidth > el.clientWidth + 4);
    };

    measureOverflow();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measureOverflow);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measureOverflow);
    return () => window.removeEventListener('resize', measureOverflow);
  }, [activePostsKey]);

  // Automatically resolve the real TikTok video cover page if any post has a missing, placeholder, or expired cover
  useEffect(() => {
    for (const post of activePosts) {
      const normalizedUrl = normalizeTikTokUrl(post.tiktokUrl);
      if (!normalizedUrl) continue;

      const needsCover =
        isPlaceholderTikTokCover(post.coverImageUrl) || Boolean(brokenCoverIds[post.id]);
      const needsVideoId = !extractTikTokVideoId(normalizedUrl);
      if (!needsCover && !needsVideoId) continue;

      const attemptKey = `${normalizedUrl}|${brokenCoverIds[post.id] ? 'retry' : 'init'}`;
      if (attemptedFetchRef.current[post.id] === attemptKey) continue;
      attemptedFetchRef.current[post.id] = attemptKey;

      setResolvedByPostId((prev) => ({
        ...prev,
        [post.id]: { ...prev[post.id], loading: true },
      }));

      void fetchTikTokVideoMetadata(normalizedUrl)
        .then((meta) => {
          if (!isMountedRef.current) return;
          setResolvedByPostId((prev) => ({
            ...prev,
            [post.id]: {
              coverUrl: meta.coverImageUrl || meta.coverOptions[0]?.url || prev[post.id]?.coverUrl,
              videoId: meta.videoId || extractTikTokVideoId(meta.resolvedUrl) || null,
              title: meta.suggestedTitle || undefined,
              loading: false,
            },
          }));
        })
        .catch(() => {
          if (!isMountedRef.current) return;
          setResolvedByPostId((prev) => ({
            ...prev,
            [post.id]: { ...prev[post.id], loading: false },
          }));
        });
    }
  }, [activePostsKey, brokenCoverIds]);

  const scrollTrack = (direction: 'prev' | 'next') => {
    const el = trackRef.current;
    if (!el) return;
    const distance = Math.max(el.clientWidth * 0.9, 240);
    el.scrollBy({
      left: direction === 'next' ? distance : -distance,
      behavior: 'smooth',
    });
  };

  return (
    <section
      id="tiktok-showcase"
      className="scroll-mt-20 border-t border-white/[0.07] bg-[#0b0b0e] py-14 sm:py-18"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-7">
        <ScrollReveal
          y={26}
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
        >
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E11D2A]">
              {tiktok.handle.trim()
                ? `Video Walkarounds · ${tiktok.handle.trim()}`
                : 'Video Walkarounds'}
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {tiktok.title}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {tiktok.description}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
            {canScrollHorizontally && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => scrollTrack('prev')}
                  aria-label="Scroll TikTok videos left"
                  className="w-9 h-9 rounded-lg border border-zinc-700 bg-[#16161b] text-zinc-200 hover:border-white hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTrack('next')}
                  aria-label="Scroll TikTok videos right"
                  className="w-9 h-9 rounded-lg border border-zinc-700 bg-[#16161b] text-zinc-200 hover:border-white hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {(() => {
              const followHref =
                buildSocialMediaUrl('tiktok', tiktok.profileUrl) ||
                buildSocialMediaUrl('tiktok', tiktok.handle);
              if (!followHref) return null;
              return (
                <a
                  href={followHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>Follow {tiktok.handle.trim() || 'TikTok'}</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              );
            })()}
          </div>
        </ScrollReveal>

        {activePosts.length === 0 ? (
          loading ? (
            <div className="grid grid-flow-col grid-rows-2 auto-cols-[calc((100%-1.25rem)/3)] sm:auto-cols-[205px] lg:auto-cols-[calc((100%-3rem)/4)] overflow-x-auto gap-2.5 sm:gap-4 pb-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <div
                  key={n}
                  className="w-full aspect-[9/15] lg:aspect-[9/13.5] rounded-xl bg-[#141418] border border-white/[0.08] animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="border border-zinc-800 bg-[#141418] rounded-xl p-8 text-center text-sm text-zinc-400">
              No TikTok video links added yet.
            </div>
          )
        ) : (
          <div className="space-y-3">
            {canScrollHorizontally && (
              <p className="text-xs text-zinc-400 flex items-center justify-between">
                <span>
                  Newest reels first · Swipe horizontally to view all {activePosts.length} videos
                </span>
                <span className="hidden sm:inline font-medium text-zinc-300">
                  Use arrows or swipe →
                </span>
              </p>
            )}

            <div
              ref={trackRef}
              data-testid="tiktok-carousel"
              data-rows={layoutMetrics.rows}
              data-columns={layoutMetrics.columns}
              className={`grid grid-flow-col ${
                layoutMetrics.rows === 2 ? 'grid-rows-2' : 'grid-rows-1'
              } ${
                layoutMetrics.columns === 1
                  ? 'auto-cols-[200px] sm:auto-cols-[240px] lg:auto-cols-[260px]'
                  : layoutMetrics.columns === 2
                  ? 'auto-cols-[calc((100%-0.625rem)/2)] sm:auto-cols-[225px] lg:auto-cols-[260px]'
                  : 'auto-cols-[calc((100%-1.25rem)/3)] sm:auto-cols-[205px] lg:auto-cols-[calc((100%-3rem)/4)]'
              } overflow-x-auto overscroll-x-contain snap-x snap-mandatory gap-2.5 sm:gap-4 pb-3 scroll-smooth`}
            >
              {activePosts.map((post) => {
                const resolved = resolvedByPostId[post.id];
                const targetUrl = normalizeTikTokUrl(post.tiktokUrl) || tiktok.profileUrl;
                const videoId = extractTikTokVideoId(targetUrl) || resolved?.videoId || null;
                const isPlayingInline = Boolean(videoId && activeEmbedId === post.id);
                const coverSrc =
                  (!brokenCoverIds[post.id] && !isPlaceholderTikTokCover(post.coverImageUrl)
                    ? post.coverImageUrl
                    : '') ||
                  resolved?.coverUrl ||
                  '';

                const trimmedTitle = post.title.trim();
                const derivedTitle =
                  (!trimmedTitle || trimmedTitle === 'New Imported Arrival Walkaround') &&
                  (post.caption.trim() || resolved?.title)
                    ? deriveTitleFromVideoDescription(post.caption) || resolved?.title || trimmedTitle
                    : trimmedTitle;
                const displayTitle = derivedTitle || 'Alif Car Import Reel';

                const cardOverlayContent = (
                  <>
                    {coverSrc ? (
                      <img
                        src={coverSrc}
                        alt={displayTitle}
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (!brokenCoverIds[post.id] && post.coverImageUrl === coverSrc) {
                            setBrokenCoverIds((prev) => ({ ...prev, [post.id]: true }));
                          }
                        }}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : resolved?.loading ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#141418] text-zinc-400">
                        <Loader2 className="w-5 h-5 animate-spin text-[#E11D2A]" aria-hidden="true" />
                        <span className="text-[10px] font-medium">Loading cover...</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#141418] text-zinc-600">
                        <Film className="w-8 h-8" />
                      </div>
                    )}

                    {/* Subtle TikTok-style bottom gradient so the full video cover stays clear and unobstructed */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

                    {/* Hover-only subtle center play cue */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-[2px] border border-white/30 text-white inline-flex items-center justify-center shadow-lg">
                        <Play
                          className="w-5 h-5 fill-current translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                    </div>

                    {/* TikTok-style bottom-left hollow play triangle + concise video title */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2 sm:p-3 flex items-end gap-1.5">
                      <Play
                        className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white shrink-0 mb-0.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                      <h3 className="font-display text-[11px] sm:text-xs font-semibold text-white leading-tight line-clamp-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                        {displayTitle}
                      </h3>
                    </div>
                  </>
                );

                return (
                  <article
                    key={post.id}
                    data-testid={`tiktok-card-${post.id}`}
                    className="group w-full snap-start bg-[#141418] border border-white/[0.08] rounded-xl overflow-hidden transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
                  >
                    <div
                      data-testid={`tiktok-media-${post.id}`}
                      className="relative aspect-[9/15] lg:aspect-[9/13.5] w-full bg-zinc-950 overflow-hidden"
                    >
                      {isPlayingInline && videoId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveEmbedId(null)}
                            aria-label={`Close embedded video for ${displayTitle}`}
                            className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/80 text-white inline-flex items-center justify-center hover:bg-black cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <iframe
                            src={`https://www.tiktok.com/embed/v2/${videoId}`}
                            title={displayTitle}
                            className="w-full h-full bg-black"
                            allowFullScreen
                          />
                        </>
                      ) : videoId ? (
                        <button
                          type="button"
                          onClick={() => setActiveEmbedId(post.id)}
                          aria-label={`Play ${displayTitle}`}
                          className="relative block w-full h-full text-left cursor-pointer"
                        >
                          {cardOverlayContent}
                        </button>
                      ) : (
                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Watch ${displayTitle} on TikTok`}
                          className="relative block w-full h-full text-left"
                        >
                          {cardOverlayContent}
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
