import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Car, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { PRESET_VEHICLE_PHOTOS } from '../data/seedData';
import type { Vehicle, VehicleStatus } from '../types/showroom';
import { readFileAsResizedDataUrl } from '../utils/imageUpload';
import {
  isTikTokVideoUrl,
  normalizeTikTokUrl,
  validateVehicleInput,
  type VehicleValidationErrors,
} from '../utils/inventory';
import { fetchTikTokVideoMetadata } from '../utils/storeClient';

interface VehicleFormModalProps {
  isOpen: boolean;
  initialVehicle: Vehicle | null;
  onClose: () => void;
  onSave: (
    vehicle: Vehicle,
    options?: { publishToTikTokReels?: boolean; tiktokCaption?: string }
  ) => void;
}

export function VehicleFormModal({
  isOpen,
  initialVehicle,
  onClose,
  onSave,
}: VehicleFormModalProps) {
  const [title, setTitle] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2024');
  const [price, setPrice] = useState('');
  const [mileage, setMileage] = useState('');
  const [transmission, setTransmission] = useState('Automatic');
  const [fuelType, setFuelType] = useState('Petrol');
  const [color, setColor] = useState('');
  const [origin, setOrigin] = useState('Japan Import');
  const [imageUrl, setImageUrl] = useState(PRESET_VEHICLE_PHOTOS[0].url);
  const [description, setDescription] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [status, setStatus] = useState<VehicleStatus>('available');
  const [featured, setFeatured] = useState(false);
  const [errors, setErrors] = useState<VehicleValidationErrors>({});
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fetchingTikTok, setFetchingTikTok] = useState(false);
  const [tiktokNotice, setTiktokNotice] = useState('');
  const [tiktokCovers, setTiktokCovers] = useState<{ label: string; url: string }[]>([]);
  const [publishToTikTokReels, setPublishToTikTokReels] = useState(false);
  const [fetchedTikTokCaption, setFetchedTikTokCaption] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setUploadError('');
    setTiktokNotice('');
    setTiktokCovers([]);
    setPublishToTikTokReels(false);
    setFetchedTikTokCaption('');

    if (initialVehicle) {
      setTitle(initialVehicle.title);
      setMake(initialVehicle.make);
      setModel(initialVehicle.model);
      setYear(String(initialVehicle.year));
      setPrice(String(initialVehicle.price));
      setMileage(initialVehicle.mileage);
      setTransmission(initialVehicle.transmission);
      setFuelType(initialVehicle.fuelType);
      setColor(initialVehicle.color);
      setOrigin(initialVehicle.origin);
      setImageUrl(initialVehicle.imageUrl);
      setDescription(initialVehicle.description);
      setTiktokUrl(initialVehicle.tiktokUrl);
      setStatus(initialVehicle.status);
      setFeatured(initialVehicle.featured);
    } else {
      setTitle('');
      setMake('');
      setModel('');
      setYear(String(new Date().getFullYear()));
      setPrice('');
      setMileage('0 km');
      setTransmission('Automatic');
      setFuelType('Petrol');
      setColor('');
      setOrigin('Direct Import');
      setImageUrl(PRESET_VEHICLE_PHOTOS[0].url);
      setDescription('');
      setTiktokUrl('');
      setStatus('available');
      setFeatured(false);
    }
  }, [isOpen, initialVehicle]);

  if (!isOpen) return null;

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const dataUrl = await readFileAsResizedDataUrl(file, 1280, 0.85);
      setImageUrl(dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to load photo.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleFetchFromTikTok = async () => {
    const trimmed = normalizeTikTokUrl(tiktokUrl);
    if (!isTikTokVideoUrl(trimmed)) {
      setTiktokNotice('Paste a TikTok video link (vt.tiktok.com/... or tiktok.com/@.../video/...) first.');
      return;
    }
    setFetchingTikTok(true);
    setTiktokNotice('');
    try {
      const meta = await fetchTikTokVideoMetadata(trimmed);
      if (meta.resolvedUrl) setTiktokUrl(meta.resolvedUrl);
      if (!title.trim() && meta.suggestedTitle) setTitle(meta.suggestedTitle);
      if (meta.description) {
        setFetchedTikTokCaption(meta.description);
        if (!description.trim()) setDescription(meta.description);
      }
      if (meta.coverOptions.length > 0) {
        setTiktokCovers(meta.coverOptions);
        if (!initialVehicle && imageUrl === PRESET_VEHICLE_PHOTOS[0].url) {
          setImageUrl(meta.coverOptions[0].url);
        }
      }
      setPublishToTikTokReels(true);
      setTiktokNotice('Fetched title, caption & cover options from TikTok video.');
    } catch (err) {
      setTiktokNotice(
        err instanceof Error ? err.message : 'Unable to fetch details from TikTok link.'
      );
    } finally {
      setFetchingTikTok(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const normalizedTikTok = tiktokUrl.trim() ? normalizeTikTokUrl(tiktokUrl) : '';
    const validation = validateVehicleInput({
      title,
      make,
      model,
      year,
      price: price === '' ? 0 : price,
      description,
      tiktokUrl: normalizedTikTok,
    });

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    const saved: Vehicle = {
      id: initialVehicle?.id ?? `veh_${Date.now()}`,
      title: title.trim(),
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      price: Number(price) || 0,
      mileage: mileage.trim() || 'Verified Low Mileage',
      transmission: transmission.trim() || 'Automatic',
      fuelType: fuelType.trim() || 'Petrol',
      color: color.trim() || 'Standard',
      origin: origin.trim() || 'Direct Import',
      imageUrl: imageUrl.trim(),
      description: description.trim(),
      tiktokUrl: normalizedTikTok,
      status,
      featured,
      createdAt: initialVehicle?.createdAt ?? new Date().toISOString(),
    };

    onSave(saved, {
      publishToTikTokReels: publishToTikTokReels && isTikTokVideoUrl(normalizedTikTok),
      tiktokCaption: fetchedTikTokCaption || description.trim(),
    });
  };

  const inputClass =
    'w-full h-10 px-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[#141418] border border-zinc-800 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#141418] border-b border-zinc-800">
          <h2 id="vehicle-form-title" className="font-display text-lg font-semibold text-white">
            {initialVehicle ? 'Edit Vehicle Listing' : 'Add New Imported Vehicle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vehicle form"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Photo upload + preview */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
            <div className="sm:col-span-5">
              <div className="aspect-[4/3] w-full rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Vehicle preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                    <Car className="w-8 h-8" />
                  </div>
                )}
              </div>
            </div>

            <div className="sm:col-span-7 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Vehicle Photo
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#D92027] hover:bg-[#B91C1C] text-white text-xs font-medium rounded-lg cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{uploading ? 'Processing...' : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
                {uploadError && (
                  <p className="mt-1 text-xs text-[#D92027]">{uploadError}</p>
                )}
              </div>

              {tiktokCovers.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-medium text-zinc-400">
                    Pick Cover from TikTok Video
                  </span>
                  <div className="flex items-center gap-2">
                    {tiktokCovers.map((opt) => (
                      <button
                        key={opt.url}
                        type="button"
                        onClick={() => setImageUrl(opt.url)}
                        className={`relative w-16 h-20 rounded-md overflow-hidden border cursor-pointer ${
                          imageUrl === opt.url
                            ? 'border-[#D92027] ring-2 ring-[#D92027]/40'
                            : 'border-zinc-700 hover:border-white'
                        }`}
                      >
                        <img
                          src={opt.url}
                          alt={opt.label}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Post Title + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-8">
              <label htmlFor="vf-title" className="block text-xs font-medium text-zinc-300 mb-1">
                Post Title *
              </label>
              <input
                id="vf-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 2024 Toyota Land Cruiser 300 ZX"
                className={inputClass}
              />
              {errors.title && <p className="mt-1 text-xs text-[#D92027]">{errors.title}</p>}
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="vf-status" className="block text-xs font-medium text-zinc-300 mb-1">
                Availability Status
              </label>
              <select
                id="vf-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="sold">Sold</option>
              </select>
            </div>
          </div>

          {/* Make, Model, Year, Price */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="vf-make" className="block text-xs font-medium text-zinc-300 mb-1">
                Make *
              </label>
              <input
                id="vf-make"
                type="text"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Toyota"
                className={inputClass}
              />
              {errors.make && <p className="mt-1 text-xs text-[#D92027]">{errors.make}</p>}
            </div>

            <div>
              <label htmlFor="vf-model" className="block text-xs font-medium text-zinc-300 mb-1">
                Model *
              </label>
              <input
                id="vf-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Land Cruiser"
                className={inputClass}
              />
              {errors.model && <p className="mt-1 text-xs text-[#D92027]">{errors.model}</p>}
            </div>

            <div>
              <label htmlFor="vf-year" className="block text-xs font-medium text-zinc-300 mb-1">
                Year *
              </label>
              <input
                id="vf-year"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2024"
                className={`${inputClass} tabular-nums`}
              />
              {errors.year && <p className="mt-1 text-xs text-[#D92027]">{errors.year}</p>}
            </div>

            <div>
              <label htmlFor="vf-price" className="block text-xs font-medium text-zinc-300 mb-1">
                Price (USD)
              </label>
              <input
                id="vf-price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="89500"
                className={`${inputClass} tabular-nums`}
              />
              {errors.price && <p className="mt-1 text-xs text-[#D92027]">{errors.price}</p>}
            </div>
          </div>

          {/* Additional specs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="vf-mileage" className="block text-xs font-medium text-zinc-300 mb-1">
                Mileage
              </label>
              <input
                id="vf-mileage"
                type="text"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="3,800 km"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="vf-transmission" className="block text-xs font-medium text-zinc-300 mb-1">
                Transmission
              </label>
              <input
                id="vf-transmission"
                type="text"
                value={transmission}
                onChange={(e) => setTransmission(e.target.value)}
                placeholder="Automatic"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="vf-fuel" className="block text-xs font-medium text-zinc-300 mb-1">
                Engine / Fuel
              </label>
              <input
                id="vf-fuel"
                type="text"
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                placeholder="3.5L V6 Twin-Turbo"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="vf-color" className="block text-xs font-medium text-zinc-300 mb-1">
                Exterior Color
              </label>
              <input
                id="vf-color"
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Pearl White"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="vf-origin" className="block text-xs font-medium text-zinc-300 mb-1">
                Import Origin
              </label>
              <input
                id="vf-origin"
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Japan Import"
                className={inputClass}
              />
            </div>

            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  className="w-4 h-4 accent-[#D92027]"
                />
                <span>Featured Vehicle</span>
              </label>
            </div>
          </div>

          {/* Write-up & TikTok link */}
          <div className="space-y-4">
            <div>
              <label htmlFor="vf-description" className="block text-xs font-medium text-zinc-300 mb-1">
                Product Detail Write-up (shown under image) *
              </label>
              <textarea
                id="vf-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe trim highlights, import condition, inspection notes, and cabin features..."
                className="w-full p-3 bg-[#1c1c21] border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D92027]"
              />
              {errors.description && (
                <p className="mt-1 text-xs text-[#D92027]">{errors.description}</p>
              )}
            </div>

            <div>
              <label htmlFor="vf-tiktok" className="block text-xs font-medium text-zinc-300 mb-1">
                TikTok Video Link (optional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="vf-tiktok"
                  type="url"
                  value={tiktokUrl}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setTiktokUrl(nextVal);
                    if (
                      isTikTokVideoUrl(nextVal) &&
                      normalizeTikTokUrl(nextVal) !==
                        normalizeTikTokUrl(initialVehicle?.tiktokUrl || '')
                    ) {
                      setPublishToTikTokReels(true);
                    }
                  }}
                  placeholder="https://vt.tiktok.com/... or https://www.tiktok.com/@.../video/..."
                  className={`${inputClass} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  disabled={fetchingTikTok || !isTikTokVideoUrl(tiktokUrl)}
                  onClick={handleFetchFromTikTok}
                  className="inline-flex items-center gap-1.5 h-10 px-3 border border-zinc-700 hover:border-white disabled:opacity-45 bg-[#1c1c21] text-zinc-200 hover:text-white text-xs font-medium rounded-lg cursor-pointer shrink-0 transition-colors"
                >
                  {fetchingTikTok ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>Fetch from Video</span>
                </button>
              </div>
              {isTikTokVideoUrl(tiktokUrl) && (
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishToTikTokReels}
                    onChange={(e) => setPublishToTikTokReels(e.target.checked)}
                    className="w-4 h-4 accent-[#D92027]"
                  />
                  <span>Also publish this video in homepage TikTok Walkaround Reels</span>
                </label>
              )}
              {tiktokNotice && (
                <p className="mt-1 text-xs text-emerald-400">{tiktokNotice}</p>
              )}
              {errors.tiktokUrl && (
                <p className="mt-1 text-xs text-[#D92027]">{errors.tiktokUrl}</p>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-zinc-700 hover:border-white text-zinc-300 hover:text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-[#D92027] hover:bg-[#B91C1C] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {initialVehicle ? 'Save Changes' : 'Publish Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
