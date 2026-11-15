export type VehicleStatus = 'available' | 'reserved' | 'sold';

export interface Vehicle {
  id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price: number;
  mileage: string;
  transmission: string;
  fuelType: string;
  color: string;
  origin: string;
  imageUrl: string;
  description: string;
  tiktokUrl: string;
  status: VehicleStatus;
  featured: boolean;
  createdAt: string;
}

export interface HeroPost {
  kicker: string;
  title: string;
  description: string;
  imageUrl: string;
  ctaLabel: string;
}

export interface TikTokPost {
  id: string;
  title: string;
  caption: string;
  tiktokUrl: string;
  coverImageUrl: string;
}

export interface TikTokSectionConfig {
  title: string;
  description: string;
  profileUrl: string;
  handle: string;
  posts: TikTokPost[];
}

export interface LocationContact {
  addressLine: string;
  cityCountry: string;
  hours: string;
  phone: string;
  whatsapp: string;
  telegram?: string;
  instagram?: string;
  facebook?: string;
  x?: string;
  email: string;
  mapsUrl: string;
  landmarkNote: string;
}

export interface BrandingSettings {
  companyName: string;
  logoUrl: string;
  tagline: string;
}

export interface ShowroomStore {
  branding: BrandingSettings;
  hero: HeroPost;
  vehicles: Vehicle[];
  tiktok: TikTokSectionConfig;
  contact: LocationContact;
  adminEmails?: string[];
}

export interface VehicleFilters {
  query: string;
  make: string;
  model: string;
  year: string;
  status?: VehicleStatus | 'all';
}

export interface CustomerInquiry {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicleTitle: string;
  message: string;
  createdAt: string;
}
