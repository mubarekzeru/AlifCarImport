import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Film, Play, X } from 'lucide-react';
import type { TikTokSectionConfig } from '../types/showroom';
import {
  deriveTitleFromVideoDescription,
  extractTikTokVideoId,
  filterActiveTikTokPosts,
  normalizeTikTokUrl,
} from '../utils/inventory';

interface TikTokShowcaseProps {
  tiktok: TikTokSectionConfig;
}

export function TikTokShowcase({ tiktok }: TikTokShowcaseProps) {
  const [activeEmbedId, setActiveEmbedId] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activePosts = filterActiveTikTokPosts(tiktok.posts);

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
      className="scroll-mt-6 border-t border-zinc-800 bg-[#0d0d10] py-12 sm:py-14"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#D92027]">
              Video Walkarounds · {tiktok.handle}
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white uppercase">
              {tiktok.title}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {tiktok.description}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
            {activePosts.length > 3 && (
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

            {tiktok.profileUrl && (
              <a
                href={tiktok.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <span>Follow {tiktok.handle || 'TikTok'}</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        {activePosts.length === 0 ? (
          <div className="border border-zinc-800 bg-[#141418] rounded-xl p-8 text-center text-sm text-zinc-400">
            No TikTok video links added yet.
          </div>
        ) : (
          <div className="space-y-3">
            {activePosts.length > 3 && (
              <p className="text-xs text-zinc-400 flex items-center justify-between">
                <span>
                  Showing 3 compact portrait reels · Swipe horizontally to view all {activePosts.length} videos
                </span>
                <span className="hidden sm:inline font-medium text-zinc-300">
                  Use arrows or swipe →
                </span>
              </p>
            )}

            <div
              ref={trackRef}
              data-testid="tiktok-carousel"
              className="flex overflow-x-auto snap-x snap-mandatory gap-2 sm:gap-5 pb-3 scroll-smooth"
            >
              {activePosts.map((post) => {
                const targetUrl = normalizeTikTokUrl(post.tiktokUrl) || tiktok.profileUrl;
                const videoId = extractTikTokVideoId(targetUrl);
                const isPlayingInline = Boolean(videoId && activeEmbedId === post.id);
                const trimmedTitle = post.title.trim();
                const displayTitle =
                  (!trimmedTitle || trimmedTitle === 'New Imported Arrival Walkaround') &&
                  post.caption.trim()
                    ? deriveTitleFromVideoDescription(post.caption) || post.title
                    : post.title;
                const cardWidthClass =
                  activePosts.length === 1
                    ? 'w-[200px] sm:w-[260px] lg:w-[290px]'
                    : activePosts.length === 2
                    ? 'w-[calc((100%-0.5rem)/2)] min-w-[148px] sm:w-[250px] lg:w-[270px]'
                    : 'w-[calc((100%-1rem)/3)] min-w-[112px] sm:w-[210px] lg:w-[240px]';

                const playIconBadge = (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/45 backdrop-blur-[2px] border border-white/25 text-white/80 opacity-75 group-hover:opacity-95 group-hover:scale-105 group-hover:bg-[#D92027]/75 group-hover:border-white/50 group-hover:text-white inline-flex items-center justify-center transition-all shadow-lg">
                      <Play
                        className="w-5 h-5 sm:w-6 sm:h-6 fill-current translate-x-0.5 opacity-85"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                );

                const cardOverlayContent = (
                  <>
                    {post.coverImageUrl ? (
                      <img
                        src={post.coverImageUrl}
                        alt={displayTitle}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">
                        <Film className="w-8 h-8" />
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

                    {playIconBadge}

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2.5 sm:p-3.5">
                      <h3 className="font-display text-xs sm:text-sm font-semibold text-white leading-snug line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        {displayTitle}
                      </h3>
                    </div>
                  </>
                );

                return (
                  <article
                    key={post.id}
                    data-testid={`tiktok-card-${post.id}`}
                    className={`group shrink-0 snap-start ${cardWidthClass} bg-[#141418] border border-zinc-800 rounded-xl overflow-hidden transition-colors hover:border-zinc-600`}
                  >
                    <div
                      data-testid={`tiktok-media-${post.id}`}
                      className="relative aspect-[9/14] w-full bg-zinc-950 overflow-hidden"
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
