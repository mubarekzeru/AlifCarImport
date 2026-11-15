export function readFileAsResizedDataUrl(
  file: File,
  maxWidth = 1280,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a valid image file (JPG, PNG, or WebP).'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const targetWidth = Math.round(img.width * scale);
        const targetHeight = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const outputType = file.type === 'image/png' && targetWidth <= 512 ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(outputType, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export interface VideoFrameCandidate {
  label: string;
  timeSeconds: number;
  dataUrl: string;
}

export function extractFramesFromVideoFile(
  file: File,
  frameCount = 4,
  maxWidth = 960
): Promise<VideoFrameCandidate[]> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('video/')) {
      reject(new Error('Please select a valid video file (MP4, MOV, or WebM).'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Unable to read frames from this video file in the browser.'));
    };

    video.onloadedmetadata = async () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const timestamps = Array.from({ length: frameCount }, (_, idx) => {
        const ratio = (idx + 0.5) / frameCount;
        return Math.min(Math.max(duration * ratio, 0.1), Math.max(duration - 0.1, 0.1));
      });

      const candidates: VideoFrameCandidate[] = [];
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const scale = vw > maxWidth ? maxWidth / vw : 1;
      const targetWidth = Math.round(vw * scale);
      const targetHeight = Math.round(vh * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        cleanup();
        reject(new Error('Browser canvas is unavailable for frame extraction.'));
        return;
      }

      try {
        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i];
          await new Promise<void>((resSeek, rejSeek) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              video.removeEventListener('error', onErr);
              resSeek();
            };
            const onErr = () => {
              video.removeEventListener('seeked', onSeeked);
              video.removeEventListener('error', onErr);
              rejSeek(new Error('Video seek failed'));
            };
            video.addEventListener('seeked', onSeeked);
            video.addEventListener('error', onErr);
            video.currentTime = ts;
          });

          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const secs = Math.round(ts * 10) / 10;
          candidates.push({
            label: `Frame ${secs}s`,
            timeSeconds: secs,
            dataUrl,
          });
        }
        cleanup();
        resolve(candidates);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error('Failed to extract video frames.'));
      }
    };

    video.src = objectUrl;
  });
}
